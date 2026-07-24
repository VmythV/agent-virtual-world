import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { StoredAgent } from "../types";
import { createWorld, listAgents } from "../api";

type Template = "debate" | "discussion" | "werewolf" | "aquarium" | "problem-solving";

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
    } else {
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
