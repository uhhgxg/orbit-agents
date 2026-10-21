# Orbit Agents

这是我用 TypeScript、Electron 和 Bun 做的一个 Agent 桌面工具，主要用来管理多个 AI 会话、连接外部工具，并在本地工作区中执行任务。

项目目前还在持续开发中，适合用来学习 Agent、MCP、工具调用和桌面应用开发。

## 目前能做什么

- 管理多个 Agent 会话；
- 连接 MCP 服务、REST API 和本地文件；
- 接入 Anthropic、OpenAI、Google 等模型服务；
- 在会话中查看工具调用和文件修改；
- 创建工作区、技能和自动化任务；
- 使用桌面应用或命令行客户端操作；
- 连接远程服务端，在服务器上运行较长的任务。

## 运行项目

需要先安装 [Bun](https://bun.sh/)。

```bash
git clone https://github.com/uhhgxg/orbit-agents.git
cd orbit-agents
bun install
bun run electron:start
```

开发模式：

```bash
bun run electron:dev
```

类型检查：

```bash
bun run typecheck:all
```

启动后，可以在应用中添加模型连接，然后创建工作区和会话。

## 命令行客户端

命令行客户端位于 `apps/cli`，可以连接正在运行的服务端。

查看帮助：

```bash
bun run apps/cli/src/index.ts --help
```

连接服务端并检查状态：

```bash
orbit-cli --url ws://127.0.0.1:9100 --token <访问令牌> ping
```

常用命令：

```bash
orbit-cli workspaces
orbit-cli sessions
orbit-cli sources
orbit-cli send <会话编号> "请总结当前目录中的文件"
orbit-cli run "请总结这个项目"
orbit-cli --validate-server
```

## 远程服务端

服务端入口是 `packages/server/src/index.ts`。可以在远程 Linux 服务器上启动它，再让桌面应用连接。

```bash
bun run packages/server/src/index.ts
```

启动后，服务端会输出连接地址和访问令牌。在桌面应用或命令行客户端中填入这些信息即可连接。

也可以使用 Docker：

```bash
docker run -d \
  -p 9100:9100 \
  -v orbit-data:/data \
  orbit-agents-server
```

访问令牌等敏感配置请通过部署环境注入，不要写进代码或提交到 Git。

## 项目结构

```text
orbit-agents/
├── apps/
│   ├── cli/                   # 命令行客户端
│   └── electron/              # Electron 桌面应用
│       └── src/
│           ├── main/          # 主进程
│           ├── preload/       # 预加载脚本
│           └── renderer/      # React 界面
└── packages/
    ├── core/                  # 基础类型和公共能力
    ├── shared/                # 共享业务逻辑
    ├── server/                # 服务端入口
    └── ui/                    # 通用界面组件
```

## 配置说明

项目支持通过 `.env` 配置部分 OAuth 信息。开发时可以在本地创建 `.env` 文件：

```dotenv
MICROSOFT_OAUTH_CLIENT_ID=your-client-id
SLACK_OAUTH_CLIENT_ID=your-slack-client-id
SLACK_OAUTH_CLIENT_SECRET=your-slack-client-secret
```

不要把真实的 API 密钥、OAuth 密钥或访问令牌提交到仓库。

Google、Slack、Microsoft 等外部服务通常需要用户自己创建 OAuth 应用并填写对应凭据。

## 技术栈

- TypeScript
- Bun
- Electron
- React
- Vite
- Tailwind CSS
- MCP
- Claude Agent SDK 和 Pi SDK

## 目前的限制

- 项目仍在开发中，部分功能和界面可能会变化；
- 某些模型和外部服务需要用户自己准备 API 密钥；
- 远程服务端部署需要自行配置认证、网络和 TLS；
- 暂时更适合开发和学习使用，生产部署前需要自行做安全检查。

## 许可证

本项目使用 Apache 2.0 许可证，详情见 [LICENSE](LICENSE)。

如果要提交问题或代码，可以先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按照 [SECURITY.md](SECURITY.md) 中的说明报告。
