# 🚀 **Auto Refresh Pro**

**下一代网页智能刷新引擎**  
*Manifest V3 · AI 驱动 · 零侵入式监控*

![Version](https://img.shields.io/badge/Version-1.0.11-%2300ff9d?style=for-the-badge&logo=chrome) 
![Chrome](https://img.shields.io/badge/Chrome-Extension-%234285F4?style=for-the-badge&logo=googlechrome) 
![Manifest V3](https://img.shields.io/badge/Manifest-V3-%23FF4081?style=for-the-badge)

> **实时行情 · 动态监控 · 智能点击 · 悬浮赛博控制台**  
> 为高频数据页、内部系统、新闻监控而生。

---

### ✨ **视觉预览**

![Auto Refresh Pro Dashboard](https://via.placeholder.com/800x420/0a0a0a/00ff9d?text=AUTO+REFRESH+PRO+-+Cyberpunk+UI)  
*(悬浮控制窗 · 实时倒计时 · 暗黑赛博界面)*

**核心亮点**：
- **Neon 悬浮控制台**：右下角赛博朋克风格浮窗，一键掌控
- **智能 XPath 引擎**：可视化点选 + iframe 深度支持
- **变化感知监控**：AI 级内容 diff 检测，自动警报
- **跨标签智能调度**：多页面并行，永不冲突

---

## 🌌 **功能矩阵**

<div align="center">

| 特性 | 描述 | 赛博等级 |
|------|------|---------|
| **⚡ 定时全页刷新** | 秒级精准间隔，支持 `10s` / `2m` / 自定义 | ★★★★★ |
| **🔗 XPath 智能点击** | 可视化选取 + 自动 iframe 定位，模拟“加载更多” | ★★★★★ |
| **👁️ 区域监控模式** | 内容变化即时感知，语音+系统双通知 | ★★★★★ |
| **🪟 Neon 悬浮窗** | 实时倒计时 + 一键启停 + 状态可视化 | ★★★★☆ |
| **📡 浏览器角标倒计时** | 无需打开面板，随时掌握进度 | ★★★★☆ |
| **📋 多标签智能管理** | 活动页面一览，日志全记录 | ★★★★★ |
| **🛡️ 按域名独立缓存** | 每个网站拥有独立配置记忆 | ★★★★★ |

</div>

---

## 🎮 **极速上手**

### **1. 安装 (30秒)**
1. **克隆或下载** 本仓库
2. 打开 Chrome → `chrome://extensions/`
3. 开启 **开发者模式**
4. **加载已解压的扩展** → 选择 `Auto Refresh/` 文件夹
5. 固定插件到工具栏 → 开启你的赛博刷新之旅

---

### **2. 核心操作流程**

**设置刷新间隔**
- 支持快捷输入：`30s`、`5m`、`1h`
- 开启 **刷新上限** 防止无限循环

**智能刷新模式**
- **全页刷新**：经典模式
- **XPath 点击**：点击 **「选取」** → 鼠标悬停高亮 → 自动生成精准 XPath

**激活监控大脑**
1. 开启 **监控模式**
2. 选取监控区域（支持嵌套 iframe）
3. 设置 **语音警报** + **系统弹窗**
4. 自定义文案（支持域名独立）

**赛博悬浮窗**
- 右下角常驻控制台
- 实时倒计时 + 状态灯
- 一键重置间隔

---

## 🖼️ **界面一览**

**插件主面板**（暗黑 + 霓虹配色）
![Popup UI](https://via.placeholder.com/720x520/111111/00ff9d?text=Neon+Control+Panel)

**悬浮控制窗**
![Floating Window](https://via.placeholder.com/280x160/0a0a0a/00ffff?text=FLOATING+CYBER+HUD)

**日志页实时倒计时**
- 固定显示剩余时间
- 完整事件链记录（启动/刷新/变化/异常）

---

## 🔧 **技术栈**

- **Chrome Manifest V3** Service Worker
- **Chrome Alarms** + **Storage** 持久化
- **Content Script** 注入 + DOM 实时监控
- **XPath 2.0** 增强引擎
- **Web Speech API** 语音合成
- **Chrome Notifications** 系统级提醒

---

## 📁 **项目结构**

```bash
Auto Refresh/
├── manifest.json          # 核心配置
├── background.js          # 赛博大脑（Service Worker）
├── content.js             # 页面注入 + 悬浮窗 + XPath 引擎
├── popup.html/css/js      # Neon 主面板
├── preview.html           # UI 预览
├── icons/                 # 矢量霓虹图标集
└── AGENTS.md              # 架构文档
