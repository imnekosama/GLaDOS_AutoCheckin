// ============================================================================
// 文件名：background.js
// 作用：插件的后台常驻服务脚本（Service Worker），负责定时闹钟、随机时间调度和拟人化签到
// ============================================================================

// 【辅助工具 1】延时等待函数（模拟人类停顿思考）
// 参数 ms：需要等待的毫秒数（1000 毫秒 = 1 秒）
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 【辅助工具 2】获取本地时区的今日日期字符串（格式如："2026-11-08"）
function getTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  // getMonth() 返回的是 0~11，所以要 +1；padStart(2, '0') 用于不足两位时在前面补 0
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 【核心安全配置】确保请求头伪装规则始终生效的函数
// 作用：给插件发出的所有 /api/user/ 请求自动加上官网的 Origin 和 Referer，防止被识别为无头脚本
async function ensureHeaderRules() {
  try {
    const RULES = [{
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Origin', operation: 'set', value: 'https://glados.cloud' },
          { header: 'Referer', operation: 'set', value: 'https://glados.cloud/console/checkin' }
        ]
      },
      condition: {
        // 拦截所有 glados.cloud/api/user/ 下的接口（包含 checkin、challenge、points、iqi 等）
        urlFilter: 'glados.cloud/api/user/',
        resourceTypes: ['xmlhttprequest', 'other']
      }
    }];

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
      addRules: RULES
    });
    console.log("[安全伪装] 请求头伪装规则已确认生效。");
  } catch (error) {
    console.error("[安全伪装] 配置伪装规则时发生错误:", error);
  }
}

// 【核心加密函数】计算 GLaDOS 官方防伪签名 (checkinProof)
// 原理：还原官网 630 模块，将服务器发来的随机码 nonce 与固定盐值拼接后计算 SHA-256 哈希
async function calculateCheckinProof(nonce) {
  try {
    // 官网源码中用 ASCII 数字隐藏的固定暗号
    const secretSalt = "glados-observe-v1";
    // 按照官网要求，使用英文句号拼接
    const rawText = `${nonce}.${secretSalt}`;

    // 使用浏览器原生的加密接口计算 SHA-256
    const msgBuffer = new TextEncoder().encode(rawText);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);

    // 将计算出的二进制字节流转换为 64 位十六进制字符串
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const proofHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return proofHex;
  } catch (error) {
    console.error("[加密计算] 计算防伪签名 proof 时出错:", error);
    return "";
  }
}

// ============================================================================
// 生命周期与闹钟监听区域
// ============================================================================

// 1. 当插件安装或更新时触发
chrome.runtime.onInstalled.addListener(async () => {
  console.log("插件已安装或更新，正在初始化配置...");
  await ensureHeaderRules();

  // 创建主巡检闹钟：1 分钟后首次触发，之后每 30 分钟巡检一次
  chrome.alarms.create("checkInAlarm", { delayInMinutes: 1, periodInMinutes: 30 });

  // 安装或更新完成后，立即检查一次是否需要签到
  tryCheckIn();
});

// 2. 监听浏览器启动事件 (Chrome 启动时触发)
chrome.runtime.onStartup.addListener(async () => {
  console.log("检测到浏览器启动，正在恢复伪装规则并检查签到条件...");
  await ensureHeaderRules();
  tryCheckIn();
});

// 3. 监听所有闹钟触发事件
chrome.alarms.onAlarm.addListener(async (alarm) => {
  // 情况 A：常规巡检闹钟响起
  if (alarm.name === "checkInAlarm") {
    console.log("定时巡检闹钟触发，开始检查签到条件...");
    tryCheckIn();
  } 
  // 情况 B：每日随机延迟闹钟响起（真正开始执行自动签到的时刻！）
  else if (alarm.name === "randomDelayAlarm") {
    console.log("⏰ 随机延迟时间已到！准备执行拟人化自动签到...");
    const data = await chrome.storage.local.get(["notifyEnabled", "lastCheckInDate"]);
    const today = getTodayString();

    if (data.lastCheckInDate !== today) {
      // 再额外加入 1 ~ 25 秒的随机秒级停顿，让触发的“秒数”也完全随机
      const randomSecondsMs = Math.floor(Math.random() * 25000) + 1000;
      console.log(`额外等待 ${(randomSecondsMs / 1000).toFixed(1)} 秒以打乱秒级规律...`);
      await sleep(randomSecondsMs);

      // 执行正式自动签到（第三个参数 false 代表自动签到）
      await performFetch(today, data.notifyEnabled, false);
    } else {
      console.log("今日已完成自动签到，取消本次随机闹钟任务。");
    }
  }
});

// ============================================================================
// 自动签到条件判断与随机时间调度
// ============================================================================

async function tryCheckIn() {
  try {
    await ensureHeaderRules();

    const data = await chrome.storage.local.get([
      "notifyEnabled", 
      "lastCheckInDate", 
      "targetHour",
      "scheduledRandomDate"
    ]);

    const now = new Date();
    const today = getTodayString();
    const currentHour = now.getHours();
    const targetHour = data.targetHour !== undefined ? Number(data.targetHour) : 9;

    console.log(`[状态检查] 今日:${today}, 上次签到:${data.lastCheckInDate}, 当前小时:${currentHour}, 目标小时:${targetHour}`);

    // 如果今天已经签过到了，直接结束
    if (data.lastCheckInDate === today) {
      console.log("今日已完成签到，无需重复执行。");
      return;
    }

    // 如果当前时间还没有到设定的目标小时，继续等待
    if (currentHour < targetHour) {
      console.log("尚未到达设定的签到小时，继续等待。");
      return;
    }

    // 【区分“准点随机触发”与“晚开电脑补签”】
    if (currentHour === targetHour) {
      // 正好处于设定的那个小时内（比如设定 9 点，现在是 9 点多）
      // 检查是否已经安排了随机延迟闹钟
      const existingAlarm = await chrome.alarms.get("randomDelayAlarm");
      if (existingAlarm) {
        const triggerTime = new Date(existingAlarm.scheduledTime).toLocaleTimeString();
        console.log(`今日随机签到闹钟已在排队中，将于 ${triggerTime} 触发。`);
        return;
      }

      // 计算当前小时还剩下多少分钟，生成一个随机分钟数（至少 1 分钟，最多不超过剩余分钟数或 45 分钟）
      const remainingMinutes = Math.max(2, 58 - now.getMinutes());
      const maxRandomMinutes = Math.min(45, remainingMinutes);
      // 生成带小数的随机分钟（例如 14.37 分钟，即 14 分 22 秒后触发！）
      const randomDelayMinutes = Number((Math.random() * (maxRandomMinutes - 1) + 1).toFixed(2));

      chrome.alarms.create("randomDelayAlarm", { delayInMinutes: randomDelayMinutes });
      await chrome.storage.local.set({ scheduledRandomDate: today });

      console.log(`🎲 [拟人调度] 已生成今日随机签到计划！将在 ${randomDelayMinutes} 分钟后自动执行。`);
    } else {
      // currentHour > targetHour：说明用户今天开电脑/打开浏览器时，已经错过了设定的那个小时
      // 触发“自动补签机制”：随机等待 5 ~ 20 秒（等浏览器网络稳定）后立刻补签
      console.log("检测到已超过设定小时且今日未签，启动【自动补签】流程...");
      const catchUpWaitMs = Math.floor(Math.random() * 15000) + 5000;
      console.log(`等待 ${(catchUpWaitMs / 1000).toFixed(1)} 秒后立即执行补签...`);
      await sleep(catchUpWaitMs);
      await performFetch(today, data.notifyEnabled, false);
    }

  } catch (error) {
    console.error("执行 tryCheckIn 检查时发生错误:", error);
  }
}

// ============================================================================
// 核心拟人化签到请求函数
// ============================================================================

// 参数说明：
// today: 今日日期字符串
// notifyEnabled: 是否开启桌面通知
// isManual: 是否为手动点击测试（默认 false）
async function performFetch(today, notifyEnabled, isManual = false) {
  const modeText = isManual ? '手动测试' : '自动签到';

  try {
    await ensureHeaderRules();
    console.log(`[${modeText}] 第 1 步：模拟真人打开网页，同步加载面板数据与防伪题目...`);

    // 模拟真实浏览器打开 /console/checkin 页面时同时发出的 4 个请求
    // 使用 .catch(() => null) 确保即便前三个辅助请求偶发超时，也不会影响第 4 个核心 challenge 请求
    const [pointsRes, iqiRes, trendRes, challengeRes] = await Promise.all([
      fetch("https://glados.cloud/api/user/points", { method: "GET", credentials: "include" }).catch(() => null),
      fetch("https://glados.cloud/api/user/iqi", { method: "GET", credentials: "include" }).catch(() => null),
      fetch("https://glados.cloud/api/user/points/trend?days=30", { method: "GET", credentials: "include" }).catch(() => null),
      fetch("https://glados.cloud/api/user/checkin/challenge", {
        method: "GET",
        headers: { "Accept": "application/json, text/plain, */*" },
        credentials: "include"
      })
    ]);

    // 【未登录防御检查 1】如果 HTTP 状态码为 401/403 或发生重定向，判定为未登录
    if (challengeRes.status === 401 || challengeRes.status === 403 || challengeRes.redirected) {
      await handleNotLoggedIn(modeText, notifyEnabled, isManual);
      return;
    }

    // 【未登录防御检查 2】安全解析 JSON，如果返回的不是 JSON（比如返回了登录网页 HTML），判定为未登录
    let challengeData = null;
    try {
      challengeData = await challengeRes.json();
    } catch (parseErr) {
      await handleNotLoggedIn(modeText, notifyEnabled, isManual);
      return;
    }

    console.log(`[${modeText}] 第 2 步：成功获取到 challenge 响应:`, challengeData);

    // 【未登录防御检查 3】如果服务器返回的业务状态码 code 不为 0（例如 -2 没有权限），说明尚未登录官网
    if (!challengeData || challengeData.code !== 0) {
      await handleNotLoggedIn(modeText, notifyEnabled, isManual);
      return;
    }

    // 准备最终要提交给签到接口的数据包
    const checkinPayload = {
      token: "glados.cloud"
    };

    // 如果成功获取到一次性随机码 nonce，执行拟人停顿并计算加密证明 proof
    if (challengeData.nonce) {
      // 生成 3500 毫秒 ~ 7500 毫秒（3.5 秒 ~ 7.5 秒）之间的随机阅读停顿
      // 既能稳稳跨过官方 2.5 秒的防脚本陷阱，每次停顿时长又完全不同
      const randomWaitMs = Math.floor(Math.random() * (7500 - 3500 + 1)) + 3500;
      console.log(`[${modeText}] 第 3 步：模拟人类看页面找按钮，随机停顿 ${(randomWaitMs / 1000).toFixed(2)} 秒...`);
      await sleep(randomWaitMs);

      // 计算 SHA-256 防伪签名
      const proof = await calculateCheckinProof(challengeData.nonce);
      console.log(`[${modeText}] 第 4 步：防伪签名计算完毕，proof:`, proof);

      checkinPayload.nonce = challengeData.nonce;
      checkinPayload.proof = proof;
    } else {
      console.warn(`[${modeText}] 未能获取到有效 nonce，等待 3.5 秒后尝试基础签到...`);
      await sleep(3500);
    }

    console.log(`[${modeText}] 第 5 步：模拟点击签到按钮，正在提交数据:`, checkinPayload);

    // 发送正式的 POST 签到请求
    const checkinResponse = await fetch("https://glados.cloud/api/user/checkin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        "Accept": "application/json, text/plain, */*"
      },
      credentials: "include",
      body: JSON.stringify(checkinPayload)
    });

    const result = await checkinResponse.json();
    console.log(`[${modeText}] 第 6 步：服务器返回最终签到结果:`, result);

    // 提取状态消息，如果有 points 字段则一并显示在日志里，方便查看本次拿了多少分
    let statusMsg = result.message || "未知返回状态";
    if (result.points !== undefined && Number(result.points) > 0) {
      statusMsg += ` (本次获得: +${Number(result.points)} 点)`;
    } else if (result.list && result.list.length > 0 && result.code === 0) {
      // 如果 points 字段没直接给，尝试从返回的最新流水第 0 项里读取变动点数
      const latestChange = parseInt(result.list[0].change, 10);
      if (!isNaN(latestChange) && latestChange > 0) {
        statusMsg += ` (本次获得: +${latestChange} 点)`;
      }
    }

    // 保存到本地历史记录
    await saveHistory(`[${isManual ? '手动' : '自动'}] ` + statusMsg);

    // 只有在“不是手动测试”的情况下，才更新最后签到日期标识
    if (!isManual) {
      const msgLower = statusMsg.toLowerCase();
      if (
        result.code === 0 || 
        msgLower.includes("checkin") || 
        msgLower.includes("points") || 
        msgLower.includes("repeat") || 
        msgLower.includes("tomorrow") || 
        msgLower.includes("logged")
      ) {
        await chrome.storage.local.set({ lastCheckInDate: today });
        console.log("[状态更新] 已成功记录今日自动签到日期标识:", today);
      }
    } else {
      console.log("[状态更新] 本次为手动测试，不修改自动签到日期标识。");
    }

    // 弹出系统桌面通知
    if (notifyEnabled !== false) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icon.png",
        title: isManual ? "GLaDOS 手动测试结果" : "GLaDOS 自动签到结果",
        message: statusMsg
      });
    }

  } catch (error) {
    console.error(`[${modeText}] 网络请求或处理过程发生错误:`, error);
    await saveHistory(`[${isManual ? '手动' : '自动'}] 网络连接或解析失败`);
  }
}

// 【新增辅助函数】统一处理后台检测到未登录官网时的日志记录与通知提醒
async function handleNotLoggedIn(modeText, notifyEnabled, isManual) {
  const notLoginMsg = "签到失败：检测到当前浏览器未登录 GLaDOS 官网，请先前往官网登录账号！";
  console.warn(`[${modeText}] ${notLoginMsg}`);
  await saveHistory(`[${isManual ? '手动' : '自动'}] ⚠️ ` + notLoginMsg);

  if (notifyEnabled !== false) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title: "GLaDOS 签到失败 (未登录)",
      message: notLoginMsg
    });
  }
}

// ============================================================================
// 本地日志保存与消息通信区域
// ============================================================================

// 保存本地历史记录的函数（最多保留最近 30 条）
async function saveHistory(msg) {
  try {
    const data = await chrome.storage.local.get({ history: [] });
    const newRecord = {
      time: new Date().toLocaleString(),
      result: msg
    };
    const newHistory = [newRecord, ...data.history].slice(0, 30);
    await chrome.storage.local.set({ history: newHistory });
  } catch (error) {
    console.error("保存历史记录失败:", error);
  }
}

// 监听来自设置页面的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. 收到“手动测试签到”指令
  if (request.action === "forceCheckIn") {
    console.log("收到设置页发来的【手动测试签到】指令");
    const today = getTodayString();
    chrome.storage.local.get(["notifyEnabled"], (data) => {
      performFetch(today, data.notifyEnabled, true);
    });
    sendResponse({ status: "processing" });
  } 
  // 2. 收到“更新了设置时间”指令，重新检查并安排闹钟
  else if (request.action === "rescheduleAlarm") {
    console.log("收到设置更改通知，正在重新检查签到计划...");
    chrome.alarms.clear("randomDelayAlarm", () => {
      tryCheckIn();
    });
    sendResponse({ status: "rescheduled" });
  }
  return true;
});

// 监听插件图标左键点击事件：直接打开设置页
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});