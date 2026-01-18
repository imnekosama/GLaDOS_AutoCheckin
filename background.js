// 当插件安装或浏览器启动时，设置一个定时器
chrome.runtime.onInstalled.addListener(() => {
  console.log("插件已安装，配置伪装规则...");
  
  // 【新增】配置伪装规则，解决 Origin 被拦截的问题
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
      resourceTypes: ['xmlhttprequest'] // fetch 在这里被视为 xmlhttprequest
    }
  }];

  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: RULES
  });

  console.log("插件已安装，正在设置闹钟...");
  chrome.alarms.create("checkInAlarm", { periodInMinutes: 60 });
});

// 监听闹钟触发
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkInAlarm") {
    tryCheckIn();
  }
});

// 签到逻辑函数
async function tryCheckIn() {
  // 1. 从存储中获取设置：是否开启提醒、上次签到日期、设定的签到小时
  const data = await chrome.storage.local.get(["notifyEnabled", "lastCheckInDate", "targetHour"]);
  
  const now = new Date();
  const today = now.toISOString().split('T')[0]; // 格式如 "2023-10-27"
  const currentHour = now.getHours();
  const targetHour = data.targetHour || 9; // 默认早上 9 点签到

  // 2. 判断逻辑：如果今天没签过，且到了或过了设定的时间
  if (data.lastCheckInDate !== today && currentHour >= targetHour) {
    performFetch(today, data.notifyEnabled);
  }
}

// 实际发送签到请求的函数
function performFetch(today, notifyEnabled) {
  fetch("https://glados.cloud/api/user/checkin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8"
    },
    credentials: 'include', 
    body: JSON.stringify({ 
      token: "glados.cloud" 
    })
  })
  .then(response => response.json())
  .then(result => {
    // 【新增】在后台控制台打印完整的服务器回包，方便我们调试
    console.log("服务器返回完整结果:", result);
    
    let statusMsg = result.message;
    saveHistory(statusMsg);
    
    // 如果 code 是 0，通常代表成功；或者是“重复签到”的提示
    if (result.code === 0 || statusMsg.includes("Repeat")) {
       chrome.storage.local.set({ lastCheckInDate: today });
    }

    if (notifyEnabled !== false) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icon.png",
        title: "GLaDOS 签到结果",
        message: statusMsg
      });
    }
  })
  .catch(error => {
    console.error("网络请求发生错误:", error);
    saveHistory("网络连接失败");
  });
}

// 保存历史记录的函数
async function saveHistory(msg) {
  const data = await chrome.storage.local.get({ history: [] });
  const newRecord = {
    time: new Date().toLocaleString(),
    result: msg
  };
  // 只保留最近 30 条记录
  const newHistory = [newRecord, ...data.history].slice(0, 30);
  chrome.storage.local.set({ history: newHistory });
}

// 监听来自设置页面的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "forceCheckIn") {
    console.log("收到强制签到指令");
    // 获取当前日期
    const today = new Date().toISOString().split('T')[0];
    // 直接执行签到逻辑，忽略时间检查和是否已签到的检查
    chrome.storage.local.get(["notifyEnabled"], (data) => {
      performFetch(today, data.notifyEnabled);
    });
    sendResponse({ status: "processing" });
  }
  return true; 
});

// 监听插件图标点击事件
chrome.action.onClicked.addListener(() => {
  // 当用户点击工具栏图标时，直接打开选项页面
  chrome.runtime.openOptionsPage();
});