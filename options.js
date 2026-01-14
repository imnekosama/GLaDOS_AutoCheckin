// 当页面打开时，读取保存的值并显示
document.addEventListener('DOMContentLoaded', async () => {
  const data = await chrome.storage.local.get({
    targetHour: 9,
    notifyEnabled: true,
    history: []
  });

  document.getElementById('targetHour').value = data.targetHour;
  document.getElementById('notifyToggle').checked = data.notifyEnabled;

  // 显示历史记录
  const list = document.getElementById('historyList');
  data.history.forEach(item => {
    const li = document.createElement('li');
    li.textContent = `[${item.time}] ${item.result}`;
    list.appendChild(li);
  });
});

// 保存设置
document.getElementById('saveBtn').addEventListener('click', () => {
  const hour = parseInt(document.getElementById('targetHour').value);
  const notify = document.getElementById('notifyToggle').checked;

  chrome.storage.local.set({
    targetHour: hour,
    notifyEnabled: notify
  }, () => {
    alert("设置已保存！插件将每天在 " + hour + " 点后尝试签到。");
  });
});

// 立即测试按钮的逻辑
document.getElementById('testBtn').addEventListener('click', () => {
  // 发送消息给后台脚本 background.js，让它立刻执行签到
  chrome.runtime.sendMessage({ action: "forceCheckIn" }, (response) => {
    alert("测试指令已发送，请检查下方历史记录或系统通知。");
    // 刷新一下页面看历史记录
    setTimeout(() => location.reload(), 2000);
  });
});