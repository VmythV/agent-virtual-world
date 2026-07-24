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
5. **Phase 4 — 展示侧（先文本后 3D）**：
   - **纯文本时间轴**（已完成）：`web/`（Vite + React + TS），左侧世界列表（状态用红/黄/绿点区分 running/failed/finished）、右侧事件时间轴（连接 `/ws/worlds/:id`，`highlight` 事件加边框强调）。Vite dev server 代理 `/api`、`/ws` 到后端 `:4000`。已用 headless Chromium 实测：8 条事件正确渲染、WS 状态显示 `open`、控制台无报错，截图确认可读性符合预期。
   - 实测中发现一个真实的沙箱坑：`CliAgentAdapter` 的子进程 `cwd` 是 `withSandboxDir` 生成的临时目录而不是项目根目录，所以 `custom` 预设的 `command`/`args` 里引用脚本必须用**绝对路径**——相对路径会在临时目录下解析失败。已记录在 `docs/architecture.md`。
   - **Three.js 舞台 + Avatar 状态机**（已完成）：`web/src/Stage3D.tsx`（`@react-three/fiber` + `drei`）。通用 Avatar 状态机 `idle → thinking → speaking → idle`：胶囊体 + 球形头，按角色着色（正方蓝/反方红/裁判金），`useFrame` 驱动的呼吸感 bob 动画随状态调整幅度/速度，`Html` 锚定姓名标签、`思考中…` 徽标、发言气泡。`resolveDebateLayout()` 直接从事件流里 `world.created` 事件的 payload（`sides`/`judge`）推导舞台站位，不需要额外的 REST 调用。主面板新增「3D 舞台 / 时间轴」切换。
   - 引擎侧配合新增 `turn.started` 事件（`src/engine/scheduler.ts` 在 `agent.act()` 之前 append），否则前端只能在真实 CLI/API 调用返回后才知道"轮到谁了"，看不到"正在思考"的过程。
   - 用真实 `claude-code` 预设跑通端到端验证（headless Chromium + Playwright）：提前打开页面建立 WS 连接后再创建世界，稳定捕捉到 `思考中…` 徽标和发言气泡（先用创建后开浏览器的顺序测试时，浏览器启动的开销经常让整局已经跑完，只能看到收尾）；同时发现并修复两个真实问题——① 世界状态在前端是「进入页面时拉一次 REST」的快照，不会随事件流更新，导致跑完之后头部一直显示 `running`，改成收到每条实时事件都顺带刷新一次 `GET /api/worlds/:id`；② 发言气泡用 `max-width` 时在 3D 场景里被压缩到几乎一字一行，改成固定 `width` 解决。
6. **Phase 5 — 管理侧**（已完成）：加了 `react-router-dom`，把原来单页的 `App.tsx` 拆成路由外壳（顶部导航「世界视图 / 管理控制台」）+ `WorldView.tsx`（原有世界列表 + 3D/时间轴，选中的世界现在体现在 URL `/world/:worldId` 上，可直接分享链接）+ `web/src/admin/`（`AdminConsole.tsx` 标签页外壳、`AgentsTab.tsx`、`LaunchWorldTab.tsx`）。
   - **Agent 管理**：表格 + 表单一体的 CRUD 界面，表单覆盖三种适配器（api / mock / cli，cli 下又区分 claude-code 预设与 custom 预设），编辑复用同一表单并按 `PUT` 提交，删除有二次确认。校验错误直接把后端 400 的 `error` 文本显示在表单上方。
   - **发起世界**：辩题/轮次输入 + 正反方 Agent 复选框 + 裁判下拉（可选），提交后 `POST /api/worlds` 成功即跳转到 `/world/:id` 直接观看。
   - 全程用 Playwright 端到端验证：纯通过 UI 创建 3 个 mock Agent、编辑其中一个并用 REST 复查确认改动真的落库、创建后删除一个、再通过「发起世界」表单跑完一整局，最终页面正确显示 `finished` 状态和 3D 舞台。
7. **Phase 6+**：新增世界模板
   - **讨论组**（已完成）：`src/worldTemplates/discussionWorldTemplate.ts`，把辩论模板的骨架去掉「正反方对立」，改成所有参与者按固定顺序轮流发言，可选主持人在最后给总结（`discussion.summary` 事件）而不是胜负判定。跟预想的一样，几乎是把 `debateWorldTemplate.ts` 复制过来删掉 `sides` 概念——证实了架构文档里「讨论组可以复用辩论骨架」的判断。
     - 前端同步加了 `resolveStageLayout()`（`web/src/Stage3D.tsx`）：不需要知道模板名字，只看 `world.created` 事件 payload 里有没有 `sides`（辩论）还是 `participants`（讨论组）字段，自动选对应的舞台布局——辩论是正反对立站位，讨论组是参与者围成半圆、主持人在后方。发起世界表单（`LaunchWorldTab.tsx`）加了模板下拉，切换后表单字段跟着换（正反方+裁判 vs 参与者+主持人）。
     - 端到端验证：先用 REST 直接跑一局讨论（确认事件序列跟预期一致：`world.created → round.start → turn.started/agent.speak ×4 → round.start → turn.started/agent.speak ×2 → turn.started/discussion.summary`），再用 Playwright 走完整 UI 流程（3D 半圆布局正确渲染、通过管理控制台的模板下拉发起新的讨论组世界），全程无控制台报错。
   - **狼人杀**（已完成）：`src/worldTemplates/werewolfWorldTemplate.ts`。夜晚（狼人杀人票 + 可选预言家查验）→ 白天讨论 → 白天投票，每次淘汰后检查胜负，循环直到某一方获胜。这是第一个真正需要「不同 Agent 看到不同信息」的模板，回头检验了 §2.1 留的开放问题，结论和改动记在 `docs/architecture.md` §2.6：
     - **协议扩展（都是小的、原则性的加法，不影响已有模板）**：`WorldEvent` 加 `visibleTo?: string[]`（`undefined`=公开，`[]`=对所有 Agent 隐藏但上帝视角仍可见）；`WorldTemplate` 加可选的 `visibilityForActor()`，让调度器能正确标记 `turn.started` 事件的可见性（连「轮到谁了」在夜晚阶段本身都可能泄密）；调度器统一按 `visibleTo` 过滤喂给 `buildObservation` 的历史，过滤逻辑不用每个模板自己写。**REST/WS 从不做这个过滤**——人类「上帝」通过管理侧/展示侧看到的永远是完整事件流，信息差只存在于 Agent 各自的 Observation 里。
     - **动作协议扩展**：狼人杀的杀人票/查验/投票都是「从候选名单里选一个」而不是自由文本，`core/protocol.ts` 加了 `expectedResponseShape`/`choices` 约定，`ApiAgentAdapter`/`CliAgentAdapter`/`MockAgentAdapter` 统一通过新的 `buildActionPayload()` 处理，解析失败时兜底选第一个候选项（不会让整局因为一次奇怪的模型输出而崩溃）。
     - **正确性验证**：`npm run demo:werewolf`——全 mock、结局可预测的一局（村民识破并投出狼人），跑完后直接断言 villager-2 的 `Observation.history` 里：没有 `roles.assigned`/`seer.result`/`night.action`、没有别人的 `role.assigned`、没有夜晚阶段狼人/预言家的 `turn.started`，但公共信息（`night.result` 等）正常可见——5 项断言全部通过。又用 Playwright 走了一遍管理控制台的狼人杀发起表单 + 3D 环形站位（按身份着色，死亡用变灰+倾倒+划线名字表示）+ 时间轴的「🔒 仅 X 可见」私密事件徽标，两边（后端断言 vs 前端展示）看到的私密事件数量完全一致，无控制台报错。
   - **鱼缸/水族箱**（已完成）：`src/worldTemplates/aquariumWorldTemplate.ts`。第一个 tick-based（连续模拟）世界，回头检验了 §2.5 里「调度器要支持 tick-based」的开放项。
     - **调度器扩展**：`runWorld` 现在按 `template.scheduling` 分派。turn-based 逻辑不变；新增 tick-based 循环——每 tick 先收集 `actorsForTick(state)` 返回的、本 tick 需要决策的 Agent（鱼每隔几 tick 才重新决策一次游动行为，所以大多数 tick 没有 Agent 调用、纯确定性物理），await 它们的决策并 `applyAction`，然后 `advanceTick(state)` 推进物理并产出 `world.tick` 快照事件。`RunWorldOptions` 加了 `tickIntervalMs`：mock 鱼的模拟本来毫秒级跑完没法看，服务端给 tick-based 世界配 150ms/tick 的墙钟节奏，WS 就能实时把快照推给观看者。
     - **世界模板**：鱼有位置/朝向/速度/行为，每 tick 确定性移动 + 撞缸壁反弹；行为（cruise/wander/school/dart）是「从候选里选一个」的 choice 动作，复用狼人杀那套动作协议。物理用确定性伪随机（`sin` 哈希）保证可复现。
     - **前端**：新增 `web/src/Aquarium3D.tsx`——玻璃缸线框 + 鱼（椭球身体 + 尾鳍指示朝向），`useFrame` 里把每条鱼的位置朝最新 `world.tick` 快照 lerp 过去，得到平滑游动而不是每 150ms 硬跳。`WorldView.tsx` 依据 `world.created` payload 里有没有 `fish`/`tank` 字段自动切到水族箱视图，并从实时 `world.tick` 事件更新鱼群位置。这和舞台类模板（离散 Avatar 状态）是两种不同的渲染范式，各自独立。
     - **验证**：`npm run demo:aquarium`（无 tick 延迟、瞬时跑完）断言快照数量正确（初始 + 每 tick 各一）、事件总数有界（无失控循环）、每条鱼每个 tick 都在缸内、且确实游动了——4 项全过。又用 Playwright 走了一遍管理控制台的水族箱发起表单，实时采样 tick 横幅和鱼的坐标，确认模拟在墙钟时间里逐 tick 推进、鱼在游动、tick 40 正常结束，无控制台报错。
   - （做题世界随后在第 10 条补齐；至此原始 6 个示例场景里除「辩论/讨论组二选一」算一个外，均已覆盖。）
8. **上帝干预指令通道**（已完成）：原始需求「我作为上帝，可以对任意 Agent 发号施令」的落地。架构文档 §2.4 早有设计、`Observation.instruction` 字段也一直存在但没人填。现在补齐：`POST /api/worlds/:id/instructions` 注入 `god.instruction` 事件（可广播或定向，定向复用 `visibleTo` 不泄露），调度器每回合重读日志把待送达指令拼进目标的 `Observation.instruction`（按 (事件,actor) 记账，只送一次）。`npm run demo:god` 确定性验证送达/单次/不泄露，前端「上帝指令」输入条 + Playwright 验证广播（公开）与定向（🔒）都正确进入时间轴。详见架构文档 §2.4。
9. **回放 UI**（已完成）：兑现事件溯源「回放免费」的承诺，详见架构文档 §3.3。前端 `reconstructView(events, cursor)` 把事件流折叠到任意游标，产出与实时渲染相同的视图结构，因此一套渲染逻辑通吃实时/回放、且对所有模板通用。回放条支持拖拽/播放/暂停/变速，时间轴高亮游标事件并把之后的事件变暗。Playwright 在狼人杀上验证了游标 0 无人死亡、拖到末尾恢复死者、时间轴游标+变暗行数正确、播放自动推进，无控制台报错。**没有加任何后端接口**——纯靠已有的事件日志，印证了当初为可回放而做的事件溯源设计。
10. **做题世界 / 工具编排**（已完成）：原始示例 #4，也是六个场景里形态最不同的一个——不是「平等 Agent 共处一室」而是「管理者指挥工具」。`problemSolvingWorldTemplate.ts`：协调者（世界管理者）反复决定把题目派给哪个专家 Agent（choice 动作：选专家或 FINALIZE），专家各自贡献，协调者汇总出 `world.answer`，`maxConsultations` 兜底终止。`npm run demo:solve` 验证委派事件序列（route→contribution×2→answer）、专家贡献齐全、最终解答由协调者给出。前端 `resolveProblemLayout`（协调者居中金色、专家一排青色）+ 管理表单（题目/协调者/专家），Playwright 验证完整跑通并落到 3D 舞台，无报错。它也和上帝指令通道联动：给协调者发高层指令即「管理者代为指挥执行」。详见架构文档 §2.5。
11. **人性实验室**（已完成）：原始示例 #3，也是六个例子里最后补齐的一个。`humanLabWorldTemplate.ts`：每个 Agent 是一个被**私密赋予性格**的「人」，投入一个情境、按轮次互动，可选观察者最后分析群体动态。它把前面两处协议扩展组合在一起——讨论组的回合结构 + 狼人杀式的「每人只知自己身份」（`persona.assigned` 对本人可见、`personas.assigned` 仅上帝可见）。`npm run demo:humanlab` 验证性格隐藏（参与者看不到他人性格）+ 观察者总结；单测覆盖同一断言；Playwright 走完管理表单（每个参与者一个性格输入框 + 观察者下拉）→ 3D 半圆舞台（参与者靛蓝、观察者金色）→ 时间轴里性格分配事件全部 🔒 私密标注，无报错。
12. **工程加固**（已完成）：重启恢复（启动对账遗留 running 世界为 failed）、运行控制（`stop`/`delete` 世界 + AbortSignal 协作取消 + 删除被引用 Agent 的 409 守卫）、可重置的窗口化 CLI 预算、custom CLI 相对路径软告警、failed/stopped 世界的错误横幅。vitest 测试套件（29 项，覆盖协议纯函数/RuntimePool/存储/6 个模板集成/调度器隐藏信息与并发与取消）+ GitHub Actions CI（typecheck + test + 全部离线 demo + 前端构建）。
    - 至此原始 6 个示例场景全部覆盖（辩论/讨论组/狼人杀/水族箱/做题/人性实验室），核心架构与最初设想的全部能力均已用真实运行 + 自动化测试验证。剩余方向：真实 API/CLI Agent 的成本与延迟压测、更细的鉴权/多用户、前端组件级测试——属于面向生产的打磨，见架构文档 §5。

## 5. 验收标准（Phase 1-5 完成时）

- 一场辩论从发起到结束，全过程只通过事件日志驱动，展示侧可实时观看也可完整回放。
- 正反方中至少一个角色使用 `CliAgentAdapter`，另一个使用 `ApiAgentAdapter`，两者在同一局内协同工作。
- 管理侧可以完成一次「新增 Agent → 发起辩论 → 查看结果」的完整闭环操作，无需直接改数据库/代码。
