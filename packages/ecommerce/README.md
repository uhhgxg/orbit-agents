# 经营调查与受控操作模块

Node 22+ 的独立 MCP 服务，接入 Orbit 原有 Source/TaskRunner；支持固定快照和可替换 HTTP Adapter。业务代码全部使用 TypeScript，类型由 Zod 领域契约推导。

入口：六类经营证据查询 → 异常调查 → 只读复核 → 操作请求 → 平台外可信操作者审批 → 执行/核验 → 轨迹与评测。

**依赖前置知识清单：npm 脚本、构建、环境变量。** 在本目录执行命令。构建会生成 dist；环境变量选择数据和服务，密钥不写入源码。回放的业务时间固定，审批到期始终使用实际时钟。

- 安装：`npm install --workspaces=false`。
- 检查：`npm run typecheck`、`npm test`。
- 回放与评测：`npm run demo`、`npm run eval`；报告在 reports/latest.json。
- 准备新的 Orbit 工作区：`npm run prepare:workspace -- <新目录>`。已有目录不会覆盖。
- MCP：构建后运行 `npm start`，通过 ECOMMERCE_ROLE 固定角色。默认 reviewer，不含写操作。

Node 测试使用 test/*.node.ts，由包级脚本显式调用；根工作区的 test:ecommerce、typecheck:all、validate:dev 已接入对应检查，保留原 Bun 测试的运行环境。

评测变体保存各自不可变的 snapshot.json，rawRef 指向对应版本。改价、预算、补货、下架均需要审批；无 approve 工具。外部结果未知时冻结自动重放，由 reconcile 查询回执。快照执行器仅写入本地模拟动作账本。

operator-init 与 approve 是可信操作者 CLI 边界。ECOMMERCE_OPERATOR_AUTH 只给操作者进程；其哈希存储在账本，Agent MCP 环境不接收该凭据。真实业务 API 必须支持幂等与快照版本前置条件。

可选 Langfuse 和模型 Judge 的变量见 .env.example。当前已完成本地协议/业务回归；真实模型、Langfuse 远端与真实经营接口仍需单独联调。确定性回放分数不能当作模型准确率。
