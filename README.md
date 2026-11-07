# dsh-todolist

Workspace-scoped todo lists and sticky notes for **DeepSeek Harness (DSH)** — a floating panel plus an aggregate "看板" (board) main panel.

## 功能 / Features

- **悬浮面板**：对话区域浮动的「待办 / 便签」小面板，可拖动、可收起（收起后显示待办/完成/便签计数），展开状态按工作区记忆。
- **聚合看板**：主面板按**工作区**分组展示所有清单与便签，卡片式布局；工作区卡片可拖动排序（顺序本地记忆）。
- **待办清单**：清单可置顶（浮到最前）、可换色标题、展开状态记忆；双击标题可重命名（聚焦标题后也可按 F2），回车或点击其他位置保存，Esc 取消；事项为单行省略、悬浮展开，圆形勾选带动效，支持一键添加。
- **便签**：可置顶（新置顶在最上）；图标行左对齐颜色按钮，点击横向展开白底色板改背景色（点击其他位置或 Esc 收起）；复制全部 / 删除常显；内容自动增高；自动识别链接与密钥并以行内 chip 展示——链接单击复制、双击用浏览器打开，密钥/密码/验证码单击复制。
- **图片挂绳**（v1.1.0 新增）：面板页签行下方一条黑色直线上以**图钉**固定缩略图（随机微倾、固定 6 钉位），超出部分在两端图片后堆叠、滚轮翻看。把图片文件**拖到面板任意位置**挂图，或点标题行「粘贴剪贴板图片」按钮挂剪贴板图片；**单击**缩略图居中放大为原始尺寸，**双击**以 PNG 复制（可粘贴进 QQ / 微信），**按住图片拖远**取下；看板中每个工作区卡片内嵌同样的面板。
- **统一气泡提示**：所有鼠标悬浮提示使用 GitHub 式深色气泡（fixed 挂最外层，不会被面板裁剪），操作反馈以飘字形式显示在面板中部并自动消失。
- **数据按工作区分域**，通过所有者 RPC 与宿主通信。

## 安装 / Installation

### Desktop（推荐）

在 DSH「设置 → 插件」的组合包安装入口粘贴：

```text
github:jesongit/dsh-todolist#v1.1.0
```

或从 [GitHub Releases](https://github.com/jesongit/dsh-todolist/releases/tag/v1.1.0) 下载发行包后选择本地包安装。

### CLI（未独立验证）

```sh
dsh plugin --profile <your-profile> add github:jesongit/dsh-todolist#v1.1.0
```

## 兼容性 / Compatibility

- 面向 **DSH `0.2.1-rc.5`** 的 Desktop / Web 会话界面开发与测试。
- 目前仅以 **Declared（声明）** 兼容性提供，**尚未获得 dsh.so 的独立 Verified 认证**。

## 数据与隐私 / Data & privacy

- 所有待办、便签与挂绳图片数据仅保存在本机：`$DSH_HOME/plugins/dsh-todolist/data.json`，按 `workspaceId` 分域（挂绳图片已自动缩小，约每张 ≤ 8 MB data URL）。
- 插件**不主动外传任何数据**、无遥测、无网络请求；仅当你双击便签中的链接时才调用系统打开该 URL。
- 便签中的密钥/链接识别在本地完成，复制使用系统剪贴板。

## 结构 / Layout

| 文件 | 作用 |
|---|---|
| `index.js` | 宿主半边：数据存储与 owner-Web RPC（`/dsh-todolist`）。 |
| `client.js` | 浏览器半边：悬浮面板、聚合看板、清单/便签交互。 |
| `cordis.patch.yml` | 插入插件行的补丁。 |
| `locale/*.json` | 插件显示元数据。 |
| `icon.svg` | 插件图标。 |

## License

MIT © 2026 jesongit
