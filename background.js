// ============================================================================
// 文件名：background.js
// 作用：插件的后台常驻服务脚本（Service Worker），负责定时闹钟、随机时间调度和原生网页点击签到
// ============================================================================

// 【辅助工具 1】延时等待函数（模拟人类停顿思考）
// 参数 ms：需要等待的毫秒数（1000 毫秒 = 1 秒）
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 【辅助工具 2】获取本地时区的今日日期字符串（格式如："2026-11-13"）
function getTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  // getMonth() 返回的是 0~11，所以要 +1；padStart(2, '0') 用于不足两位时在前面补 0
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 【核心安全配置】确保请求头伪装规则始终生效的函数
// 作用：给插件发出的所有 /api/user/ 请求自动加上官网的 Origin 和 Referer
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
        // 拦截所有 glados.cloud/api/user/ 下的接口（包含设置页拉取日历数据的 points 接口等）
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
      // 再额外加入 1 ~ 20 秒的随机秒级停顿，让触发的“秒数”也完全随机
      const randomSecondsMs = Math.floor(Math.random() * 20000) + 1000;
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

    // 区分“准点随机触发”与“晚开电脑补签”
    if (currentHour === targetHour) {
      // 正好处于设定的那个小时内，检查是否已经安排了随机延迟闹钟
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
// 【终极破局引擎】在真实官网主环境（MAIN World）中直接触发官方原生签到按钮
// 原理：不再自己伪造 fetch 请求，而是直接点击网页上的 .ckb 签到按钮，由官网原版代码完成全部校验！
// ============================================================================
async function executeInRealWebPage(modeText) {
  let tempTabId = null;
  try {
    console.log(`[${modeText}] 正在后台打开官网签到页，准备触发官方原生签到按钮...`);

    // 1. 创建官网签到标签页（active: false 静默打开，不抢占用户焦点）
    const tab = await chrome.tabs.create({
      url: "https://glados.cloud/console/checkin",
      active: false
    });
    tempTabId = tab.id;

    // 2. 轮询等待页面彻底加载完成（监听 tab status 变为 complete，最多等 10 秒）
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      try {
        const currentTab = await chrome.tabs.get(tempTabId);
        if (currentTab && currentTab.status === "complete") {
          break;
        }
      } catch (e) {
        break;
      }
    }

    // 3. 页面加载完成后，先注入一段“可见性伪装与结果旁听器”到网页主世界 (world: "MAIN")
    // 作用：① 欺骗 Cloudflare 说当前标签页处于激活可见状态；② 旁听官网原版代码发出的 /api/user/checkin 响应
    await chrome.scripting.executeScript({
      target: { tabId: tempTabId },
      world: "MAIN", // 【核心关键】必须运行在网页主世界，与官网 React 和 Cloudflare 脚本同处一室
      func: () => {
        try {
          // 伪装页面可见性，防止后台标签页被 Cloudflare Turnstile 判定为挂机隐藏页
          Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
          Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
          document.dispatchEvent(new Event('visibilitychange'));
        } catch (e) {}

        // 初始化一个全局变量，用来存放一会儿官网自己签到后收到的服务器结果
        window.__gladosCheckinResult = null;

        // 挂载原生 XMLHttpRequest 和 fetch 旁听器（官网 Axios 底层走 XMLHttpRequest，双保险旁听）
        if (!window.__gladosHooked) {
          window.__gladosHooked = true;

          // 旁听 XMLHttpRequest
          const rawOpen = XMLHttpRequest.prototype.open;
          const rawSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this._requestUrl = url;
            return rawOpen.call(this, method, url, ...rest);
          };
          XMLHttpRequest.prototype.send = function(...args) {
            this.addEventListener('load', function() {
              try {
                // 当检测到官网自己的代码完成了 /user/checkin 请求时，把结果抄录下来
                if (this._requestUrl && this._requestUrl.includes('/user/checkin') && !this._requestUrl.includes('/challenge')) {
                  window.__gladosCheckinResult = JSON.parse(this.responseText);
                }
              } catch (e) {}
            });
            return rawSend.apply(this, args);
          };

          // 旁听原生 fetch（以防官网将来从 Axios 切换到 fetch）
          const rawFetch = window.fetch;
          window.fetch = async function(...args) {
            const response = await rawFetch.apply(this, args);
            try {
              const reqUrl = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
              if (reqUrl.includes('/user/checkin') && !reqUrl.includes('/challenge')) {
                const clone = response.clone();
                clone.json().then(data => {
                  window.__gladosCheckinResult = data;
                }).catch(() => {});
              }
            } catch (e) {}
            return response;
          };
        }
      }
    });

    // 4. 模拟真人在页面上自然停留 4.5 ~ 6.5 秒
    // 这段时间极其重要：官网页面会自动请求 points、iqi、challenge，且稳稳凑够官方要求的 2.5 秒以上停留时间！
    const humanWaitMs = Math.floor(Math.random() * 2000) + 4500;
    console.log(`[${modeText}] 页面已就绪，正在模拟真人观察页面 ${(humanWaitMs / 1000).toFixed(1)} 秒...`);
    await sleep(humanWaitMs);

    // 5. 在网页主世界中寻找官方的签到按钮（button.ckb）并直接模拟真实鼠标点击！
    const clickResult = await chrome.scripting.executeScript({
      target: { tabId: tempTabId },
      world: "MAIN",
      func: async () => {
        const sleepInPage = (ms) => new Promise(r => setTimeout(r, ms));

        // 检查是否被重定向到了登录页
        if (window.location.pathname.includes('login') || window.location.pathname.includes('authenticate')) {
          return { notLoggedIn: true };
        }

        // 寻找官网签到按钮（官网源码中签到按钮的 class 固定为 "ckb"）
        let checkinBtn = document.querySelector('button.ckb');
        // 如果页面渲染稍微慢了一点，再最多等 3 秒找一下按钮
        for (let w = 0; w < 6 && !checkinBtn; w++) {
          await sleepInPage(500);
          checkinBtn = document.querySelector('button.ckb');
        }

        if (!checkinBtn) {
          return { buttonNotFound: true };
        }

        // 如果按钮上已经有 "is-done" 类名，或者处于 disabled 状态，说明今天已经签过到了
        if (checkinBtn.classList.contains('is-done') || checkinBtn.disabled) {
          return {
            success: true,
            data: { code: 1, message: "Checkin Repeats! Please Try Tomorrow (今日已签到)" }
          };
        }

        // 触发完整的鼠标移动、按下、抬起和点击事件链（模拟 100% 真实的物理鼠标点击）
        const mouseEvents = ['mouseover', 'mouseenter', 'mousedown', 'mouseup', 'click'];
        mouseEvents.forEach(eventType => {
          const evt = new MouseEvent(eventType, {
            bubbles: true,
            cancelable: true,
            view: window
          });
          checkinBtn.dispatchEvent(evt);
        });

        // 点击按钮后，等待官网自己的代码把请求发出去并收到结果（最多轮询等待 8 秒）
        for (let i = 0; i < 16; i++) {
          await sleepInPage(500);
          if (window.__gladosCheckinResult) {
            return { success: true, data: window.__gladosCheckinResult };
          }
          // 如果按钮变成了 is-done 完成状态，也可以直接读取按钮上的文字作为保底结果
          if (checkinBtn.classList.contains('is-done')) {
            return {
              success: true,
              data: { code: 0, message: checkinBtn.innerText.trim() || "CheckIn! Get Points" }
            };
          }
        }

        return { success: false, error: "点击签到按钮后等待服务器响应超时" };
      }
    });

    if (clickResult && clickResult[0] && clickResult[0].result) {
      return clickResult[0].result;
    }
    return null;

  } catch (error) {
    console.error(`[${modeText}] 网页原生点击签到执行出错:`, error);
    return null;
  } finally {
    // 6. 签到完成后，再稍微停留 1 秒确保数据入库，然后自动关闭临时标签页
    await sleep(1000);
    if (tempTabId !== null) {
      try {
        await chrome.tabs.remove(tempTabId);
        console.log(`[${modeText}] 已自动清理并关闭临时签到标签页。`);
      } catch (closeErr) {}
    }
  }
}

// ============================================================================
// 主签到入口函数
// ============================================================================
async function performFetch(today, notifyEnabled, isManual = false) {
  const modeText = isManual ? '手动测试' : '自动签到';

  try {
    await ensureHeaderRules();
    console.log(`[${modeText}] 开始执行真实网页原生点击签到流程...`);

    // 调用上面的真实网页原生点击引擎
    const pageResult = await executeInRealWebPage(modeText);

    // 情况 1：明确检测到未登录官网
    if (pageResult && pageResult.notLoggedIn) {
      await handleNotLoggedIn(modeText, notifyEnabled, isManual);
      return;
    }

    // 情况 2：没找到按钮或超时（先通过 /api/user/points 确认是不是因为未登录导致的）
    if (!pageResult || pageResult.buttonNotFound || !pageResult.success) {
      const checkLoginRes = await fetch("https://glados.cloud/api/user/points", {
        method: "GET",
        credentials: "include"
      }).catch(() => null);

      if (checkLoginRes) {
        if (checkLoginRes.status === 401 || checkLoginRes.status === 403 || checkLoginRes.redirected) {
          await handleNotLoggedIn(modeText, notifyEnabled, isManual);
          return;
        }
        const loginData = await checkLoginRes.json().catch(() => null);
        if (!loginData || loginData.code !== 0) {
          await handleNotLoggedIn(modeText, notifyEnabled, isManual);
          return;
        }
      }

      const failMsg = (pageResult && pageResult.error) ? pageResult.error : "页面加载超时或未找到签到按钮，请稍后重试";
      await saveHistory(`[${isManual ? '手动' : '自动'}] ⚠️ ${failMsg}`);
      if (notifyEnabled !== false) {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon.png",
          title: isManual ? "GLaDOS 手动测试异常" : "GLaDOS 自动签到异常",
          message: failMsg
        });
      }
      return;
    }

    // 情况 3：成功拿到官网原生点击后的签到结果！
    const result = pageResult.data;
    console.log(`[${modeText}] 成功捕获官网原生签到结果:`, result);

    let statusMsg = (result && result.message) ? result.message : "签到完成";
    if (result && result.points !== undefined && Number(result.points) > 0) {
      statusMsg += ` (本次获得: +${Number(result.points)} 点)`;
    } else if (result && result.list && result.list.length > 0 && result.code === 0) {
      const latestChange = parseInt(result.list[0].change, 10);
      if (!isNaN(latestChange) && latestChange > 0) {
        statusMsg += ` (本次获得: +${latestChange} 点)`;
      }
    }

    // 保存到本地历史记录
    await saveHistory(`[${isManual ? '手动' : '自动'}] ` + statusMsg);

    // 只有在“不是手动测试”的情况下，且没有报 cloudflare 错误时，才更新今日已签到标识
    if (!isManual && result) {
      const msgLower = statusMsg.toLowerCase();
      if (
        !msgLower.includes("cloudflare") && (
          result.code === 0 || 
          msgLower.includes("checkin") || 
          msgLower.includes("points") || 
          msgLower.includes("repeat") || 
          msgLower.includes("tomorrow") || 
          msgLower.includes("logged") ||
          msgLower.includes("已签到")
        )
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
    console.error(`[${modeText}] 签到过程发生错误:`, error);
    await saveHistory(`[${isManual ? '手动' : '自动'}] 网络连接或解析失败`);
  }
}

// 统一处理后台检测到未登录官网时的日志记录与通知提醒
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