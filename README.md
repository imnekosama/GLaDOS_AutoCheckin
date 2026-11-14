# GLaDOS 自动签到助手 (GLaDOS Checkin Helper)

![Version](https://img.shields.io/badge/version-1.5.1-blue.svg)
![Platform](https://img.shields.io/badge/platform-Chrome-orange.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/bebkcollfclnaamapnjcaggfkgdfkail.svg)](https://chromewebstore.google.com/detail/bebkcollfclnaamapnjcaggfkgdfkail)

这是一个轻量级的 Chrome 浏览器扩展程序，旨在帮助用户每天自动完成 GLaDOS 平台的签到任务，节省手动操作时间，防止遗忘。

## 📷 预览截图

![screenshot](screenshot.jpg)

## ✨ 功能特点

- **真实网页原生点击签到**：到达设定小时后，自动在随机的“分钟与秒数”静默打开官方签到页，模拟真人观察停留数秒后直接触发页面原生签到按钮，100% 兼容 Cloudflare 验证与官方防伪校验，稳定获取正常权重高分奖励（10~15点）。
- **智能自动补签**：基于 Chrome Alarms 机制，即使错过设定时间段才开启电脑与浏览器，也会在网络稳定后自动完成补签。
- **30天签到日历面板**：在设置页直观展示服务器当前总积分、连续签到天数，以及最近 30 天的服务器签到日历与每日获得的点数。
- **未登录状态检测**：当浏览器未登录官网或 Cookie 过期时，在设置页日历面板与桌面通知中提供清晰的登录引导提示。
- **本地历史记录**：本地保存最近 30 条签到执行日志，手动或自动状态一目了然。
- **通知提醒**：支持可选的系统级别桌面通知，即时反馈签到结果与获得点数。
- **隐私安全**：纯本地运行，不收集任何用户账号数据。

## 🆕 v1.5.1 更新日志

- **原生按钮点击引擎（解决 Cloudflare 拦截）**：重构底层执行方式，改为在官方签到页主环境（`MAIN World`）中直接触发原生 `.ckb` 签到按钮并旁听原生响应，彻底解决后台跨站请求或沙箱请求触发 `Cloudflare verification failed` 的问题。
- **新增服务器 30 天日历 UI**：在设置页面实时同步展示服务器当前积分、连续签到天数与最近 30 天签到点数日历。
- **新增拟人化随机时间调度**：引入每日随机分钟与随机秒数触发机制，消除固定时间点脚本特征。
- **优化交互体验**：新增“手动测试签到”按钮 12 秒动态倒计时反馈，以及未登录官网时的醒目警告提示。

## 🚀 安装说明

### 方式一：Chrome 商店安装（推荐）
- [点击前往 Chrome Web Store 下载](https://chromewebstore.google.com/detail/bebkcollfclnaamapnjcaggfkgdfkail)
- [![Chrome Web Store](https://img.shields.io/chrome-web-store/v/bebkcollfclnaamapnjcaggfkgdfkail.svg)](https://chromewebstore.google.com/detail/bebkcollfclnaamapnjcaggfkgdfkail)

### 方式二：开发者模式安装（手动）
1. 下载或克隆本仓库到本地。
2. 打开 Chrome 浏览器，进入 `chrome://extensions/`。
3. 开启右上角的 **“开发者模式”**。
4. 点击 **“加载已解压的扩展程序”**，选择本仓库文件夹。

## 🛠 使用方法

1. 安装完成后，在浏览器插件栏找到本插件图标。
2. 左键点击图标（或右键选择 **“选项” (Options)**）打开设置页面。
3. 在设置页面设定您期望的 **每天签到时间（0-23点）**。
4. 确保您在当前浏览器中已登录 `https://glados.cloud/console/checkin`。
5. 您可以点击“手动测试签到”按钮（等待 12 秒倒计时完成）来验证配置是否正确。

## 📂 文件结构

- `manifest.json`: 插件配置文件 (Manifest V3)。
- `background.js`: 后台常驻脚本，负责定时闹钟、随机调度和网页原生点击签到逻辑。
- `options.html/js`: 插件设置界面、服务器 30 天签到日历及本地历史记录展示。
- `PRIVACY_POLICY.md`: 隐私政策说明。
- `icon.png`: 程序图标文件。
- `screenshot.jpg`: 预览截图。
- `README.md`: 说明文档。
- `LICENSE`: 协议文件。

## ⚖️ 许可协议
本项目采用 [MIT License](LICENSE) 许可协议。仅供学习交流使用，请勿用于非法用途。

---

*注：本工具与 GLaDOS 官方无任何隶属关系。*