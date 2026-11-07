const API_ROOT = "https://glados.cloud/api";
const CHECKIN_URL = "https://glados.cloud/console/checkin";
const CHALLENGE_DELAY_MS = 2500;
const CHALLENGE_MARGIN_MS = 15000;
let checkInFlight = null;

// 挑战和签到都使用同一个站点来源；替换旧版本仅覆盖 POST 的规则。
async function configureRequests() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Origin", operation: "set", value: "https://glados.cloud" },
          { header: "Referer", operation: "set", value: CHECKIN_URL }
        ]
      },
      condition: {
        urlFilter: "|https://glados.cloud/api/user/checkin",
        resourceTypes: ["xmlhttprequest"]
      }
    }]
  });
}

function ensureAlarm() {
  return chrome.alarms.create("checkInAlarm", { delayInMinutes: 1, periodInMinutes: 60 });
}

chrome.runtime.onInstalled.addListener(() => {
  initialize().catch(console.error);
});
chrome.runtime.onStartup.addListener(() => {
  initialize().catch(console.error);
});
async function initialize() {
  await configureRequests();
  await ensureAlarm();
  await tryCheckIn();
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkInAlarm") tryCheckIn().catch(console.error);
});

function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

async function tryCheckIn() {
  const data = await chrome.storage.local.get(["notifyEnabled", "lastCheckInDate", "targetHour"]);
  const now = new Date();
  const hour = Number.isInteger(data.targetHour) && data.targetHour >= 0 && data.targetHour <= 23
    ? data.targetHour : 9;
  if (data.lastCheckInDate !== localDate(now) && now.getHours() >= hour) {
    return performFetch(data.notifyEnabled);
  }
}

async function requestJSON(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(API_ROOT + path, {
      ...options,
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: { Accept: "application/json", ...options.headers }
    });
    if (response.status === 401) throw new Error("登录已失效，请打开签到页面重新登录。");
    if (response.status === 403) throw new Error("请求被拦截或需要机器人验证，请打开签到页面完成验证后重试。");
    if (!response.ok) throw new Error(`服务器请求失败（HTTP ${response.status}），稍后将重试。`);
    const type = response.headers.get("content-type") || "";
    if (!type.includes("application/json")) {
      throw new Error("服务器返回了网页而非签到结果，请打开签到页面检查登录或机器人验证。");
    }
    const result = await response.json();
    if (!result || typeof result !== "object" || Array.isArray(result) || typeof result.code !== "number") {
      throw new Error("服务器返回的签到数据格式异常，未记录为成功。");
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

function serverMessage(result, fallback) {
  if (result.code === 4 && result.reason === "device-mismatch") {
    return "登录设备与当前浏览器不匹配，请在签到页面退出并重新登录后重试。";
  }
  return typeof result.message === "string" && result.message.trim() ? result.message : fallback;
}

// 与官网 checkinProof 一致：SHA-256(nonce + ".glados-observe-v1")。
async function checkinProof(nonce) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${nonce}.glados-observe-v1`));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function prepareChallenge() {
  // nonce 只用一次。若等待期间过期，重新领取，最多尝试两次。
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await requestJSON("/user/checkin/challenge");
    if (result.code !== 0) throw new Error(serverMessage(result, "获取机器人挑战失败，请打开签到页面检查登录状态。"));
    if (typeof result.nonce !== "string" || !result.nonce.trim()) throw new Error("机器人挑战缺少 nonce，未提交签到。");
    const ttl = result.ttl || 300000;
    if (!Number.isFinite(ttl) || ttl <= CHALLENGE_DELAY_MS + CHALLENGE_MARGIN_MS) {
      throw new Error("机器人挑战有效期异常，请稍后重试。");
    }
    const receivedAt = Date.now();
    await new Promise(resolve => setTimeout(resolve, CHALLENGE_DELAY_MS));
    const proof = await checkinProof(result.nonce);
    if (Date.now() - receivedAt < ttl - CHALLENGE_MARGIN_MS) return { nonce: result.nonce, proof };
  }
  throw new Error("机器人挑战已过期，请重试签到。");
}

// 手动与自动共用进行中的任务，避免同时提交或重复消费 nonce。
function performFetch(notifyEnabled, isManual = false) {
  if (checkInFlight) return checkInFlight;
  checkInFlight = runCheckIn(notifyEnabled, isManual).finally(() => { checkInFlight = null; });
  return checkInFlight;
}

async function runCheckIn(notifyEnabled, isManual) {
  let success = false;
  let message;
  // 使用请求开始日期，跨午夜完成时不会误标记第二天已经签到。
  const today = localDate();
  try {
    const challenge = await prepareChallenge();
    const result = await requestJSON("/user/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8" },
      body: JSON.stringify({ token: "glados.cloud", ...challenge })
    });
    // 官网以 code === 0 判定成功，repeated 仅表示重复签到，不能单独证明成功。
    success = result.code === 0;
    message = serverMessage(result, success ? (result.repeated ? "今日已签到。" : "签到成功。") : "签到失败，请打开签到页面查看。");
    if (success) {
      await chrome.storage.local.set({ lastCheckInDate: today });
      if (typeof result.points === "number" && !result.repeated) message += `（本次积分：${result.points}）`;
    }
  } catch (error) {
    message = error.name === "AbortError" ? "请求超时，稍后将重试。" : (error.message || "网络连接失败，稍后将重试。");
  }
  await saveHistory(`[${isManual ? "手动" : "自动"}] ${success ? "成功" : "失败"}：${message}`);
  if (notifyEnabled !== false) {
    try {
      await chrome.notifications.create({
        type: "basic", iconUrl: "icon.png",
        title: isManual ? "GLaDOS 手动签到结果" : "GLaDOS 自动签到结果",
        message
      });
    } catch (error) {
      console.error("显示通知失败:", error);
    }
  }
  return { success, message };
}

async function saveHistory(msg) {
  try {
    const data = await chrome.storage.local.get({ history: [] });
    const history = Array.isArray(data.history) ? data.history : [];
    await chrome.storage.local.set({ history: [{ time: new Date().toLocaleString(), result: msg }, ...history].slice(0, 30) });
  } catch (error) {
    console.error("保存历史记录失败:", error);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== "forceCheckIn") return false;
  chrome.storage.local.get(["notifyEnabled"])
    .then(data => performFetch(data.notifyEnabled, true))
    .then(sendResponse)
    .catch(() => sendResponse({ success: false, message: "执行签到失败，请稍后重试。" }));
  return true;
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
