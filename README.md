# Orbit Agents

Orbit Agents 是一个面向 AI Agent 工作流的桌面工作台，支持多会话协作、工具调用、MCP 数据源、远程服务器和本地文件操作。

项目采用 Apache License 2.0 开源，适合个人使用、二次开发和构建面向 Agent 的工作流。

## 项目定位

Orbit Agents 希望把复杂的 Agent 能力放进一个易于使用的桌面应用中，让用户可以：

- 在多个会话之间快速切换，并按状态管理任务；
- 连接 MCP 服务、REST API、数据库和本地文件；
- 使用不同的模型服务，并为不同工作区设置默认模型；
- 创建技能、自动化规则和自定义数据源；
- 在本地电脑或远程服务器上运行 Agent 任务。

## 快速开始

### 从源码运行

运行前请准备 [Bun](https://bun.sh/)。

```bash
git clone https://github.com/uhhgxg/orbit-agents.git
cd orbit-agents
bun install
bun run electron:start
```

### 第一次使用

1. 启动桌面应用。
2. 添加一个模型连接，例如 Anthropic、Google AI Studio、ChatGPT 或 GitHub Copilot。
3. 创建工作区，用于组织会话、技能和数据源。
4. 按需连接 MCP 服务、REST API 或本地文件夹。
5. 创建会话并开始与 Agent 协作。

## 主要功能

| 功能 | 说明 |
| --- | --- |
| 多会话收件箱 | 管理会话状态、收藏重要会话，并按工作流组织任务 |
| 流式交互 | 实时显示模型回复、工具调用和执行状态 |
| 多模型连接 | 接入多个模型服务，为不同工作区设置默认连接 |
| 多提供商支持 | 支持 Anthropic、Google、OpenAI、OpenRouter、Ollama 等服务 |
| MCP 数据源 | 连接外部工具、文档、搜索、集合和任务服务 |
| API 与本地文件 | 接入 REST API、数据库、本地文件夹和 Git 仓库 |
| 权限模式 | 提供只读、执行前确认和自动执行三种权限模式 |
| 后台任务 | 运行耗时任务，并查看任务进度 |
| 技能系统 | 在工作区中保存和复用 Agent 指令 |
| 自动化 | 根据标签、会话状态、工具调用或定时计划触发任务 |
| 文件附件 | 支持拖拽文本、图片、PDF 和 Office 文档 |
| 多文件变更查看 | 使用类似代码编辑器的界面查看一轮会话中的文件变化 |
| 主题系统 | 支持应用级和工作区级主题配置 |

## 数据源

Orbit Agents 可以连接以下类型的数据源：

| 类型 | 示例 |
| --- | --- |
| MCP 服务 | 文档、搜索、任务、数据库和自定义工具服务 |
| REST API | Google、Slack、Microsoft 以及自建 API |
| 本地文件 | 文件系统、Obsidian 知识库和 Git 仓库 |

## 权限模式

| 模式 | 界面名称 | 行为 |
| --- | --- | --- |
| `safe` | 探索 | 只读，阻止所有写入操作 |
| `ask` | 编辑前确认 | 执行写入操作前请求确认，这是默认模式 |
| `allow-all` | 自动 | 自动批准命令和工具调用 |

在聊天界面中按 `SHIFT+TAB` 可以切换权限模式。

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Cmd+N` | 新建会话 |
| `Cmd+1/2/3` | 聚焦侧边栏、会话列表或聊天区域 |
| `Cmd+/` | 打开快捷键说明 |
| `SHIFT+TAB` | 切换权限模式 |
| `Enter` | 发送消息 |
| `Shift+Enter` | 换行 |

## 远程服务器

Orbit Agents 支持在远程 Linux 服务器上运行无界面的服务端，再使用桌面应用作为客户端连接。这样可以让长时间运行的任务持续在服务器上执行，也可以从多台电脑访问同一个工作区。

### 启动服务端

请先按照部署环境配置服务端的认证信息和监听地址，然后在仓库根目录运行：

```bash
bun run packages/server/src/index.ts
```

服务端启动后会输出 WebSocket 连接地址和访问令牌。请妥善保管访问令牌，不要把它提交到 Git 仓库。

### 连接桌面应用

在桌面应用中填写服务端地址和访问令牌，即可使用远程模式。远程模式下，界面运行在本地，工作区管理、工具执行和模型请求运行在远程服务器上。

### Docker

```bash
docker run -d \
  -p 9100:9100 \
  -v orbit-data:/data \
  orbit-agents-server
```

生产环境请通过安全的配置系统注入认证信息，并使用反向代理或可信证书保护 WebSocket 连接。

## 命令行客户端

命令行客户端可以通过 WebSocket 连接正在运行的服务端，适合脚本、持续集成、服务端检查和不需要桌面界面的场景。

### 安装与帮助

```bash
# 在单仓库中运行
bun run apps/cli/src/index.ts --help

# 设置命令别名
alias orbit-cli="bun run $(pwd)/apps/cli/src/index.ts"
```

### 连接服务端

可以通过参数传入地址和访问令牌：

```bash
orbit-cli --url ws://127.0.0.1:9100 --token <访问令牌> ping
```

### 常用命令

| 命令 | 说明 |
| --- | --- |
| `ping` | 检查连接，并返回客户端编号与延迟 |
| `health` | 检查凭据存储状态 |
| `versions` | 查看服务端运行时版本 |
| `workspaces` | 列出工作区 |
| `sessions` | 列出工作区中的会话 |
| `connections` | 列出模型连接 |
| `sources` | 列出已配置的数据源 |
| `session create` | 创建会话 |
| `session messages <id>` | 查看会话消息历史 |
| `session delete <id>` | 删除会话 |
| `send <id> <消息>` | 向会话发送消息并流式获取回复 |
| `cancel <id>` | 取消正在执行的任务 |
| `invoke <channel> [args]` | 使用 JSON 参数调用底层 RPC |
| `listen <channel>` | 监听服务端推送事件 |
| `run <提示词>` | 启动服务端、执行提示词并退出 |
| `--validate-server` | 执行服务端集成检查 |

### 命令行示例

```bash
# 检查连接
orbit-cli ping

# 查看会话
orbit-cli sessions

# 发送消息
orbit-cli send abc-123 "请总结当前目录中的文件"

# 使用标准输入传递内容
echo "请总结这段内容" | orbit-cli send abc-123

# 以 JSON 格式输出，便于脚本处理
orbit-cli --json workspaces

# 自包含运行
orbit-cli run "请总结这个仓库"
orbit-cli run --workspace-dir ./my-project --source github "列出未关闭的合并请求"

# 指定模型提供商
orbit-cli run --provider openai --model gpt-4o "请总结这个仓库"
orbit-cli run --provider google --model gemini-2.0-flash "你好"

# 检查服务端
orbit-cli --validate-server
orbit-cli --validate-server --url ws://127.0.0.1:9100 --token <访问令牌>
```

## 项目结构

```text
orbit-agents/
├── apps/
│   ├── cli/                   # 命令行客户端
│   └── electron/              # Electron 桌面应用
│       └── src/
│           ├── main/          # Electron 主进程
│           ├── preload/       # 安全上下文桥接
│           └── renderer/      # React 界面
└── packages/
    ├── core/                  # 公共类型和基础能力
    ├── shared/                # 共享业务逻辑
    ├── server/                # 服务端入口
    └── ui/                    # 通用界面组件
```

## 本地开发

```bash
# 热更新开发
bun run electron:dev

# 构建并启动桌面应用
bun run electron:start

# 执行全部类型检查
bun run typecheck:all
```

开发环境需要的 OAuth 客户端信息请放在本地 `.env` 文件中。不要把真实密钥提交到版本库：

```dotenv
MICROSOFT_OAUTH_CLIENT_ID=your-client-id
SLACK_OAUTH_CLIENT_ID=your-slack-client-id
SLACK_OAUTH_CLIENT_SECRET=your-slack-client-secret
```

## Google OAuth 配置

Google 数据源需要使用你自己的 OAuth 凭据。配置流程如下：

1. 打开 [Google Cloud Console](https://console.cloud.google.com)，创建或选择一个项目。
2. 在“API 和服务 → 库”中启用 Gmail、Google Calendar 和 Google Drive API。
3. 在“OAuth 同意屏幕”中配置应用信息，并添加测试用户。
4. 在“凭据”页面创建“桌面应用”类型的 OAuth 客户端。
5. 将客户端编号和客户端密钥填入数据源配置，或直接让 Agent 引导你完成配置。

示例配置：

```json
{
  "api": {
    "googleService": "gmail",
    "googleOAuthClientId": "your-client-id.apps.googleusercontent.com",
    "googleOAuthClientSecret": "your-client-secret"
  }
}
```

安全提示：

- OAuth 凭据会与其他数据源凭据一起加密保存。
- 不要把客户端密钥提交到版本控制系统。
- 正式环境建议完成 Google OAuth 同意屏幕的验证。

## 支持的模型服务

### 直接连接

| 服务 | 身份验证 | 说明 |
| --- | --- | --- |
| Anthropic | API 密钥或订阅 OAuth | 通过 Claude Agent SDK 连接 Claude |
| Google AI Studio | API 密钥 | 使用 Gemini 模型和 Google 搜索能力 |
| ChatGPT Plus / Pro | Codex OAuth | 使用 ChatGPT 订阅提供的模型 |
| GitHub Copilot | OAuth 设备码 | 使用 Copilot 订阅中的模型 |

### 第三方和自托管服务

也可以在自定义接口地址中接入以下服务：

| 服务 | 接口地址 | 说明 |
| --- | --- | --- |
| OpenRouter | `https://openrouter.ai/api` | 通过一个密钥访问多个模型 |
| Vercel AI Gateway | `https://ai-gateway.vercel.sh` | 提供统一路由、观测和缓存 |
| Ollama | `http://localhost:11434` | 在本地运行开源模型，不需要 API 密钥 |
| 自定义服务 | 任意地址 | 支持兼容 OpenAI 或 Anthropic 协议的服务 |

## Agent 后端

Orbit Agents 使用两套 Agent 后端：

- Claude 后端：由 Claude Agent SDK 驱动，支持自定义接口地址和第三方服务路由。
- Pi 后端：由 Pi SDK 驱动，用于 Google AI Studio、ChatGPT、GitHub Copilot 和 OpenAI API 连接。

## 配置与数据

应用配置由当前运行平台管理，主要包含以下内容：

```text
应用数据目录/
├── config.json              # 工作区和模型连接
├── credentials.enc          # 加密凭据
├── preferences.json         # 用户偏好
├── theme.json               # 应用主题
└── workspaces/
    └── {id}/
        ├── config.json      # 工作区设置
        ├── theme.json       # 工作区主题
        ├── automations.json # 自动化规则
        ├── sessions/        # 会话数据
        ├── sources/         # 已连接的数据源
        ├── skills/          # 自定义技能
        └── statuses/        # 状态配置
```

## 自动化

自动化可以在标签变化、会话开始、工具调用或定时计划触发时创建新的 Agent 任务。

例如，可以让 Agent：

- 每个工作日上午九点生成站会简报；
- 当会话被标记为紧急时通知你；
- 记录权限模式变化；
- 每周五下午总结本周已完成的任务。

自动化规则支持定时触发、标签变化、权限变化、会话状态变化、工具调用前后以及会话开始和结束等事件。

## 高级能力

### 大型响应处理

当工具返回的内容过大时，系统会自动进行摘要，并保留与当前任务相关的重点信息。

### 深层链接

桌面应用支持通过自定义链接打开会话、设置、数据源或新建聊天。具体链接格式以当前构建配置为准。

## 技术栈

| 层次 | 技术 |
| --- | --- |
| 运行时 | [Bun](https://bun.sh/) |
| AI | [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) |
| 桌面应用 | [Electron](https://www.electronjs.org/) 与 React |
| 界面 | [shadcn/ui](https://ui.shadcn.com/) 与 Tailwind CSS |
| 构建 | esbuild 与 Vite |
| 凭据存储 | AES-256-GCM 加密文件存储 |

## 故障排查

### 调试模式

打包后的应用可以通过 `-- --debug` 开启详细日志。不同系统的安装路径可能不同，请根据实际安装位置调整命令：

```bash
# macOS 示例
"/Applications/Orbit Agents.app/Contents/MacOS/Orbit Agents" -- --debug

# Linux 示例
./orbit-agents -- --debug
```

日志通常位于当前用户的应用数据目录下。开发环境中的日志会自动启用。

## 许可证

本项目使用 Apache License 2.0，详情请查看 [LICENSE](LICENSE)。

项目使用的第三方依赖可能受其各自的服务条款约束，尤其是 [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)。

## 参与贡献

欢迎提交问题、建议和代码贡献。提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 安全

Orbit Agents 在启动本地 MCP 服务时会过滤敏感环境变量，避免凭据意外传递给子进程。请不要把 API 密钥、OAuth 密钥或访问令牌提交到版本库。

发现安全问题后，请按照 [SECURITY.md](SECURITY.md) 中的说明进行报告。
