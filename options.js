// 当页面打开时，读取保存的值并显示
document.addEventListener('DOMContentLoaded', async () => {
  // 1. 获取所有需要的数据
  const data = await chrome.storage.local.get({
    targetHour: 9,
    notifyEnabled: true,
    history: []
  });

  // 恢复用户的设置选项
  document.getElementById('targetHour').value = data.targetHour;
  document.getElementById('notifyToggle').checked = data.notifyEnabled;

  // 2. 显示最近 30 次签到历史
  const list = document.getElementById('historyList');
  if (data.history.length === 0) {
    list.innerHTML = '<li>暂无签到日志</li>';
  } else {
    data.history.forEach(item => {
      const li = document.createElement('li');
      li.textContent = `[${item.time}] ${item.result}`;
      list.appendChild(li);
    });
  }
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

// 等待完整挑战和签到结果，不再固定两秒后刷新。
document.getElementById('testBtn').addEventListener('click', async () => {
  const button = document.getElementById('testBtn');
  button.disabled = true;
  button.textContent = '正在完成挑战并签到…';
  try {
    const result = await chrome.runtime.sendMessage({ action: 'forceCheckIn' });
    alert(result?.message || '未收到签到结果，请查看历史记录。');
    location.reload();
  } catch (error) {
    alert('无法执行签到：' + error.message);
  } finally {
    button.disabled = false;
    button.textContent = '手动测试签到';
  }
});
