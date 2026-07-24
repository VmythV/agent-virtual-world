# Agent Virtual World — 架构设计

## 1. 产品定位

一个可以容纳任意数量 Agent 的虚拟世界模拟平台。用户以「上帝」身份可以对世界中任意 Agent 发号施令，也可以对「世界管理者」下达高层任务由其代为指挥。世界的运行过程（包括每个 Agent 的决策）通过 3D 场景 + 事件时间轴对外展示，并支持按时间序列回放。

系统分三层：

- **执行侧（Execution Engine）**：Agent 决策与世界规则实际运行的地方。
- **展示侧（World View，Three.js）**：把执行侧产生的事件渲染成可视化的虚拟世界，支持实时观看和历史回放。
- **管理侧（Admin Console）**：Agent 的增删改查、世界模板配置、任务下发。

三层之间只通过「事件日志（Event Log）」和「REST/WebSocket API」通信，不直接共享状态，以保证展示侧和回放可以完全脱离执行侧运行。

## 2. 核心抽象

### 2.1 Agent 适配层（策略工厂）

不同 Agent 的接入方式差异很大，需要统一接口屏蔽差异：

```ts
interface Observation {
  worldId: string;
  agentId: string;
  visibleState: unknown;   // 该 Agent 在当前世界状态下能看到的信息（按世界模板过滤）
  history: WorldEvent[];   // 该 Agent 可见的历史事件
  instruction?: string;    // 「上帝」或管理者下发的临时指令（见 2.4）
}

interface AgentAction {
  type: string;             // 由世界模板定义的动作类型，如 "speak" / "vote" / "move"
  payload: unknown;
  reasoning?: string;       // 可选：Agent 的决策说明，用于展示侧呈现「为什么这么做」
}

interface AgentAdapter {
  readonly agentId: string;
  act(observation: Observation): Promise<AgentAction>;
}
```

已规划的适配器实现：

- **ApiAgentAdapter**：直接调用大模型 API（Anthropic / OpenAI 等），无状态、快、便宜，是大多数世界角色的默认选择。
- **CliAgentAdapter**：拉起 Claude Code / Codex CLI 等 Coding Agent 进程，通过约定的输入/输出协议交互。用于需要真实工具调用/写代码/搜索能力的重决策角色。
- 后续可扩展第三方已有 Agent（只要能包一层适配器实现上述接口）。

选择哪个适配器由 Agent 配置（管理侧 CRUD 时指定）决定，属于策略工厂模式。

### 2.2 Runtime Pool Manager（运行时进程池）

CliAgentAdapter 背后需要管理真实的进程/会话生命周期，独立于策略工厂之外单独设计：

- **并发控制**：限制同时运行的 CLI 进程数，避免资源耗尽。
- **超时熔断**：单次 `act()` 调用超时后返回降级结果（如「弃权」），不阻塞世界推进。
- **成本预算**：按世界/按局设置调用预算上限，超出后告警或阻止该 Agent 继续行动。
- **沙箱隔离**：CLI 进程限制在独立的临时工作目录内运行，收紧文件系统与命令执行权限，确保「世界里的一个角色」不会意外触达宿主机资源。MVP 阶段用受限工作目录 + 权限参数实现，后续可升级为容器级隔离。

### 2.3 事件溯源（Event Sourcing）

执行引擎产生的一切都落成不可变事件，展示侧和回放都只消费这份日志：

```ts
interface WorldEvent {
  id: string;
  worldId: string;
  sequence: number;       // 世界内单调递增序号，回放/排序的依据
  timestamp: string;
  type: string;           // "round.start" / "agent.speak" / "agent.state_change" / "world.verdict" ...
  actorId?: string;
  payload: Record<string, unknown>;
}
```

- 事件日志是唯一真相来源（source of truth）。
- 展示侧通过 WebSocket 订阅实时事件流，或通过 REST 拉取历史事件做回放，两者复用同一套渲染逻辑。
- 「重大事件」通过事件的 `type` 或额外的 `highlight: true` 标记，供时间轴 UI 单独标出。

### 2.4 上帝干预 vs 世界自治

用户/管理者的指令不直接篡改世界状态，而是作为一条特殊事件（`type: "god.instruction"`）注入事件流，并在下一次相关 Agent 的 `Observation.instruction` 中出现。这样保证：

- 所有干预都可追溯、可回放。
- 执行引擎的状态推进逻辑始终只依赖事件日志，不存在「隐藏的旁路修改」。

### 2.5 世界模板（可插拔规则引擎）

不同示例场景的规则复杂度和推进方式差异很大，因此规则引擎不写死，而是定义成「世界模板」接口，每个具体场景（狼人杀/鱼缸/辩论...）实现自己的模板：

```ts
interface WorldTemplate {
  id: string;
  scheduling: "turn-based" | "tick-based";
  buildObservation(agentId: string, state: WorldState): Observation;
  applyAction(agentId: string, action: AgentAction, state: WorldState): WorldEvent[];
  isFinished(state: WorldState): boolean;
}
```

- **turn-based**：调度器按顺序等待相关 Agent 响应后再推进（辩论、讨论组、狼人杀、辩论）。
- **tick-based**：调度器按固定节奏推进，Agent 各自异步响应（鱼缸、人性实验室）。

「做题世界」这类没有空间/角色平等互动概念的场景，更接近工具编排而非「世界模拟」，建议作为一种特殊的、无空间概念的世界模板对待，而不强行套用角色站位等展示逻辑。

## 3. 展示侧设计

### 3.1 通用虚拟人状态机

所有世界模板统一使用 3D 人物形象展示 Agent（包括辩论、讨论组这类没有空间玩法的场景）。为避免每个场景各写一套动画逻辑，定义统一的 Avatar 状态机：

```
idle → thinking → speaking/acting → idle
```

世界模板只需要把自己的领域事件（如 `agent.speak`、`agent.vote`）映射到这几个通用状态，3D 渲染层统一消费，不感知具体世界规则。

### 3.2 场景与舞台

每个世界模板配一个「场景模板」（舞台布局），例如：

- 辩论：正反方讲台 + 主持台
- 讨论组：圆桌
- 狼人杀：圆桌 + 夜晚/白天光效
- 鱼缸：水族箱容器 + 自由游动

### 3.3 时间轴与回放

- 底部时间轴展示事件序列，可拖拽跳转到任意历史时刻重放。
- 重大事件（`highlight: true`）在时间轴上单独标记，可快速跳转。
- 实时模式下时间轴跟随最新事件自动滚动；回放模式下暂停实时订阅，改为按需拉取历史片段。

## 4. 管理侧设计

标准后台管理系统，通过 REST API 操作执行引擎的配置与数据：

- Agent CRUD：名称、适配器类型（API / CLI / 第三方）、对应配置（API key、模型、CLI 路径与启动参数、权限范围等）。
- 世界配置：选择世界模板、参数（辩论题目、轮次数、鱼缸鱼群数量等）、参与的 Agent 列表。
- 任务下发：向「世界管理者」角色下发高层任务，或直接向某个 Agent 下发指令（见 2.4）。
- 运行控制：启动/暂停/终止某个世界实例。

## 5. 悬而未决的风险点（持续跟踪）

- **CLI Agent 的延迟与成本**：回合制场景里如果多个角色都是 CliAgentAdapter，单局耗时和费用可能远超预期，需要在 Runtime Pool Manager 里做好预算与降级策略。
- **Observation/Action 协议的可扩展性**：新增世界模板时，协议是否足够通用，需要在做完第二个模板（如狼人杀）后回头检验。
- **沙箱隔离的安全边界**：MVP 阶段的受限工作目录方案是否足够，需要在引入 CliAgentAdapter 时重新评估。
- **3D 展示对无空间场景的适配成本**：辩论/讨论组这类场景的「站桩发言」表现是否足够传达决策过程，可能需要辅以字幕/气泡等 2D 叠加信息。
