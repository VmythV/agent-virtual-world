import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { StoredAgent } from "../types";
import { createWorld, listAgents } from "../api";

function LaunchWorldTab() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<StoredAgent[]>([]);
  const [topic, setTopic] = useState("远程办公利大于弊");
  const [rounds, setRounds] = useState(2);
  const [pro, setPro] = useState<string[]>([]);
  const [con, setCon] = useState<string[]>([]);
  const [judge, setJudge] = useState("");
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
    if (pro.length === 0 || con.length === 0) {
      setError("正方和反方至少各需要一个 Agent");
      return;
    }
    setSubmitting(true);
    try {
      const agentIds = Array.from(new Set([...pro, ...con, ...(judge ? [judge] : [])]));
      const world = await createWorld({
        template: "debate",
        agentIds,
        config: { topic, rounds, sides: { pro, con }, judge: judge || undefined },
      });
      navigate(`/world/${world.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="launch-form">
      <h2>发起一场辩论</h2>
      {error && <div className="form-error">{error}</div>}
      {agents.length === 0 && <p className="muted-cell">还没有 Agent，先去「Agent 管理」创建几个。</p>}
      <form onSubmit={handleSubmit}>
        <label>
          辩题
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
