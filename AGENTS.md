# AGENTS.md - Auto Refresh Pro

## 项目概览
Chrome 浏览器插件，实现网页定时自动刷新功能。支持全页刷新和 XPath 模拟点击两种模式，自动检测页面 iframe。

## 技术栈
- Chrome Extension Manifest V3
- 原生 HTML/CSS/JavaScript（无框架依赖）
- Chrome Extension APIs: storage, tabs, scripting, alarms

## 文件结构
```
.
├── manifest.json       # 插件配置（Manifest V3）
├── background.js       # Service Worker：定时器管理、消息路由
├── content.js          # Content Script：XPath 点击、iframe 检测、元素选取器
├── popup.html          # 弹窗 UI 结构
├── popup.css           # 弹窗样式（冷色调主题）
├── popup.js            # 弹窗交互逻辑
├── preview.html        # 预览页面（非插件部分，用于展示 UI 效果）
└── icons/              # 插件图标
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 核心功能
1. **全页刷新模式**：按设定间隔刷新当前标签页
2. **XPath 点击模式**：按设定间隔对指定 XPath 元素执行模拟点击
3. **XPath 元素选取**：鼠标悬停高亮 + 点击选取，自动生成 XPath
4. **iframe 检测**：自动检测页面中的 iframe，支持选择在目标 iframe 内执行点击
5. **定时管理**：使用 setTimeout + chrome.alarms 双重机制，防止 Service Worker 被杀后定时器丢失

## 消息通信
- popup → background: START / STOP / GET_STATUS / UPDATE_INTERVAL
- background → popup: REFRESH_DONE / REFRESH_ERROR
- popup → content: START_PICKING / STOP_PICKING / DETECT_IFRAMES / EXECUTE_XPATH_CLICK
- content → background → popup: XPATH_PICKED

## 安装方式
1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目目录
