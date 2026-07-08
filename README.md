<div align="center">
  <h1>
    <img src="https://github.com/freewindes/Auto-Refresh-Pro/blob/main/icons/icon128.png" width="64" style="vertical-align:middle">
    <strong style="font-size: 3.2em; background: linear-gradient(90deg, #00d4ff, #0099ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
      Auto Refresh Pro
    </strong>
  </h1>
  
  <p><strong>智能网页自动刷新扩展</strong></p>
  <p>
    <img src="https://img.shields.io/badge/版本-1.0.11-%2300d4ff?style=for-the-badge" alt="Version">
    <img src="https://img.shields.io/badge/Chrome-Extension-%234285F4?style=for-the-badge&logo=googlechrome" alt="Chrome">
    <img src="https://img.shields.io/badge/Manifest-V3-%23FF6B6B?style=for-the-badge" alt="Manifest V3">
  </p>
  定时刷新 · XPath 智能点击 · 实时内容监控 · 悬浮控制窗
</div>



---

## 🌌 **功能矩阵**

<div align="center">


| 特性 | 描述 |
|------|------|
| **⚡ 定时全页刷新** | 秒级精准间隔，支持 `10s` / `2m` / 自定义 |
| **🔗 XPath 智能点击** | 可视化选取 + 自动 iframe 定位，模拟“加载更多” |
| **👁️ 区域监控模式** | 内容变化即时感知，语音+系统双通知 |
| **🪟 Neon 悬浮窗** | 实时倒计时 + 一键启停 + 状态可视化 |
| **📡 浏览器角标倒计时** | 无需打开面板，随时掌握进度 |
| **📋 多标签智能管理** | 活动页面一览，日志全记录 |
| **🛡️ 按域名独立缓存** | 每个网站拥有独立配置记忆 |

</div>

---

## 🎮 **极速上手**

### 安装步骤
1. 下载或克隆本仓库
2. 打开 Chrome 浏览器，访问 `chrome://extensions/`
3. 开启右上角**开发者模式**
4. 点击**加载已解压的扩展程序**，选择 `Auto Refresh/` 目录
5. 固定扩展图标到工具栏即可使用

---

## 📋 **主要功能使用**

### 1. 设置刷新间隔
- 支持手动输入秒数或快捷预设（`10s`、`30s`、`60s`、`2m`、`5m` 等）
- 可开启**刷新次数上限**，灵活控制

### 2. 选择刷新模式
- **全页刷新**：完整页面定时重载
- **XPath 点击**：点击**选取**按钮，在页面上选中目标元素（支持 iframe）

### 3. 开启监控模式
- 选取需要监控的页面区域
- 内容发生变化时自动触发通知
- 支持**语音提醒**和**浏览器系统通知**

### 4. 悬浮控制窗
- 在“间隔”页开启后，页面右下角显示简洁控制面板
- 实时显示状态、倒计时、启停按钮和间隔重置

### 5. 查看任务与日志
- **标签页**：列出所有正在运行的任务
- **日志页**：显示实时倒计时及详细操作记录

---

## 🛠️ **项目结构**

```text
Auto Refresh/
├── manifest.json          # Chrome 扩展核心配置
├── background.js          # 后台 Service Worker，管理定时与状态
├── content.js             # 页面注入脚本（XPath、悬浮窗、交互）
├── popup.html             # 插件弹窗界面
├── popup.css              # 界面样式
├── popup.js               # 弹窗逻辑与配置管理
├── preview.html           # UI 预览页面
├── AGENTS.md              # 项目架构说明
└── icons/                 # 扩展图标
