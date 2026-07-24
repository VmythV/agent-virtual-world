import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { StoredAgent } from "../types";
import { createWorld, listAgents } from "../api";

type Template =
  | "debate"
  | "discussion"
  | "werewolf"
  | "aquarium"
  | "problem-solving"
  | "human-lab"
  | "auction"
  | "ecosystem";

function LaunchWorldTab() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<StoredAgent[]>([]);
  const [template, setTemplate] = useState<Template>("debate");
  const [topic, setTopic] = useState("远程办公利大于弊");
  const [rounds, setRounds] = useState(2);

  // debate-only
  const [pro, setPro] = useState<string[]>([]);
  const [con, setCon] = useState<string[]>([]);
  const [judge, setJudge] = useState("");

  // discussion-only
  const [participants, setParticipants] = useState<string[]>([]);
  const [moderator, setModerator] = useState("");

  // werewolf-only
  const [werewolves, setWerewolves] = useState<string[]>([]);
  const [villagers, setVillagers] = useState<string[]>([]);
  const [seer, setSeer] = useState("");

  // aquarium-only
  const [fish, setFish] = useState<string[]>([]);
  const [ticks, setTicks] = useState(80);

  // problem-solving-only
  const [problem, setProblem] = useState("请解答这道结合了数值计算与图形分析的综合题。");
  const [coordinator, setCoordinator] = useState("");
  const [experts, setExperts] = useState<string[]>([]);

  // human-lab-only
  const [scenario, setScenario] = useState("囚徒困境的重复博弈：每一轮各自选择合作或背叛。");
  const [personas, setPersonas] = useState<Record<string, string>>({});
  const [observer, setObserver] = useState("");

  // auction-only
  const [itemsText, setItemsText] = useState("古董花瓶\n限量球鞋");
  const [valuations, setValuations] = useState<Record<string, string>>({});
  const [auctioneer, setAuctioneer] = useState("");

  // ecosystem-only
  const [predators, setPredators] = useState<string[]>([]);
  const [prey, setPrey] = useState<string[]>([]);
  const [ecoTicks, setEcoTicks] = useState(60);

  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listAgents()
      .then((list) => setAgents(list))
      .catch((err) => setError(err.message));
  }, []);

  function toggle(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);

    let agentIds: string[];
    let config: Record<string, unknown>;

    if (template === "debate") {
      if (pro.length === 0 || con.length === 0) {
        setError("正方和反方至少各需要一个 Agent");
        return;
      }
      agentIds = Array.from(new Set([...pro, ...con, ...(judge ? [judge] : [])]));
      config = { topic, rounds, sides: { pro, con }, judge: judge || undefined };
    } else if (template === "discussion") {
      if (participants.length === 0) {
        setError("至少需要一个参与者");
        return;
      }
      agentIds = Array.from(new Set([...participants, ...(moderator ? [moderator] : [])]));
      config = { topic, rounds, participants, moderator: moderator || undefined };
    } else if (template === "werewolf") {
      if (werewolves.length === 0) {
        setError("至少需要一个狼人");
        return;
      }
      if (villagers.length === 0 && !seer) {
        setError("狼人阵营之外至少需要一个村民或预言家，否则游戏一开始就结束了");
        return;
      }
      const players = Array.from(new Set([...werewolves, ...villagers, ...(seer ? [seer] : [])]));
      agentIds = players;
      config = { players, werewolves, seer: seer || undefined };
    } else if (template === "aquarium") {
      if (fish.length === 0) {
        setError("至少需要一条鱼");
        return;
      }
      agentIds = fish;
      config = { fish, ticks };
    } else if (template === "problem-solving") {
      if (!coordinator) {
        setError("需要指定一个协调者（世界管理者）");
        return;
      }
      if (experts.length === 0) {
        setError("至少需要一个专家 Agent");
        return;
      }
      agentIds = Array.from(new Set([coordinator, ...experts.filter((e) => e !== coordinator)]));
      config = { problem, coordinator, experts: experts.filter((e) => e !== coordinator) };
    } else if (template === "human-lab") {
      const withPersona = Object.entries(personas).filter(([, v]) => v.trim() && observer !== undefined);
      const chosen = withPersona.filter(([id]) => id !== observer);
      if (chosen.length === 0) {
        setError("至少需要一个被赋予性格的参与者");
        return;
      }
      const personaMap = Object.fromEntries(chosen.map(([id, v]) => [id, v.trim()]));
      agentIds = Array.from(new Set([...Object.keys(personaMap), ...(observer ? [observer] : [])]));
      config = { scenario, rounds, personas: personaMap, observer: observer || undefined };
    } else if (template === "auction") {
      const items = itemsText.split("\n").map((s) => s.trim()).filter(Boolean);
      if (items.length === 0) {
        setError("至少需要一件拍品");
        return;
      }
      const valMap = Object.fromEntries(
        Object.entries(valuations)
          .filter(([id, v]) => id !== auctioneer && v.trim() && Number(v) > 0)
          .map(([id, v]) => [id, Number(v)]),
      );
      if (Object.keys(valMap).length < 2) {
        setError("至少需要两个竞拍者（各给一个估值）");
        return;
      }
      agentIds = Array.from(new Set([...Object.keys(valMap), ...(auctioneer ? [auctioneer] : [])]));
      config = { items, valuations: valMap, auctioneer: auctioneer || undefined };
    } else {
      const preds = predators.filter((id) => !prey.includes(id));
      const preyIds = prey.filter((id) => !predators.includes(id));
      if (preds.length === 0 || preyIds.length === 0) {
        setError("至少需要一个捕食者和一个猎物");
        return;
      }
      agentIds = Array.from(new Set([...preds, ...preyIds]));
      config = { predators: preds, prey: preyIds, ticks: ecoTicks };
    }

    setSubmitting(true);
    try {
      const world = await createWorld({ template, agentIds, config });
      navigate(`/world/${world.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="launch-form">
      <h2>发起一个世界</h2>
      {error && <div className="form-error">{error}</div>}
      {agents.length === 0 && <p className="muted-cell">还没有 Agent，先去「Agent 管理」创建几个。</p>}
      <form onSubmit={handleSubmit}>
        <label>
          世界模板
          <select value={template} onChange={(e) => setTemplate(e.target.value as Template)}>
            <option value="debate">辩论赛</option>
            <option value="discussion">讨论组</option>
            <option value="werewolf">狼人杀</option>
            <option value="aquarium">水族箱</option>
            <option value="problem-solving">做题世界（工具编排）</option>
            <option value="human-lab">人性实验室</option>
            <option value="auction">密封拍卖</option>
            <option value="ecosystem">生态（捕食-猎物）</option>
          </select>
        </label>

        {(template === "debate" || template === "discussion") && (
          <>
            <label>
              {template === "debate" ? "辩题" : "讨论话题"}
              <input required value={topic} onChange={(e) => setTopic(e.target.value)} />
            </label>
            <label>
              轮次
              <input
                type="number"
                min={1}
                max={10}
                value={rounds}
                onChange={(e) => setRounds(Number(e.target.value))}
              />
            </label>
          </>
        )}

        {template === "debate" && (
          <>
            <fieldset>
              <legend>正方</legend>
              {agents.map((a) => (
                <label key={a.config.agentId} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={pro.includes(a.config.agentId)}
                    onChange={() => toggle(pro, setPro, a.config.agentId)}
                  />
                  {a.config.agentId} <span className="muted-cell">({a.config.adapter})</span>
                </label>
              ))}
            </fieldset>

            <fieldset>
              <legend>反方</legend>
              {agents.map((a) => (
                <label key={a.config.agentId} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={con.includes(a.config.agentId)}
                    onChange={() => toggle(con, setCon, a.config.agentId)}
                  />
                  {a.config.agentId} <span className="muted-cell">({a.config.adapter})</span>
                </label>
              ))}
            </fieldset>

            <label>
              裁判（可选）
              <select value={judge} onChange={(e) => setJudge(e.target.value)}>
                <option value="">无裁判</option>
                {agents.map((a) => (
                  <option key={a.config.agentId} value={a.config.agentId}>
                    {a.config.agentId}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {template === "discussion" && (
          <>
            <fieldset>
              <legend>参与者</legend>
              {agents.map((a) => (
                <label key={a.config.agentId} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={participants.includes(a.config.agentId)}
                    onChange={() => toggle(participants, setParticipants, a.config.agentId)}
                  />
                  {a.config.agentId} <span className="muted-cell">({a.config.adapter})</span>
                </label>
              ))}
            </fieldset>

            <label>
              主持人（可选，负责最后总结）
              <select value={moderator} onChange={(e) => setModerator(e.target.value)}>
                <option value="">无主持人</option>
                {agents.map((a) => (
                  <option key={a.config.agentId} value={a.config.agentId}>
                    {a.config.agentId}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {template === "werewolf" && (
          <>
            <fieldset>
              <legend>狼人</legend>
              {agents.map((a) => (
                <label key={a.config.agentId} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={werewolves.includes(a.config.agentId)}
                    onChange={() => toggle(werewolves, setWerewolves, a.config.agentId)}
                  />
                  {a.config.agentId} <span className="muted-cell">({a.config.adapter})</span>
                </label>
              ))}
            </fieldset>

            <fieldset>
              <legend>村民</legend>
              {agents.map((a) => (
                <label key={a.config.agentId} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={villagers.includes(a.config.agentId)}
                    onChange={() => toggle(villagers, setVillagers, a.config.agentId)}
                  />
                  {a.config.agentId} <span className="muted-cell">({a.config.adapter})</span>
                </label>
              ))}
            </fieldset>

            <label>
              预言家（可选）
              <select value={seer} onChange={(e) => setSeer(e.target.value)}>
                <option value="">无预言家</option>
                {agents.map((a) => (
                  <option key={a.config.agentId} value={a.config.agentId}>
                    {a.config.agentId}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted-cell">
              同一个 Agent 只应出现在一个身份里；上帝视角（时间轴/管理侧）始终能看到所有身份，Agent 之间的信息差只体现在它们各自收到的观测里。
            </p>
          </>
        )}

        {template === "aquarium" && (
          <>
            <fieldset>
              <legend>鱼群（每条鱼是一个 Agent）</legend>
              {agents.map((a) => (
                <label key={a.config.agentId} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={fish.includes(a.config.agentId)}
                    onChange={() => toggle(fish, setFish, a.config.agentId)}
                  />
                  {a.config.agentId} <span className="muted-cell">({a.config.adapter})</span>
                </label>
              ))}
            </fieldset>

            <label>
              总 tick 数（模拟时长）
              <input
                type="number"
                min={10}
                max={400}
                value={ticks}
                onChange={(e) => setTicks(Number(e.target.value))}
              />
            </label>
            <p className="muted-cell">
              这是首个 tick-based（连续模拟）世界：鱼每隔几 tick 才重新决策一次游动行为，其余 tick 是确定性物理推进；服务端按固定节奏（150ms/tick）推进，可在展示侧实时观看。
            </p>
          </>
        )}

        {template === "problem-solving" && (
          <>
            <label>
              题目
              <textarea rows={3} value={problem} onChange={(e) => setProblem(e.target.value)} />
            </label>
            <label>
              协调者（世界管理者，负责派活并汇总最终解答）
              <select value={coordinator} onChange={(e) => setCoordinator(e.target.value)}>
                <option value="">选择一个 Agent</option>
                {agents.map((a) => (
                  <option key={a.config.agentId} value={a.config.agentId}>
                    {a.config.agentId}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>专家 / 工具 Agent</legend>
              {agents.map((a) => (
                <label key={a.config.agentId} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={experts.includes(a.config.agentId)}
                    onChange={() => toggle(experts, setExperts, a.config.agentId)}
                  />
                  {a.config.agentId} <span className="muted-cell">({a.config.adapter})</span>
                </label>
              ))}
            </fieldset>
            <p className="muted-cell">
              协调者会反复决定把问题交给哪个专家、或直接汇总；你也可以在运行时用「上帝指令」给协调者下达高层任务，由它代为指挥执行。
            </p>
          </>
        )}

        {template === "human-lab" && (
          <>
            <label>
              情境设定
              <textarea rows={3} value={scenario} onChange={(e) => setScenario(e.target.value)} />
            </label>
            <label>
              轮次
              <input type="number" min={1} max={10} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
            </label>
            <fieldset>
              <legend>参与者与其（私密）性格设定</legend>
              {agents
                .filter((a) => a.config.agentId !== observer)
                .map((a) => (
                  <div key={a.config.agentId} className="persona-row">
                    <input
                      value={personas[a.config.agentId] ?? ""}
                      onChange={(e) => setPersonas({ ...personas, [a.config.agentId]: e.target.value })}
                      placeholder={`${a.config.agentId} 的性格，如「乐观、信任他人」；留空则不参与`}
                    />
                  </div>
                ))}
            </fieldset>
            <label>
              观察者（可选，最后分析群体互动）
              <select value={observer} onChange={(e) => setObserver(e.target.value)}>
                <option value="">无观察者</option>
                {agents.map((a) => (
                  <option key={a.config.agentId} value={a.config.agentId}>
                    {a.config.agentId}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted-cell">
              每个参与者只知道自己的性格（复用狼人杀那套 visibleTo 隐藏机制），上帝视角在时间轴能看到所有人的性格设定。
            </p>
          </>
        )}

        {template === "auction" && (
          <>
            <label>
              拍品（每行一件，按顺序逐件密封竞拍）
              <textarea rows={3} value={itemsText} onChange={(e) => setItemsText(e.target.value)} />
            </label>
            <fieldset>
              <legend>竞拍者与其（私密）估值</legend>
              {agents
                .filter((a) => a.config.agentId !== auctioneer)
                .map((a) => (
                  <div key={a.config.agentId} className="persona-row">
                    <span style={{ minWidth: 90 }}>{a.config.agentId}</span>
                    <input
                      type="number"
                      min={0}
                      value={valuations[a.config.agentId] ?? ""}
                      onChange={(e) => setValuations({ ...valuations, [a.config.agentId]: e.target.value })}
                      placeholder="估值（留空则不参与）"
                    />
                  </div>
                ))}
            </fieldset>
            <label>
              拍卖师（可选，居中主持，不参与出价）
              <select value={auctioneer} onChange={(e) => setAuctioneer(e.target.value)}>
                <option value="">无拍卖师</option>
                {agents.map((a) => (
                  <option key={a.config.agentId} value={a.config.agentId}>
                    {a.config.agentId}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted-cell">
              密封投标：所有竞拍者同时私密出一个数字（复用并发批 + visibleTo），最高者中标、按其出价成交（第一价）。每人只知自己的估值，上帝视角可见全部出价。
            </p>
          </>
        )}

        {template === "ecosystem" && (
          <>
            <fieldset>
              <legend>捕食者（狐狸）</legend>
              {agents.map((a) => (
                <label key={a.config.agentId} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={predators.includes(a.config.agentId)}
                    onChange={() => toggle(predators, setPredators, a.config.agentId)}
                  />
                  {a.config.agentId} <span className="muted-cell">({a.config.adapter})</span>
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>猎物（兔子）</legend>
              {agents.map((a) => (
                <label key={a.config.agentId} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={prey.includes(a.config.agentId)}
                    onChange={() => toggle(prey, setPrey, a.config.agentId)}
                  />
                  {a.config.agentId} <span className="muted-cell">({a.config.adapter})</span>
                </label>
              ))}
            </fieldset>
            <label>
              总 tick 数
              <input type="number" min={10} max={300} value={ecoTicks} onChange={(e) => setEcoTicks(Number(e.target.value))} />
            </label>
            <p className="muted-cell">
              tick 制连续模拟：捕食者追捕、猎物逃跑，捕食转移能量、无食物则饿死；某一方灭绝或达到 tick 上限即结束。
            </p>
          </>
        )}

        <div className="form-actions">
          <button type="submit" disabled={submitting || agents.length === 0}>
            发起
          </button>
        </div>
      </form>
    </div>
  );
}

export default LaunchWorldTab;
