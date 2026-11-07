# GLaDOS 自动签到助手 (GLaDOS Checkin Helper)

![Version](https://img.shields.io/badge/version-1.5-blue.svg)
![Platform](https://img.shields.io/badge/platform-Chrome-orange.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/bebkcollfclnaamapnjcaggfkgdfkail.svg)](https://chromewebstore.google.com/detail/bebkcollfclnaamapnjcaggfkgdfkail)

这是一个轻量级的 Chrome 浏览器扩展程序，旨在帮助用户每天自动完成 GLaDOS 平台的签到任务，节省手动操作时间，防止遗忘。

## 📷 预览截图

![screenshot](screenshot.jpg)

## ✨ 功能特点

- **自动签到**：每天在您设定的时间段后自动执行签到。
- **智能重试**：基于 Chrome Alarms 机制，即使错过特定时间点，打开浏览器后也会自动补签。
- **历史记录**：本地保存最近 30 条签到日志，成功与否一目了然。
- **通知提醒**：支持可选的系统级别通知，即时反馈签到结果。
- **隐私安全**：纯本地运行，不收集任何用户账号数据。

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
2. 右键点击图标，选择 **“选项” (Options)**。
3. 在设置页面设定您期望的 **每天签到时间（0-23点）**。
4. 确保您在当前浏览器中已登录 `https://glados.cloud`。
5. 您可以点击“立即测试”来验证配置是否正确。

## 签到协议与验证

已按 2026-11-07 的 [官网签到页](https://glados.cloud/console/checkin)公开前端脚本适配：

- 先携带登录 Cookie 请求 `GET /api/user/checkin/challenge`，获取一次性 `nonce` 和毫秒单位的 `ttl`。
- 等待至少 2500 毫秒，计算 `SHA-256(nonce + ".glados-observe-v1")` 的小写十六进制摘要。
- 向 `POST /api/user/checkin` 提交 `{ token: "glados.cloud", nonce, proof }`。
- 只有 `code === 0` 才更新成功日期；成功响应的 `repeated` 表示当天已经签到。手动成功也更新日期，避免自动重复请求。
- 失败保留重试机会；登录失效、HTML 验证页和 `device-mismatch` 会提示到官网处理，不会标记签到成功。
- 手动和定时请求共用一个进行中的任务；请求超时为 15 秒，挑战过期时重新领取。

协议来源为官网 `main~21b3c6c3.91594a3a.chunk.js` 的 `loadChallenge/solveChallenge/checkin`，以及 `main~20e9f87d.a55a9a67.chunk.js` 的 `checkinProof`。未将网站脚本作为扩展远程代码执行。

运行回归测试：`node --test tests/checkin.test.cjs`。测试模拟接口和 Chrome API，不消耗真实签到机会。实际账号签到仍需在已登录的 Chrome 中加载扩展验证。

## 📂 文件结构

- `manifest.json`: 插件配置文件。
- `background.js`: 后台常驻脚本，负责定时闹钟和签到逻辑。
- `options.html/js`: 插件设置界面及历史记录展示。
- `PRIVACY_POLICY.md`: 隐私政策说明。
- `icon.png`: 程序图标文件。
- `screenshot.jpg`: 预览截图。
- `README.md`: 说明文档。
- `LICENSE`: 协议文件。

## ⚖️ 许可协议
本项目采用 [MIT License](LICENSE) 许可协议。仅供学习交流使用，请勿用于非法用途。

---

*注：本工具与 GLaDOS 官方无任何隶属关系。*

