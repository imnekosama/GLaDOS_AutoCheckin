// 当插件安装或浏览器启动时，设置一个定时器
chrome.runtime.onInstalled.addListener(() => {
  console.log("插件已安装，配置伪装规则...");
  
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
      urlFilter: 'glados.cloud/api/user/checkin',
      resourceTypes: ['xmlhttprequest']
    }
  }];

  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: RULES
  });

  chrome.alarms.create("checkInAlarm", { periodInMinutes: 60 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkInAlarm") {
    tryCheckIn();
  }
});

// 签到逻辑函数
async function tryCheckIn() {
  // 读取重试次数和重试日期
  const data = await chrome.storage.local.get(["notifyEnabled", "lastCheckInDate", "targetHour", "retryCount", "lastRetryDate"]);
  
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const currentHour = now.getHours();
  const targetHour = data.targetHour || 9;

  // 判断是否是新的一天，如果是，重置重试次数
  let currentRetryCount = (data.lastRetryDate === today) ? (data.retryCount || 0) : 0;

  // 判断逻辑：今天没签过，且到了时间
  if (data.lastCheckInDate !== today && currentHour >= targetHour) {
    
    // 如果今天已经重试超过 3 次，强制停止，防止死循环
    if (currentRetryCount >= 3) {
      console.warn("今日签到失败次数已达上限(3次)，放弃继续尝试。");
      return; 
    }

    performFetch(today, data.notifyEnabled, currentRetryCount);
  }
}

// 实际发送签到请求的函数
function performFetch(today, notifyEnabled, currentRetryCount) {
  fetch("https://glados.cloud/api/user/checkin", {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8" },
    credentials: 'include', 
    body: JSON.stringify({ token: "glados.cloud" })
  })
  .then(response => response.json())
  .then(result => {
    console.log("服务器返回:", result);
    let statusMsg = result.message || "未知状态";
    
    // 转换为小写，增加容错率
    const msgLower = statusMsg.toLowerCase();
    
    // 1. 判断是否成功或已签到 (优先依靠 code，辅以文字保底)
    // 根据经验，code 0 通常是成功。如果将来抓包发现重复签到 code 是 1，可以改成 result.code === 0 || result.code === 1
    const isSuccess = result.code === 0 || msgLower.includes("repeat") || msgLower.includes("tomorrow") || msgLower.includes("logged");
    
    // 2. 判断致命错误 (Token失效)
    const isTokenError = result.code === -2 || msgLower.includes("token");

    if (isSuccess) {
       console.log("✅ 签到成功/已签到！");
       saveHistory(statusMsg);
       chrome.storage.local.set({ lastCheckInDate: today });
       showNotification(notifyEnabled, statusMsg);

    } else if (isTokenError) {
       console.log("❌ 致命错误：Token已失效！");
       saveHistory("❌ Token失效，请重新登录");
       // 致命错误：假装今天已经签到了，阻断重试
       chrome.storage.local.set({ lastCheckInDate: today }); 
       // 给出强烈警告
       showNotification(notifyEnabled, "⚠️ 签到失败：Token已失效，请打开浏览器重新登录 GLaDOS！");

    } else {
       console.log(`⚠️ 未知服务器错误，增加重试次数 (${currentRetryCount + 1}/3)`);
       saveHistory(`⚠️ 异常: ${statusMsg} (等待重试)`);
       // 累加重试次数，允许下个闹钟再次尝试
       chrome.storage.local.set({ 
         retryCount: currentRetryCount + 1,
         lastRetryDate: today
       });
       showNotification(notifyEnabled, `⚠️ 签到遇到未知情况，系统将在下小时重试。信息: ${statusMsg}`);
    }
  })
  .catch(error => {
    console.error("网络请求发生错误:", error);
    saveHistory(`网络连接失败 (等待重试 ${currentRetryCount + 1}/3)`);
    // 网络错误也累加重试次数
    chrome.storage.local.set({ retryCount: currentRetryCount + 1, lastRetryDate: today });
  });
}

// 提取通知代码
function showNotification(notifyEnabled, msg) {
  // 如果用户开启了通知，直接触发桌面气泡
  if (notifyEnabled !== false) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png", 
      title: "GLaDOS 签到结果",
      message: msg
    });
  }
}

// 保存历史记录的函数
async function saveHistory(msg) {
  const data = await chrome.storage.local.get({ history: [] });
  const newRecord = { time: new Date().toLocaleString(), result: msg };
  const newHistory = [newRecord, ...data.history].slice(0, 30);
  chrome.storage.local.set({ history: newHistory });
}

// 监听来自设置页面的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "forceCheckIn") {
    console.log("收到强制测试指令");
    const today = new Date().toISOString().split('T')[0];
    
    // 测试时，不传递重试次数，强制认为它是 0，确保测试总能发出去
    chrome.storage.local.get(["notifyEnabled"], (data) => {
      performFetch(today, data.notifyEnabled, 0);
    });
    sendResponse({ status: "processing" });
  }
  return true; 
});

// 监听浏览器图标点击事件
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});