// 当插件安装或更新时触发
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

  // 创建一个每 60 分钟触发一次的闹钟
  console.log("插件已安装，正在设置闹钟...");
  // 增加 delayInMinutes: 1。
  // 安装后 1 分钟就会触发第一次闹钟，之后每 60 分钟循环一次。
  chrome.alarms.create("checkInAlarm", { delayInMinutes: 1, periodInMinutes: 60 });

  // 安装或更新完成后，立刻主动检查一次是否需要签到！
  tryCheckIn();
});

// 监听浏览器启动事件 (Chrome 启动时触发)
// 即使错过了闹钟，只要一打开浏览器，就会立刻检查并补签。
chrome.runtime.onStartup.addListener(() => {
  console.log("检测到浏览器启动，开始检查签到条件...");
  tryCheckIn();
});

// 监听闹钟触发 (依靠闹钟补偿机制)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkInAlarm") {
    console.log("定时闹钟触发，开始检查签到条件...");
    tryCheckIn();
  }
});

// 签到逻辑函数 (自动签到的入口)
async function tryCheckIn() {
  try {
    const data = await chrome.storage.local.get(["notifyEnabled", "lastCheckInDate", "targetHour"]);
    
    // 【修复时区Bug】获取本地时区的年月日
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const today = `${year}-${month}-${day}`; 
    
    const currentHour = now.getHours();
    const targetHour = data.targetHour !== undefined ? data.targetHour : 9;

    console.log(`[状态检查] 今日:${today}, 上次自动签到:${data.lastCheckInDate}, 当前小时:${currentHour}, 目标小时:${targetHour}`);

    if (data.lastCheckInDate !== today && currentHour >= targetHour) {
      console.log("满足自动签到条件，准备发送请求...");
      // 【关键修改】第三个参数传入 false，表示这是自动签到
      performFetch(today, data.notifyEnabled, false);
    } else {
      console.log("未满足自动签到条件，继续等待。");
    }
  } catch (error) {
    console.error("执行 tryCheckIn 时发生错误:", error);
  }
}

// 实际发送签到请求的函数
// 【新增参数】 isManual：默认值为 false，用来判断是否为手动点击的测试
function performFetch(today, notifyEnabled, isManual = false) {
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
    // 在控制台打印，方便调试时区分
    console.log(`[${isManual ? '手动测试' : '自动签到'}] 服务器返回完整结果:`, result);
    
    let statusMsg = result.message;
    // 在历史记录中增加前缀，方便在选项页查看时区分
    saveHistory(`[${isManual ? '手动' : '自动'}] ` + statusMsg);
    
    // 【核心修改】只有在“不是手动测试”的情况下，才去更新最后签到日期
    if (!isManual) {
        // 防无限循环逻辑
        const msgLower = statusMsg.toLowerCase();
        if (result.code === 0 || msgLower.includes("checkin") || msgLower.includes("points")|| msgLower.includes("repeat") || msgLower.includes("tomorrow") || msgLower.includes("logged")) {
           chrome.storage.local.set({ lastCheckInDate: today });
           console.log("已更新自动签到日期标识");
        }
    } else {
        console.log("本次为手动测试，不更新自动签到日期标识");
    }

    if (notifyEnabled !== false) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icon.png",
        // 弹窗标题也做一下区分
        title: isManual ? "GLaDOS 手动测试结果" : "GLaDOS 自动签到结果",
        message: statusMsg
      });
    }
  })
  .catch(error => {
    console.error("网络请求发生错误:", error);
    saveHistory(`[${isManual ? '手动' : '自动'}] 网络连接失败`);
  });
}

// 保存历史记录的函数
async function saveHistory(msg) {
  try {
    const data = await chrome.storage.local.get({ history: [] });
    const newRecord = {
      time: new Date().toLocaleString(),
      result: msg
    };
    // 只保留最近 30 条记录
    const newHistory = [newRecord, ...data.history].slice(0, 30);
    chrome.storage.local.set({ history: newHistory });
  } catch (error) {
    console.error("保存历史记录失败:", error);
  }
}

// 监听来自设置页面的消息 (手动签到的入口)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "forceCheckIn") {
    console.log("收到强制签到指令");
    // 手动签到也统一使用本地时间
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    chrome.storage.local.get(["notifyEnabled"], (data) => {
      // 【关键修改】第三个参数传入 true，明确告诉 performFetch 这是手动操作
      performFetch(today, data.notifyEnabled, true);
    });
    sendResponse({ status: "processing" });
  }
  return true; 
});

// 监听插件图标点击事件
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});