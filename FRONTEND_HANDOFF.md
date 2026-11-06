# CloudBerth 前端交接文档

更新：2026-11-07；对应版本 1.3.0。以当前源码为准，本文不包含个人配置或账号信息。

## 目标与结构

CloudBerth 是云游戏桌面启动器。启动器是打包的本地页面，游戏使用独立的 BrowserWindow。
前端使用原生 HTML/CSS/JavaScript，没有 Vite、React 或前端构建步骤。

| 文件 | 职责 |
| --- | --- |
| `src/launcher/index.html` | 页面、设置表单、添加/修改游戏与删除确认弹窗 |
| `src/launcher/styles.css` | 玻璃面板、横向游戏卡片、头像色调背景、响应式布局 |
| `src/launcher/app.js` | 页面状态、DOM 渲染、交互与桥接调用 |
| `src/launcher/grain.png` / `waves.svg` | 本地视觉纹理与背景资源 |
| `src/preload.js` | 暴露 `window.cloudBerth`，不暴露 Node/Electron 通用能力 |
| `src/runtime.js` | 窗口运行表、完整状态、可信 IPC、游戏启动/停止 |
| `src/library.js` | 数据校验及 launcher.json 读写 |
| `src/identity.js` | CloudBerth 名称、应用标识与旧版迁移 |
| `src/platform.js` | Mac 原生菜单和默认值 |
| `src/shortcuts.js` | 原生按键捕获、全屏状态处理 |
| `src/icons.js` | 网站图标发现、图片选择与 PNG 归一化 |

## 状态与公共 API

```ts
type ShortcutAction = 'toggleDisplay' | 'home' | 'quit';
type Shortcuts = Record<ShortcutAction, string>;
interface Game {
  id: string;
  name: string;
  url: string;
  icon?: string;     // 用户自定义 PNG Data URL，优先显示
  siteIcon?: string; // 网站图标 PNG Data URL
}
interface LauncherState {
  version: 1;
  games: Game[];
  shortcuts: Shortcuts;
  defaultShortcuts: Shortcuts;
  shortcutDefaultsVersion: 2;
  revision: number;
  runningGameIds: string[];
}
interface ShortcutCapture {
  action: ShortcutAction;
  shortcut?: string;
  cancelled?: boolean;
  error?: string;
}
interface CloudBerthAPI {
  readonly platform: string;
  getState(): Promise<LauncherState>;
  saveGames(games: Array<Omit<Game, 'id'> & { id?: string }>): Promise<LauncherState>;
  saveShortcuts(shortcuts: Shortcuts): Promise<LauncherState>;
  launchGame(id: string): Promise<LauncherState>;
  stopGame(id: string): Promise<LauncherState>;
  chooseAvatar(): Promise<string | null>;
  fetchIcon(url: string): Promise<string>;
  setShortcutCapture(active: boolean, action?: ShortcutAction): Promise<boolean>;
  onShortcutCaptured(callback: (result: ShortcutCapture) => void): () => void;
  onStateChanged(callback: (state: LauncherState) => void): () => void;
  quit(): Promise<true>;
}
```

启动时订阅 onStateChanged，再请求 getState。推送与保存接口返回的都是完整快照；revision 较旧的结果不要覆盖当前状态。
`runningGameIds`、`defaultShortcuts`、`revision` 属于运行时状态，不由前端直接持久化。
只通过 API 改数据；不要访问应用目录、本地文件路径或浏览器存储模拟游戏库。
事件订阅返回取消函数，组件化改造时必须在卸载时调用。

## 页面板块

### 顶部

- `.brand`：显示 CloudBerth 和品牌图形，当前品牌图形为 brand-mark.svg。
- `#settingsButton`：打开快捷键设置。
- `#addButton`：打开新增游戏弹窗。
- `.topbar-actions`：设置页打开时隐藏。

品牌名称需要和 document.title、窗口标题、原生菜单保持一致。
应用图标是 build/icon.svg、build/icon.png 与 build/icon.ico；页面图形为 src/launcher/brand-mark.svg。当前工作区已收到新版图标资源，仍按要求暂停打包，后续设计修改时同步这些资源。

### 游戏区

- `#gameSection`：游戏库容器，与设置区互斥。
- `#gameGrid`：横向游戏卡片列表。
- `.game-card` / `.game-tile`：卡片外层与可选中的主体。
- `#emptyState` / `#emptyAddButton`：无游戏时的添加入口。
- `#ambient`：随选中游戏头像色调切换背景。

选中状态保存在 selectedGameId。左右方向键移动选择；普通鼠标滚轮用于横向滚动。
选择游戏不启动游戏。卡片启动按钮调用 launchGame(id)。

运行态从 state.runningGameIds 判断。未运行时显示“开始游戏”，运行时显示“运行中”。
重复点击调用同一个 launchGame(id)，由主进程复用、显示并聚焦已有窗口，不新建第二个游戏实例。
运行按钮最右侧的小菜单提供“结束游戏”，调用 stopGame(id)。不要用 CSS 假装改变运行状态。

运行中的游戏可以改名称和头像；改网址或删除前必须先结束运行，主进程也会校验。

### 添加/修改游戏弹窗

- `#gameDialog`：dialog 容器。
- `#gameForm`：表单；`#gameId` 区分新增与修改。
- `#gameName` / `#gameUrl`：名称和 HTTPS 网址。
- `#avatarPreview` / `#avatarAnchor`：头像与视觉预览。
- `#chooseAvatarButton`：调用 chooseAvatar，返回 PNG Data URL 或取消的 null。
- `#autoAvatarButton`：使用网站图标。
- `#avatarStatus` / `#gameMessage`：图标状态及保存错误。

头像草稿只在弹窗内更新；保存时随游戏数组一起提交。选择图片不自动保存游戏。
自定义头像优先于网站图标；两者都没有或图片解码失败时显示名称首字。
网站图标获取需要异步等待，沿用 iconRequest 防止旧请求覆盖新网址的结果。

saveGames 是完整替换数组，不是增量操作。修改必须保留原 ID；新增可以省略 ID，由主进程分配。
不要对正在运行的游戏生成新 ID，否则会破坏复用窗口与运行态关联。

### 删除确认

- `#deleteDialog` / `#deleteConfirmButton`：确认删除入口。
- 删除使用过滤后的完整数组调用 saveGames。
- 删除入口不删除网站 Cookie、缓存或其他站点数据。

### 快捷键设置

- `#settingsSection` / `#shortcutForm`：设置容器和表单。
- `[data-shortcut="toggleDisplay"]`：切换全屏。
- `[data-shortcut="home"]`：返回游戏库。
- `[data-shortcut="quit"]`：退出应用。
- `[data-reset-shortcut="..."]`：三个操作各有恢复默认按钮。
- `#shortcutMessage`：录入、校验与保存结果。
- `#settingsCloseButton`：返回游戏库并取消录入。

输入框 readonly。单击只聚焦，双击调用 setShortcutCapture(true, action)。
等待主进程确认后显示 is-recording 和“请按组合键…”。录入结果通过 onShortcutCaptured 到达。
主进程在 Chromium/AppKit 处理按键之前捕获组合，录入 Command+Q 不会退出。

ESC 取消，Tab/失焦/关闭设置/保存结束录入。离开时调用 setShortcutCapture(false)，不要留下菜单快捷键暂停状态。
普通修饰键单独按下会被忽略。F12 为保留键，普通按键需修饰键，三个操作不能重复。

录入和恢复默认都仅修改草稿；恢复值来自 state.defaultShortcuts。点击保存后调用 saveShortcuts。
主进程负责校验、写入、更新原生菜单 accelerator 和推送完整状态；前端 applyState 刷新页脚。
Mac 展示时将 Meta 显示为 Command/⌘，Alt 显示为 Option/⌥；不要把展示符号直接作为存储字符串。

| 操作 | Mac 存储默认值 |
| --- | --- |
| 全屏 | Shift+Meta+F |
| 返回游戏库 | Shift+Meta+H |
| 退出 | Meta+Q |

旧版 Ctrl+Meta+F 默认值会一次性迁移；其他自定义组合保留。不要在前端硬编码默认值覆盖用户配置。

### 底部与反馈

- `#shortcutHint`：根据当前 state.shortcuts 渲染全部快捷键提示。
- `#gameCount`：入口数量。
- `#toast`：启动、结束等操作的短提示，role=status。
- 表单错误在各自 message 节点显示，不用 alert 阻断用户操作。

## IPC 与安全边界

所有调用名使用 launcher: 前缀，方法与对应通道一一对应，例如 launcher:save-shortcuts、launcher:launch-game。
推送为 launcher:state-changed、launcher:shortcut-captured。
桥接对象仅在本地启动器 file 页面暴露；主进程进一步验证 sender、主 frame 和精确 launcher URL。
远程游戏没有 window.cloudBerth，不能读游戏库、配置或其他站点数据。

保留 contextIsolation、sandbox、禁用 nodeIntegration 及 CSP。资源尽量放在本地，避免为视觉效果放宽 script-src。
卡片名称等用户输入用 textContent，不拼入 innerHTML。

## 窗口与会话

运行表由主进程按游戏 ID 保存 BrowserWindow。返回游戏库会让游戏退出原生全屏并隐藏，不导航、不销毁。
游戏运行时关闭启动器只隐藏它，以便返回快捷键仍有目标。最后一个游戏结束后显示启动器。
退出应用关闭所有窗口。页面 beforeunload 不应阻止明确的结束运行或退出操作。

会话使用 persist:cloud-game。改前端不能更换 partition 或数据目录；身份迁移由 identity.js 管理。

## 验证与发布

改 DOM 选择器时同步修改 tools 中依赖它们的集成检查。
运行 npm run check、test:launcher、test:runtime、test:shortcuts；改窗口行为时加 test:mac；改迁移时加 test:identity。
测试使用临时用户目录，不打开维护者的真实游戏或账号。最小窗口为 800×450，确认设置保存按钮和三项恢复按钮可见。

正式包仅包含 main.js、src、应用图标、默认模板、包元数据与许可说明。
tools、tmp、测试页面、截图和用户配置不进入安装包。开发测试页标题也统一为 CloudBerth。
新 logo 已同步；1.3.0 使用当前 CloudBerth 工作区进行发布构建。
