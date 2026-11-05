# dsh-todolist

Workspace-scoped todo lists and sticky notes for **DeepSeek Harness (DSH)** — a floating panel plus an aggregate "看板" (board) main panel.

## 功能 / Features

- **悬浮面板**：对话区域浮动的「待办 / 便签」小面板，可拖动、可收起（收起后显示待办/完成/便签计数），展开状态按工作区记忆。
- **聚合看板**：主面板按**工作区**分组展示所有清单与便签，卡片式布局；工作区卡片可拖动排序（顺序本地记忆）。
- **待办清单**：清单可置顶（浮到最前）、可换色标题、展开状态记忆；事项为单行省略、悬浮展开，圆形勾选带动效，支持一键添加。
- **便签**：可置顶（新置顶在最上）、右键改色 / 复制全部 / 删除；内容自动增高；自动识别链接与密钥并以行内 chip 展示——链接单击复制、双击用浏览器打开，密钥/密码/验证码单击复制。
- **数据按工作区分域**，通过所有者 RPC 与宿主通信。

## 安装 / Installation

### Desktop（推荐）

在 DSH「设置 → 插件」的组合包安装入口粘贴：

```text
github:jesongit/dsh-todolist#v1.0.0
```

或从 [GitHub Releases](https://github.com/jesongit/dsh-todolist/releases/tag/v1.0.0) 下载发行包后选择本地包安装。

### CLI（未独立验证）

```sh
dsh plugin --profile <your-profile> add github:jesongit/dsh-todolist#v1.0.0
```

## 兼容性 / Compatibility

- 面向 **DSH `0.2.1-rc.5`** 的 Desktop / Web 会话界面开发与测试。
- 目前仅以 **Declared（声明）** 兼容性提供，**尚未获得 dsh.so 的独立 Verified 认证**。

## 数据与隐私 / Data & privacy

- 所有待办与便签数据仅保存在本机：`$DSH_HOME/plugins/dsh-todolist/data.json`，按 `workspaceId` 分域。
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
