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
3. **Phase 2 — CLI 适配器与沙箱**（已完成）：`CliAgentAdapter` + `RuntimePool`（并发/超时/预算）+ `withSandboxDir`（每次调用独立临时工作目录，用后即删）。`npm run demo:debate` 中 con-1 使用 `CliAgentAdapter`，与 pro-1/judge-1 的 API/mock adapter 协同完成同一局。演示中 CLI 一侧接的是 `src/demo/fixtures/mockCliAgent.mjs`（一个符合 stdin-in/stdout-out 协议的最小脚本），而不是真的拉起 `claude`/`codex` CLI ——自动化 demo 里递归拉起真实 Coding Agent 会话会产生不可控的真实费用和延迟，且有嵌套会话的风险，不适合作为可重复运行的验证脚本。接入真实 CLI 时只需把 `CliAgentAdapter` 的 `command`/`args` 指向真实可执行文件，协议不变。
4. **Phase 3 — 事件流对外暴露**：REST（历史事件、世界/Agent 配置 CRUD）+ WebSocket（实时事件推送）。
5. **Phase 4 — 展示侧（先文本后 3D）**：先用纯文本时间轴验证事件流可读性，再接入 Three.js 舞台场景 + 通用 Avatar 状态机。
6. **Phase 5 — 管理侧**：Agent CRUD、发起辩论（题目/双方/轮次）的表单与运行控制界面。
7. **Phase 6+**：新增世界模板——讨论组（复用辩论骨架）→ 狼人杀（隐藏信息 + 投票，检验协议扩展性）→ 鱼缸（tick-based 调度，检验连续模拟场景）。

## 5. 验收标准（Phase 1-5 完成时）

- 一场辩论从发起到结束，全过程只通过事件日志驱动，展示侧可实时观看也可完整回放。
- 正反方中至少一个角色使用 `CliAgentAdapter`，另一个使用 `ApiAgentAdapter`，两者在同一局内协同工作。
- 管理侧可以完成一次「新增 Agent → 发起辩论 → 查看结果」的完整闭环操作，无需直接改数据库/代码。
