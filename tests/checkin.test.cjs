const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto, createHash } = require('node:crypto');

function setup(responses, { expireFirst = false } = {}) {
  const calls = [], waits = [], storage = {};
  let clock = 0, challengeWaits = 0;
  const event = () => ({ addListener() {} });
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [new Date(2026, 10, 7, 12).getTime() + clock])); }
    static now() { return clock; }
  }
  const context = vm.createContext({
    console, Date: FakeDate, crypto: webcrypto, TextEncoder, AbortController,
    setTimeout(fn, ms) {
      if (ms === 2500) {
        waits.push(ms);
        challengeWaits++;
        clock += expireFirst && challengeWaits === 1 ? 300000 : ms;
        queueMicrotask(fn);
      }
      return 1;
    },
    clearTimeout() {},
    fetch: async (url, options) => {
      calls.push({ url, options, at: clock });
      assert.ok(responses.length, 'unexpected request');
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return {
        ok: (response.status || 200) < 400,
        status: response.status || 200,
        headers: { get: () => response.type || 'application/json' },
        json: async () => response.body
      };
    },
    chrome: {
      storage: { local: {
        async get(keys) { return { ...(Array.isArray(keys) ? {} : keys), ...storage }; },
        async set(data) { Object.assign(storage, data); }
      } },
      runtime: { onInstalled: event(), onStartup: event(), onMessage: event(), openOptionsPage() {} },
      alarms: { onAlarm: event(), create() {} },
      action: { onClicked: event() },
      notifications: { async create() {} },
      declarativeNetRequest: { async updateDynamicRules() {} }
    }
  });
  vm.runInContext(fs.readFileSync('background.js', 'utf8'), context);
  return { context, calls, waits, storage, run: (code = 'performFetch(false)') => vm.runInContext(code, context) };
}
const challenge = (nonce = 'test-nonce') => ({ body: { code: 0, nonce, ttl: 300000 } });

test('challenge → minimum wait → proof → POST, then persist manual success', async () => {
  const app = setup([challenge(), { body: { code: 0, points: 8 } }]);
  const result = await app.run('performFetch(false, true)');
  assert.equal(result.success, true);
  assert.match(result.message, /8/);
  assert.equal(app.calls[0].url, 'https://glados.cloud/api/user/checkin/challenge');
  assert.equal(app.calls[1].url, 'https://glados.cloud/api/user/checkin');
  const options = app.calls[1].options;
  assert.deepEqual(JSON.parse(options.body), {
    token: 'glados.cloud', nonce: 'test-nonce',
    proof: createHash('sha256').update('test-nonce.glados-observe-v1').digest('hex')
  });
  assert.equal(app.calls[1].at, 2500);
  assert.equal(options.credentials, 'include');
  assert.equal(app.calls[0].options.credentials, 'include');
  assert.equal(app.storage.lastCheckInDate, '2026-11-07');
  assert.match(app.storage.history[0].result, /手动.*成功/);
});

test('explicit successful repeated check-in records date', async () => {
  const app = setup([challenge(), { body: { code: 0, repeated: true } }]);
  assert.equal((await app.run()).success, true);
  assert.equal(app.storage.lastCheckInDate, '2026-11-07');
});

for (const body of [
  { code: 1, message: 'checkin points repeat tomorrow logged failed' },
  { code: 1, repeated: true, message: 'denied' },
  { code: 4, reason: 'device-mismatch' },
  { code: 1 },
  { message: 'missing code' }
]) {
  test(`failure never marks done: ${JSON.stringify(body)}`, async () => {
    const app = setup([challenge(), { body }]);
    assert.equal((await app.run()).success, false);
    assert.equal(app.storage.lastCheckInDate, undefined);
    assert.match(app.storage.history[0].result, /失败/);
    if (body.reason) assert.match(app.storage.history[0].result, /重新登录/);
  });
}

for (const response of [
  { status: 401 }, { status: 403 }, { status: 500 },
  { type: 'text/html' }, { body: null },
  { body: { code: 0 } }, { body: { code: 0, nonce: 'n', ttl: 1000 } },
  { body: { code: 1, message: 'challenge failed' } }, new Error('Network failed')
]) {
  test(`challenge failure stops POST: ${JSON.stringify(response)}`, async () => {
    const app = setup([response]);
    assert.equal((await app.run()).success, false);
    assert.equal(app.calls.length, 1);
    assert.equal(app.storage.lastCheckInDate, undefined);
  });
}

test('expired nonce is discarded and replaced', async () => {
  const app = setup([challenge('old'), challenge('new'), { body: { code: 0 } }], { expireFirst: true });
  assert.equal((await app.run()).success, true);
  assert.equal(JSON.parse(app.calls[2].options.body).nonce, 'new');
});

test('concurrent manual and automatic requests share one task', async () => {
  const app = setup([challenge(), { body: { code: 0 } }]);
  await app.run('Promise.all([performFetch(false), performFetch(false, true), performFetch(false)])');
  assert.equal(app.calls.length, 2);
  assert.equal(app.storage.history.length, 1);
});

test('failed task releases lock and retries with fresh nonce', async () => {
  const app = setup([challenge('first'), { body: { code: 1 } }, challenge('second'), { body: { code: 0 } }]);
  assert.equal((await app.run()).success, false);
  assert.equal((await app.run()).success, true);
  assert.equal(JSON.parse(app.calls[3].options.body).nonce, 'second');
});

test('scheduler skips a date already completed manually', async () => {
  const app = setup([challenge(), { body: { code: 0 } }]);
  await app.run('performFetch(false, true)');
  await app.run('tryCheckIn()');
  assert.equal(app.calls.length, 2);
});

for (const response of [{ type: 'text/html' }, { status: 403 }, { status: 401 }, Object.assign(new Error('timeout'), { name: 'AbortError' })]) {
  test(`POST failure leaves retry available: ${JSON.stringify(response)}`, async () => {
    const app = setup([challenge(), response]);
    const result = await app.run();
    assert.equal(result.success, false);
    assert.equal(app.storage.lastCheckInDate, undefined);
    if (response.name === 'AbortError') assert.match(result.message, /超时/);
  });
}
