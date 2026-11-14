// ============================================================================
// 文件名：options.js
// 作用：负责插件设置页面的数据读取、服务器 30 天签到日历渲染、未登录检测、保存设置及手动测试倒计时
// ============================================================================

// 当设置页面打开时，自动执行初始化
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1. 从本地存储读取用户的设置与本地日志
    const data = await chrome.storage.local.get({
      targetHour: 9,
      notifyEnabled: true,
      history: []
    });

    // 恢复下拉框和复选框的选中状态
    document.getElementById('targetHour').value = data.targetHour;
    document.getElementById('notifyToggle').checked = data.notifyEnabled;

    // 2. 渲染本地最近 30 次签到历史日志
    renderLocalHistory(data.history);

    // 3. 向 GLaDOS 服务器请求真实积分与最近 30 天签到日历数据
    await loadServerCalendarData();

  } catch (error) {
    console.error("初始化设置页面时出错:", error);
  }
});

// ============================================================================
// 渲染本地历史日志列表的函数
// ============================================================================
function renderLocalHistory(historyArray) {
  const list = document.getElementById('historyList');
  list.innerHTML = ''; // 先清空列表

  if (!historyArray || historyArray.length === 0) {
    list.innerHTML = '<li>暂无本地签到日志</li>';
  } else {
    historyArray.forEach(item => {
      const li = document.createElement('li');
      li.textContent = `[${item.time}] ${item.result}`;
      list.appendChild(li);
    });
  }
}

// ============================================================================
// 从服务器获取积分与历史，并生成 30 天日历 UI（含未登录精准识别与友好提示）
// ============================================================================
async function loadServerCalendarData() {
  const pointsEl = document.getElementById('serverPoints');
  const streakEl = document.getElementById('serverStreak');
  const statusEl = document.getElementById('calendarStatus');
  const gridEl = document.getElementById('calendarGrid');
  const legendEl = document.getElementById('calendarLegend'); // 日历下方的图例容器

  // 【内部辅助函数】当检测到浏览器未登录官网时，统一调用此函数展示醒目提示
  function showNotLoggedInPrompt() {
    pointsEl.textContent = "未登录";
    pointsEl.style.color = "#d3084b"; // 将积分状态变为醒目的红色
    streakEl.textContent = "-";
    
    // 隐藏日历网格和下方的图例
    gridEl.style.display = "none";
    if (legendEl) legendEl.style.display = "none";

    // 在日历框位置显示清晰的未登录警告面板与官网登录引导链接
    statusEl.style.display = "block";
    statusEl.style.color = "#b82d43";
    statusEl.style.background = "#fff3f5";
    statusEl.style.border = "1px dashed #f5c2c7";
    statusEl.style.borderRadius = "8px";
    statusEl.style.padding = "16px 12px";
    statusEl.style.lineHeight = "1.7";
    statusEl.innerHTML = `
      <div style="font-size: 15px; font-weight: bold; margin-bottom: 6px;">
        ⚠️ 检测到当前浏览器尚未登录 GLaDOS 官方网站！
      </div>
      <div style="font-size: 13.5px; color: #333;">
        目前无法获取您的服务器积分与签到日历，且插件<b>无法为您执行每日自动签到</b>。<br>
        👉 请先点击前往 <a href="https://glados.cloud/console/checkin" target="_blank" style="font-weight: bold; text-decoration: underline;">https://glados.cloud/console/checkin</a> 登录您的账号，登录成功后再回到本页刷新即可。
      </div>
    `;
  }

  try {
    // 1. 向官网积分接口发送 GET 请求，携带当前浏览器的登录 Cookie
    const response = await fetch("https://glados.cloud/api/user/points", {
      method: "GET",
      headers: {
        "Accept": "application/json, text/plain, */*"
      },
      credentials: "include"
    });

    // 2. 防御检查一：如果 HTTP 状态码是 401(未授权)、403(禁止访问) 或被重定向到了登录页，说明未登录
    if (response.status === 401 || response.status === 403 || response.redirected) {
      console.warn("服务器返回未授权或重定向状态，判定为未登录官网。");
      showNotLoggedInPrompt();
      return;
    }

    // 3. 防御检查二：尝试将返回内容解析为 JSON（如果未登录时服务器返回了 HTML 登录页面，捕获报错并判定为未登录）
    let data = null;
    try {
      data = await response.json();
    } catch (parseError) {
      console.warn("服务器返回的数据不是有效的 JSON，判定为尚未登录官网:", parseError);
      showNotLoggedInPrompt();
      return;
    }

    console.log("从服务器获取到的积分与历史数据:", data);

    // 4. 防御检查三：如果返回的 JSON 中 code 不为 0（例如 code: -2 代表没有权限/未登录）
    if (!data || data.code !== 0) {
      console.warn("服务器返回业务状态码非 0，判定为未登录官网:", data);
      showNotLoggedInPrompt();
      return;
    }

    // ====================================================
    // 以下为【已成功登录】后的正常渲染逻辑
    // ====================================================
    pointsEl.style.color = "#0f76eb"; // 恢复正常蓝色字体
    if (legendEl) legendEl.style.display = "flex"; // 恢复显示底部图例

    // 1. 显示当前服务器总积分（取整数部分）与连续签到天数
    const currentPoints = Math.floor(Number(data.points) || 0);
    pointsEl.textContent = `${currentPoints} 点`;
    streakEl.textContent = data.streak !== undefined ? data.streak : 0;

    // 2. 整理服务器返回的 history 流水，筛选出所有签到记录
    const checkinMap = {};
    const historyList = data.history || [];

    historyList.forEach(item => {
      if (item.business && item.business.indexOf("checkin") !== -1) {
        const recordDate = new Date(Number(item.time));
        const dateKey = `${recordDate.getFullYear()}-${recordDate.getMonth() + 1}-${recordDate.getDate()}`;
        const pointsChange = parseInt(item.change, 10) || 0;
        checkinMap[dateKey] = pointsChange;
      }
    });

    // 3. 生成最近 30 天（从 29 天前到今天）的日历小方格
    gridEl.innerHTML = '';
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    for (let i = 29; i >= 0; i--) {
      const targetDate = new Date(todayDate);
      targetDate.setDate(targetDate.getDate() - i);

      const year = targetDate.getFullYear();
      const month = targetDate.getMonth() + 1;
      const day = targetDate.getDate();
      const dateKey = `${year}-${month}-${day}`;

      const isChecked = Object.prototype.hasOwnProperty.call(checkinMap, dateKey);
      const earnedPoints = checkinMap[dateKey] || 0;
      const isToday = (i === 0);

      // 创建单个日历格子元素
      const cell = document.createElement('div');
      cell.className = 'cal-day' + (isChecked ? ' checked' : '') + (isToday ? ' today' : '');
      cell.title = `${year}年${month}月${day}日：` + (isChecked ? `已签到 (+${earnedPoints}点)` : '未签到');

      // 格子上方的日期文字
      const dateSpan = document.createElement('span');
      dateSpan.className = 'cal-date';
      dateSpan.textContent = isToday ? `今日(${month}/${day})` : `${month}/${day}`;

      // 格子下方的点数文字
      const ptsSpan = document.createElement('span');
      ptsSpan.className = 'cal-pts';
      ptsSpan.textContent = isChecked ? `+${earnedPoints}pt` : '-';

      cell.appendChild(dateSpan);
      cell.appendChild(ptsSpan);
      gridEl.appendChild(cell);
    }

    // 隐藏状态提示框，正式展示日历网格
    statusEl.style.display = 'none';
    gridEl.style.display = 'grid';

  } catch (error) {
    // 只有当真正断网、代理未开启或域名无法访问时，才会进入这里
    console.error("连接 GLaDOS 服务器发生网络错误:", error);
    pointsEl.textContent = "连接失败";
    pointsEl.style.color = "#d3084b";
    if (legendEl) legendEl.style.display = "none";
    statusEl.style.display = "block";
    statusEl.style.color = "#d3084b";
    statusEl.textContent = "❌ 无法连接到 GLaDOS 服务器，请检查您的网络连接或代理设置后刷新本页。";
  }
}

// ============================================================================
// 保存设置按钮逻辑
// ============================================================================
document.getElementById('saveBtn').addEventListener('click', () => {
  const hour = parseInt(document.getElementById('targetHour').value, 10);
  const notify = document.getElementById('notifyToggle').checked;

  chrome.storage.local.set({
    targetHour: hour,
    notifyEnabled: notify
  }, () => {
    // 通知后台脚本重新根据新设定的小时安排闹钟
    chrome.runtime.sendMessage({ action: "rescheduleAlarm" });
    alert(`设置已保存！插件将每天在 ${hour}:00 后的随机时间尝试签到。`);
  });
});

// ============================================================================
// 手动测试按钮逻辑（带 12 秒动态倒计时反馈）
// ============================================================================
document.getElementById('testBtn').addEventListener('click', () => {
  const testBtn = document.getElementById('testBtn');
  
  // 1. 立即禁用按钮，防止重复点击
  testBtn.disabled = true;

  // 2. 向后台脚本发送手动签到指令
  chrome.runtime.sendMessage({ action: "forceCheckIn" }, () => {
    // 后台会静默打开页面加载 + 模拟真人观察(4.5~6.5秒) + 点击官方按钮等待响应，设置 12 秒倒计时确保全流程跑完
    let remainingSeconds = 12;
    testBtn.textContent = `⏳ 正在模拟真人操作 (${remainingSeconds}s)...`;

    const countdownTimer = setInterval(() => {
      remainingSeconds--;
      if (remainingSeconds > 0) {
        testBtn.textContent = `⏳ 正在模拟真人操作 (${remainingSeconds}s)...`;
      } else {
        clearInterval(countdownTimer);
        testBtn.textContent = "✅ 操作完成，正在刷新页面...";
        // 倒计时结束，自动刷新当前设置页，查看最新的日历与日志
        location.reload();
      }
    }, 1000);
  });
});