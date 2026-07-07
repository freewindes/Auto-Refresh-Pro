# AGENTS.md - Auto Refresh Pro 项目结构说明

## 项目定位
Auto Refresh Pro 是一款自开发 Chrome 浏览器扩展，用于对网页执行定时自动刷新、XPath 模拟点击、页面内容监控与提醒。当前正式项目目录为 `Auto Refresh/`，根目录用于存放协作规范、版本记录与历史归档。

## 当前技术栈
- Chrome Extension Manifest V3
- 原生 HTML / CSS / JavaScript
- Chrome Extension APIs: `storage`, `activeTab`, `scripting`, `tabs`, `alarms`, `notifications`
- 无前端框架、无构建工具，当前以源码目录直接加载为插件

## 根目录结构
```text
Auto Refresh Pro/
├── Auto Refresh/          # 正式插件项目目录，Chrome 加载此目录
├── 历史版本/              # 仅项目更新时存放 Auto Refresh 项目快照
├── AGENTS.md              # 当前文件：项目结构、协作方式与维护说明
├── 总则.md                # Codex 对话问题点、倡导点与防止二次犯错规范
└── 版本更替.md            # 仅记录项目更新成果、时间、版本信息
```

## 正式项目结构
```text
Auto Refresh/
├── .git/                  # 插件项目 Git 仓库
├── .coze                  # Coze/项目辅助配置，保留原样
├── .gitignore             # 插件项目忽略规则
├── AGENTS.md              # 项目内结构说明副本
├── manifest.json          # Chrome 扩展配置，Manifest V3
├── background.js          # Service Worker：定时器、状态、消息路由、通知
├── content.js             # Content Script：XPath、iframe、元素选择、页面浮窗
├── popup.html             # 插件弹窗 UI 结构
├── popup.css              # 插件弹窗样式
├── popup.js               # 插件弹窗交互、状态同步、日志与站点列表
├── preview.html           # UI 预览页，不属于插件运行必需文件
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 核心模块职责
- `manifest.json`: 声明扩展名称、版本、权限、后台 Service Worker、content scripts、默认弹窗与图标。
- `background.js`: 维护每个标签页的刷新状态，接收 popup/content 消息，调度 `setTimeout` 与 `chrome.alarms`，执行刷新或 XPath 点击，处理监控提醒与活动站点同步。
- `content.js`: 在目标网页中检测 iframe、生成与执行 XPath、提供元素选择器高亮、显示页面内通知与悬浮状态窗口。
- `popup.html`: 定义弹窗内的启动/停止按钮、标签页、间隔设置、监控配置、站点列表和日志区域。
- `popup.css`: 定义弹窗视觉样式、布局、状态徽标、按钮、计时环、列表和响应状态。
- `popup.js`: 负责弹窗初始化、读取/保存配置、绑定事件、启动/停止刷新、XPath 选择、倒计时同步、日志输出和 UI 更新。
- `preview.html`: 用于开发或展示 UI 效果，可作为视觉调试参考，不应作为扩展核心逻辑依赖。
- `icons/`: Chrome 扩展在工具栏、扩展管理页等位置使用的图标资源。

## 已识别功能
- 全页面定时刷新。
- XPath 定时模拟点击。
- XPath 元素选择与高亮。
- iframe 检测与跨 frame 场景支持。
- 最大刷新次数限制。
- 运行中切换刷新间隔与模式。
- 页面内容监控，支持声音、系统弹窗与页面浮窗提醒。
- 多活动标签页状态同步与站点列表展示。
- 弹窗日志输出。

## 消息通信概览
- `popup.js` -> `background.js`: 启动、停止、获取状态、更新间隔、更新模式、更新最大次数、获取活动站点等。
- `background.js` -> `popup.js`: 刷新完成、刷新错误、状态变化、XPath 已选中、活动站点变化等。
- `popup.js` -> `content.js`: 开始/停止 XPath 选择、检测 iframe、执行 XPath 点击、更新浮窗等。
- `content.js` -> `background.js`: XPath 选择结果、页面执行结果、监控相关事件等。

## 开发与维护约定
- 每次新对话开始时，先阅读根目录 `总则.md`，再处理用户需求。
- 正式插件加载目录始终为 `Auto Refresh/`。
- 根目录文档用于协作管理，不默认放入 Chrome 扩展发布包。
- `版本更替.md` 与 `历史版本/` 只针对项目更新；纯对话规范修正不追加版本更替，也不创建历史版本。
- 每次项目更新前，先在 `历史版本/` 下创建快照目录，命名格式为：`Auto Refresh_版本号_时间`。
- 时间格式统一使用 `yyyyMMdd_HHmmss`，例如 `Auto Refresh_v0.1.2_20260706_173000`。
- 版本号采用 `v主版本.次版本.修订号`。
- 修改项目代码、项目功能或项目结构后，应同步更新 `版本更替.md`；记录内容只写本次插件相关更新了什么，不写过程、验证流水、后续建议或非插件协作事项。
- `总则.md` 只记录 Codex 在对话中的问题点、倡导点与防止二次犯错规范；项目结构、代码问题、技术改进建议不要写入 `总则.md`。
- 当前源码中存在部分中文乱码文本，后续涉及 UI/文案修复时应统一按 UTF-8 处理并保留历史版本。

## 安装方式
1. 打开 Chrome，访问 `chrome://extensions/`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择 `Auto Refresh Pro/Auto Refresh/` 目录。
