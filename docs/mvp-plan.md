# MVP 方案：辩论世界

## 1. 目标

打通 `执行引擎 → 事件日志 → Three.js 渲染` 完整链路，并验证架构设计中最不确定的两个点：

1. Agent 适配层能否同时支撑 API 调用型和 CLI 进程型两种 Agent（策略工厂 + Runtime Pool Manager）。
2. 「通用虚拟人状态机 + 事件时间轴」这套展示方案，在没有空间玩法的场景下是否足够表达决策过程。

后续世界模板（讨论组、狼人杀、鱼缸...）在验证通过的骨架上增量添加，不重构核心。

## 2. 世界模板：辩论赛

- **角色**：正方（1-2 个 Agent）、反方（1-2 个 Agent）、可选裁判 Agent（负责最终总结与判定）。
- **调度方式**：turn-based，固定轮次，每轮正反方轮流发言，每次发言有软性时限（超时按降级结果处理）。
- **结束条件**：达到设定轮次后，裁判 Agent（或系统规则）产出总结与判定，写入 `world.verdict` 事件。
- **Observation 内容**：辩题、己方历史发言、对方历史发言、当前轮次信息、（如有）上帝临时指令。

「讨论组」场景与此结构几乎一致（无胜负判定、无正反方对立），验证完成后可作为第二个世界模板低成本复用同一套骨架。

## 3. 技术栈

统一使用 TypeScript，减少执行引擎与展示侧之间的类型/协议不一致成本。

- **后端 / 执行引擎**：Node.js + Fastify（REST API）+ `ws`（WebSocket 事件推送）。MVP 阶段执行引擎作为后端内的一个模块运行（单体），后续如需扩展再拆分为独立服务。
- **持久化**：SQLite（文件型，MVP 足够，事件日志 + Agent/世界配置表）。
- **Agent 适配器**：
  - `ApiAgentAdapter`：调用 Anthropic Messages API（默认）。
  - `CliAgentAdapter`：Node `child_process` 拉起 Claude Code CLI，约定的 stdin/stdout 协议 + 受限工作目录沙箱。
- **前端**：React + Vite，`react-three-fiber` + `drei`（3D 舞台与人物），Zustand（状态管理），WebSocket 订阅实时事件 + REST 拉取历史事件用于回放。
- **管理侧**：与展示侧同一个 React 应用，独立路由（`/admin/*`），复用同一后端 REST API。

## 4. 阶段拆分

1. **Phase 0（当前）**：仓库初始化、架构文档、Git 管理。
2. **Phase 1 — 执行引擎骨架**：事件日志 + `AgentAdapter` 接口 + `ApiAgentAdapter` 实现 + 辩论世界模板（turn-based 调度器）。用脚本跑通一场完整的「纯 API Agent 辩论」，事件正确落盘，无 UI。
3. **Phase 2 — CLI 适配器与沙箱**（已完成）：`CliAgentAdapter` + `RuntimePool`（并发/超时/预算）+ `withSandboxDir`（每次调用独立临时工作目录，用后即删）。`npm run demo:debate` 中 con-1 使用 `CliAgentAdapter`，与 pro-1/judge-1 的 API/mock adapter 协同完成同一局。
   - **Agent 配置 → 适配器的策略工厂**：新增 `src/core/agentConfig.ts`（声明式 `AgentConfig`：`api` / `mock` / `cli`）+ `src/core/agentFactory.ts`（`createAgentAdapter` 把配置变成真实 adapter 实例）。这就是未来管理侧 Agent CRUD 表单要写入/读取的数据结构。
   - **CLI 拉起方式两种预设**：`CliInvocationConfig` 的 `preset: "claude-code"` 会展开成真实 `claude -p --output-format text --no-session-persistence --tools "" [--model] [--system-prompt] [--max-budget-usd]` 非交互调用（`resolveCliInvocation` 负责展开）；`preset: "custom"` 则直接透传任意 `command`/`args`，用于接入 Codex CLI 或其他脚本。demo 默认用 `claude-code` 预设跑真实 CLI（con-1 的发言来自真实嵌套调用，已验证内容质量与固定脚本明显不同），设置环境变量 `USE_MOCK_CLI=1` 可切回 `custom` 预设指向的免费 fixture 脚本，方便反复本地测试不产生真实费用。
   - **真实 CLI 调用的安全默认值**：`--tools ""` 禁用工具（辩论场景只需要文本生成，遵循最小权限）、`--no-session-persistence` 不落盘会话文件、`--max-budget-usd` 限制单次调用花费上限，配合 `RuntimePool` 的超时/并发/调用预算，多层限制嵌套 Coding Agent 的资源消耗。
4. **Phase 3 — 事件流对外暴露**（已完成）：Fastify 服务（`src/server/`），`EventLog` 改为共享 `DatabaseSync` 并继承 `EventEmitter`，`append()` 时 emit `"appended"`，供 WebSocket 层无需轮询地广播。
   - **REST**：`/api/agents` `/api/agents/:id`（GET/POST/PUT/DELETE，`AgentStore` 落 SQLite）；`/api/worlds`（GET 列表、POST 创建并在后台异步跑 `runWorld`，立即返回 202 + worldId，不阻塞请求）、`/api/worlds/:id`（状态：running/finished/failed）、`/api/worlds/:id/events`（完整历史，用于回放）。
   - **WebSocket**：`/ws/worlds/:id` 连接时先发一条 `{type:"history", events:[...]}` 补全到当前为止的全部事件，再持续推送 `{type:"event", event}`，避免客户端要自己协调「先 REST 拉历史再订阅」的竞态。已用真实 `claude-code` 预设的 con-1 验证：连接时历史里已有 3 条事件，之后 5 条（含真实 CLI 发言与裁判判定）逐条实时推到 WS，REST 的 `/events` 与 WS 收到的完整序列一致。
   - **已知取舍**：服务端常驻的 `RuntimePool` 没有设 `maxCalls`（一次性 demo 脚本用的「生命周期调用预算」不适合长驻进程，会把 CLI Agent 永久锁死），单次调用花费仍由 `--max-budget-usd` 兜底；可重置的（如按日）预算跟踪列为后续待办，见 `docs/architecture.md` §5。
5. **Phase 4 — 展示侧（先文本后 3D）**：先用纯文本时间轴验证事件流可读性，再接入 Three.js 舞台场景 + 通用 Avatar 状态机。
6. **Phase 5 — 管理侧**：Agent CRUD、发起辩论（题目/双方/轮次）的表单与运行控制界面。
7. **Phase 6+**：新增世界模板——讨论组（复用辩论骨架）→ 狼人杀（隐藏信息 + 投票，检验协议扩展性）→ 鱼缸（tick-based 调度，检验连续模拟场景）。

## 5. 验收标准（Phase 1-5 完成时）

- 一场辩论从发起到结束，全过程只通过事件日志驱动，展示侧可实时观看也可完整回放。
- 正反方中至少一个角色使用 `CliAgentAdapter`，另一个使用 `ApiAgentAdapter`，两者在同一局内协同工作。
- 管理侧可以完成一次「新增 Agent → 发起辩论 → 查看结果」的完整闭环操作，无需直接改数据库/代码。
