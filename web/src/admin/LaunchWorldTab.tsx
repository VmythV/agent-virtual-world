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
  | "ecosystem"
  | "courtroom"
  | "collab-build"
  | "negotiation"
  | "market"
  | "escape-room"
  | "research"
  | "reproduction"
  | "parliament"
  | "prediction-market";

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

  // courtroom-only
  const [caseTitle, setCaseTitle] = useState("国家 诉 被告：盗窃案");
  const [prosecutor, setProsecutor] = useState("");
  const [defenseCounsel, setDefenseCounsel] = useState("");
  const [judgeAgent, setJudgeAgent] = useState("");
  const [testimonies, setTestimonies] = useState<Record<string, string>>({});

  // collab-build-only
  const [task, setTask] = useState("共同写出一个项目进度文档 progress.md");
  const [builders, setBuilders] = useState<string[]>([]);

  // negotiation-only
  const [prize, setPrize] = useState("100 金币");
  const [negPlayers, setNegPlayers] = useState<string[]>([]);

  // market-only: each agent can be a buyer (cash/value) or seller (units/cost)
  const [good, setGood] = useState("小麦");
  const [buyerRows, setBuyerRows] = useState<Record<string, { cash: string; value: string }>>({});
  const [sellerRows, setSellerRows] = useState<Record<string, { units: string; cost: string }>>({});

  // escape-room-only
  const [puzzle, setPuzzle] = useState("打开三位数密码锁逃出房间");
  const [solution, setSolution] = useState("738");
  const [clues, setClues] = useState<Record<string, string>>({});
  const [solverAgent, setSolverAgent] = useState("");

  // research-only
  const [question, setQuestion] = useState("某项技术的可行性如何？");
  const [researchers, setResearchers] = useState<string[]>([]);
  const [leadAgent, setLeadAgent] = useState("");

  // reproduction-only
  const [founders, setFounders] = useState<string[]>([]);
  const [repTicks, setRepTicks] = useState(80);
  const [maxPopulation, setMaxPopulation] = useState(40);

  // parliament-only
  const [bill, setBill] = useState("《远程办公保障法》");
  const [members, setMembers] = useState<string[]>([]);
  const [stances, setStances] = useState<Record<string, string>>({});
  const [speaker, setSpeaker] = useState("");

  // prediction-market-only
  const [event, setEvent] = useState("下季度产品会如期发布吗？");
  const [outcome, setOutcome] = useState(true);
  const [pmBuyerRows, setPmBuyerRows] = useState<Record<string, { cash: string; belief: string }>>({});
  const [pmSellerRows, setPmSellerRows] = useState<Record<string, { shares: string; belief: string }>>({});

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
    } else if (template === "ecosystem") {
      const preds = predators.filter((id) => !prey.includes(id));
      const preyIds = prey.filter((id) => !predators.includes(id));
      if (preds.length === 0 || preyIds.length === 0) {
        setError("至少需要一个捕食者和一个猎物");
        return;
      }
      agentIds = Array.from(new Set([...preds, ...preyIds]));
      config = { predators: preds, prey: preyIds, ticks: ecoTicks };
    } else if (template === "courtroom") {
      if (!prosecutor || !defenseCounsel || !judgeAgent) {
        setError("需要指定控方、辩方和法官");
        return;
      }
      const witnesses = Object.fromEntries(
        Object.entries(testimonies)
          .filter(([id, v]) => v.trim() && ![prosecutor, defenseCounsel, judgeAgent].includes(id))
          .map(([id, v]) => [id, v.trim()]),
      );
      agentIds = Array.from(new Set([prosecutor, defenseCounsel, judgeAgent, ...Object.keys(witnesses)]));
      config = { caseTitle, prosecutor, defense: defenseCounsel, judge: judgeAgent, witnesses, rounds };
    } else if (template === "collab-build") {
      if (builders.length === 0) {
        setError("至少需要一个 builder（建议用 CLI 适配器的 Agent 才能真正写文件）");
        return;
      }
      agentIds = builders;
      config = { task, builders, rounds };
    } else if (template === "negotiation") {
      if (negPlayers.length < 3) {
        setError("谈判至少需要 3 个玩家才有联盟博弈");
        return;
      }
      agentIds = negPlayers;
      config = { prize, players: negPlayers, rounds };
    } else if (template === "market") {
      const buyers = Object.fromEntries(
        Object.entries(buyerRows)
          .filter(([id, r]) => !sellerRows[id]?.units && Number(r.cash) > 0 && Number(r.value) > 0)
          .map(([id, r]) => [id, { cash: Number(r.cash), value: Number(r.value) }]),
      );
      const sellers = Object.fromEntries(
        Object.entries(sellerRows)
          .filter(([id, r]) => !buyerRows[id]?.cash && Number(r.units) > 0 && Number(r.cost) >= 0)
          .map(([id, r]) => [id, { units: Number(r.units), cost: Number(r.cost) }]),
      );
      if (Object.keys(buyers).length === 0 || Object.keys(sellers).length === 0) {
        setError("至少各需要一个买家（现金+估值）和一个卖家（数量+成本）");
        return;
      }
      agentIds = Array.from(new Set([...Object.keys(buyers), ...Object.keys(sellers)]));
      config = { good, buyers, sellers, rounds };
    } else if (template === "escape-room") {
      const clueMap = Object.fromEntries(
        Object.entries(clues).filter(([id, v]) => v.trim() && id !== solverAgent).map(([id, v]) => [id, v.trim()]),
      );
      if (Object.keys(clueMap).length < 2 || !solverAgent || !solution.trim()) {
        setError("至少需要两名持线索的成员、一个解谜者和一个答案");
        return;
      }
      agentIds = Array.from(new Set([...Object.keys(clueMap), solverAgent]));
      config = { puzzle, solution, clues: clueMap, solver: solverAgent, rounds };
    } else if (template === "reproduction") {
      if (founders.length === 0) {
        setError("至少需要一个初代生物");
        return;
      }
      agentIds = founders;
      config = { founders, ticks: repTicks, maxPopulation };
    } else if (template === "parliament") {
      if (members.length < 3) {
        setError("议会至少需要 3 名议员才有党团博弈");
        return;
      }
      const stanceMap = Object.fromEntries(
        Object.entries(stances).filter(([id, v]) => members.includes(id) && v.trim()).map(([id, v]) => [id, v.trim()]),
      );
      agentIds = Array.from(new Set([...members, ...(speaker ? [speaker] : [])]));
      config = { bill, members, stances: stanceMap, speaker: speaker || undefined, rounds };
    } else if (template === "prediction-market") {
      const buyers = Object.fromEntries(
        Object.entries(pmBuyerRows)
          .filter(([id, r]) => !pmSellerRows[id]?.shares && Number(r.cash) > 0 && Number(r.belief) >= 0)
          .map(([id, r]) => [id, { cash: Number(r.cash), belief: Number(r.belief) }]),
      );
      const sellers = Object.fromEntries(
        Object.entries(pmSellerRows)
          .filter(([id, r]) => !pmBuyerRows[id]?.cash && Number(r.shares) > 0 && Number(r.belief) >= 0)
          .map(([id, r]) => [id, { shares: Number(r.shares), belief: Number(r.belief) }]),
      );
      if (Object.keys(buyers).length === 0 || Object.keys(sellers).length === 0) {
        setError("至少各需要一个买家（现金+信念）和一个卖家（合约数+信念）");
        return;
      }
      agentIds = Array.from(new Set([...Object.keys(buyers), ...Object.keys(sellers)]));
      config = { event, outcome, buyers, sellers, rounds };
    } else {
      const rs = researchers.filter((id) => id !== leadAgent);
      if (rs.length === 0 || !leadAgent) {
        setError("至少需要一个研究员和一个汇总者（lead）");
        return;
      }
      agentIds = Array.from(new Set([...rs, leadAgent]));
      config = { question, researchers: rs, lead: leadAgent, rounds };
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
            <option value="courtroom">法庭</option>
            <option value="collab-build">协作编码（共享工作区）</option>
            <option value="negotiation">谈判/外交（联盟博弈）</option>
            <option value="market">市场/交易所</option>
            <option value="escape-room">密室逃脱（非对称线索）</option>
            <option value="research">研究/工具调用</option>
            <option value="reproduction">繁殖/种群（运行时动态生成 Agent）</option>
            <option value="parliament">议会（法案表决 · 换皮自联盟博弈）</option>
            <option value="prediction-market">预测市场（事件概率 · 换皮自双向拍卖）</option>
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

        {template === "courtroom" && (
          <>
            <label>
              案由
              <input required value={caseTitle} onChange={(e) => setCaseTitle(e.target.value)} />
            </label>
            <div className="persona-row">
              <span style={{ minWidth: 60 }}>控方</span>
              <select value={prosecutor} onChange={(e) => setProsecutor(e.target.value)}>
                <option value="">选择</option>
                {agents.map((a) => (
                  <option key={a.config.agentId} value={a.config.agentId}>{a.config.agentId}</option>
                ))}
              </select>
            </div>
            <div className="persona-row">
              <span style={{ minWidth: 60 }}>辩方</span>
              <select value={defenseCounsel} onChange={(e) => setDefenseCounsel(e.target.value)}>
                <option value="">选择</option>
                {agents.map((a) => (
                  <option key={a.config.agentId} value={a.config.agentId}>{a.config.agentId}</option>
                ))}
              </select>
            </div>
            <div className="persona-row">
              <span style={{ minWidth: 60 }}>法官</span>
              <select value={judgeAgent} onChange={(e) => setJudgeAgent(e.target.value)}>
                <option value="">选择</option>
                {agents.map((a) => (
                  <option key={a.config.agentId} value={a.config.agentId}>{a.config.agentId}</option>
                ))}
              </select>
            </div>
            <label>
              辩论轮次
              <input type="number" min={1} max={6} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
            </label>
            <fieldset>
              <legend>证人与其（私密）掌握的事实</legend>
              {agents
                .filter((a) => ![prosecutor, defenseCounsel, judgeAgent].includes(a.config.agentId))
                .map((a) => (
                  <div key={a.config.agentId} className="persona-row">
                    <span style={{ minWidth: 90 }}>{a.config.agentId}</span>
                    <input
                      value={testimonies[a.config.agentId] ?? ""}
                      onChange={(e) => setTestimonies({ ...testimonies, [a.config.agentId]: e.target.value })}
                      placeholder="该证人私密掌握的事实（留空则不作为证人）"
                    />
                  </div>
                ))}
            </fieldset>
            <p className="muted-cell">
              证人先各自作证（其私密事实作证后才公开，复用 visibleTo），控辩双方按轮辩论，最后法官裁决。
            </p>
          </>
        )}

        {template === "collab-build" && (
          <>
            <label>
              任务
              <textarea rows={2} value={task} onChange={(e) => setTask(e.target.value)} />
            </label>
            <label>
              每人轮到几次
              <input type="number" min={1} max={5} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
            </label>
            <fieldset>
              <legend>Builder（按勾选顺序轮流在同一工作区里干活）</legend>
              {agents.map((a) => (
                <label key={a.config.agentId} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={builders.includes(a.config.agentId)}
                    onChange={() => toggle(builders, setBuilders, a.config.agentId)}
                  />
                  {a.config.agentId} <span className="muted-cell">({a.config.adapter})</span>
                </label>
              ))}
            </fieldset>
            <p className="muted-cell">
              首个需要「跨回合共享持久工作区」的场景：模板建一个 git 工作区，每个 builder 的 CLI 进程都在同一目录里干活（而非各自沙箱），每步提交并把 diff 显示在时间轴。要真正写代码，请给 builder 用 <code>cli</code> 适配器（claude-code 预设或 custom 命令）。
            </p>
          </>
        )}

        {template === "negotiation" && (
          <>
            <label>
              奖品（争夺的目标）
              <input required value={prize} onChange={(e) => setPrize(e.target.value)} />
            </label>
            <label>
              结盟轮次
              <input type="number" min={1} max={5} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
            </label>
            <fieldset>
              <legend>玩家（≥3 才有联盟博弈）</legend>
              {agents.map((a) => (
                <label key={a.config.agentId} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={negPlayers.includes(a.config.agentId)}
                    onChange={() => toggle(negPlayers, setNegPlayers, a.config.agentId)}
                  />
                  {a.config.agentId} <span className="muted-cell">({a.config.adapter})</span>
                </label>
              ))}
            </fieldset>
            <p className="muted-cell">
              每轮玩家同时私密选一个结盟对象（<code>pact.offer</code> 只对该二人可见），互选即成盟；最后投票争夺奖品，联盟往往抱团。上帝视角可见全部私密提议与联盟图。
            </p>
          </>
        )}

        {template === "market" && (
          <>
            <label>
              商品
              <input required value={good} onChange={(e) => setGood(e.target.value)} />
            </label>
            <label>
              交易轮次
              <input type="number" min={1} max={10} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
            </label>
            <fieldset>
              <legend>买家（填现金 + 私密估值即成为买家）</legend>
              {agents.map((a) => (
                <div key={a.config.agentId} className="persona-row">
                  <span style={{ minWidth: 90 }}>{a.config.agentId}</span>
                  <input
                    type="number"
                    placeholder="现金"
                    value={buyerRows[a.config.agentId]?.cash ?? ""}
                    onChange={(e) => setBuyerRows({ ...buyerRows, [a.config.agentId]: { ...buyerRows[a.config.agentId], cash: e.target.value } })}
                  />
                  <input
                    type="number"
                    placeholder="估值/单位"
                    value={buyerRows[a.config.agentId]?.value ?? ""}
                    onChange={(e) => setBuyerRows({ ...buyerRows, [a.config.agentId]: { ...buyerRows[a.config.agentId], value: e.target.value } })}
                  />
                </div>
              ))}
            </fieldset>
            <fieldset>
              <legend>卖家（填数量 + 私密成本即成为卖家）</legend>
              {agents.map((a) => (
                <div key={a.config.agentId} className="persona-row">
                  <span style={{ minWidth: 90 }}>{a.config.agentId}</span>
                  <input
                    type="number"
                    placeholder="持有数量"
                    value={sellerRows[a.config.agentId]?.units ?? ""}
                    onChange={(e) => setSellerRows({ ...sellerRows, [a.config.agentId]: { ...sellerRows[a.config.agentId], units: e.target.value } })}
                  />
                  <input
                    type="number"
                    placeholder="成本/单位"
                    value={sellerRows[a.config.agentId]?.cost ?? ""}
                    onChange={(e) => setSellerRows({ ...sellerRows, [a.config.agentId]: { ...sellerRows[a.config.agentId], cost: e.target.value } })}
                  />
                </div>
              ))}
            </fieldset>
            <p className="muted-cell">
              双向拍卖：每轮买家出价、卖家要价（数值动作，私密），撮合高买对低卖、按中间价成交，现金与货物在各自持久余额间转移，多轮后价格收敛。每人只知自己的估值/成本。
            </p>
          </>
        )}

        {template === "escape-room" && (
          <>
            <label>
              谜题
              <input required value={puzzle} onChange={(e) => setPuzzle(e.target.value)} />
            </label>
            <label>
              正确答案（solver 的回答需包含它）
              <input required value={solution} onChange={(e) => setSolution(e.target.value)} />
            </label>
            <label>
              分享轮数
              <input type="number" min={1} max={5} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
            </label>
            <label>
              解谜者
              <select value={solverAgent} onChange={(e) => setSolverAgent(e.target.value)}>
                <option value="">选择一个 Agent</option>
                {agents.map((a) => (
                  <option key={a.config.agentId} value={a.config.agentId}>{a.config.agentId}</option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>成员与其（私密）线索</legend>
              {agents
                .filter((a) => a.config.agentId !== solverAgent)
                .map((a) => (
                  <div key={a.config.agentId} className="persona-row">
                    <span style={{ minWidth: 90 }}>{a.config.agentId}</span>
                    <input
                      value={clues[a.config.agentId] ?? ""}
                      onChange={(e) => setClues({ ...clues, [a.config.agentId]: e.target.value })}
                      placeholder="该成员私密掌握的线索（留空则不参与）"
                    />
                  </div>
                ))}
            </fieldset>
            <p className="muted-cell">
              合作型非对称信息：每个成员只看到自己的线索（<code>visibleTo</code>），谁都无法独自解开；分享后由解谜者拼出答案。上帝视角可见全部线索。
            </p>
          </>
        )}

        {template === "research" && (
          <>
            <label>
              研究问题
              <input required value={question} onChange={(e) => setQuestion(e.target.value)} />
            </label>
            <label>
              研究轮次
              <input type="number" min={1} max={5} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
            </label>
            <label>
              汇总者 lead
              <select value={leadAgent} onChange={(e) => setLeadAgent(e.target.value)}>
                <option value="">选择一个 Agent</option>
                {agents.map((a) => (
                  <option key={a.config.agentId} value={a.config.agentId}>{a.config.agentId}</option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>研究员（建议用开启「允许工具」的 claude-code 适配器才能真正查证）</legend>
              {agents.map((a) => (
                <label key={a.config.agentId} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={researchers.includes(a.config.agentId)}
                    onChange={() => toggle(researchers, setResearchers, a.config.agentId)}
                  />
                  {a.config.agentId} <span className="muted-cell">({a.config.adapter})</span>
                </label>
              ))}
            </fieldset>
            <p className="muted-cell">
              首个需要「真实外部 I/O」的场景：研究员应使用开启工具的 CLI Agent（在 Agent 管理里给 claude-code 预设勾选「允许工具」），去真正搜索/读写/执行查证问题，lead 最后汇总。
            </p>
          </>
        )}

        {template === "reproduction" && (
          <>
            <fieldset>
              <legend>初代生物（每个是一个 Agent；后代在运行时动态生成）</legend>
              {agents.map((a) => (
                <label key={a.config.agentId} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={founders.includes(a.config.agentId)}
                    onChange={() => toggle(founders, setFounders, a.config.agentId)}
                  />
                  {a.config.agentId} <span className="muted-cell">({a.config.adapter})</span>
                </label>
              ))}
            </fieldset>
            <label>
              总 tick 数
              <input type="number" min={10} max={300} value={repTicks} onChange={(e) => setRepTicks(Number(e.target.value))} />
            </label>
            <label>
              种群上限
              <input type="number" min={2} max={200} value={maxPopulation} onChange={(e) => setMaxPopulation(Number(e.target.value))} />
            </label>
            <p className="muted-cell">
              首个「运行时动态生成 Agent」的场景，补上引擎最后一块生命周期能力：生物觅食积累能量，能量够高就分裂出<strong>一个全新 id 的后代</strong>（一个在世界创建时并未注册的 Agent，靠调度器的 <code>defaultAgent</code> 兜底决策），能量耗尽则饿死。种群随之涨落，直到灭绝、触顶或 tick 用尽。复用生态的 3D 渲染（绿色个体）。
            </p>
          </>
        )}

        {template === "parliament" && (
          <>
            <label>
              法案
              <input required value={bill} onChange={(e) => setBill(e.target.value)} />
            </label>
            <label>
              党团串联轮次
              <input type="number" min={1} max={5} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
            </label>
            <fieldset>
              <legend>议员（≥3 才有党团博弈）</legend>
              {agents
                .filter((a) => a.config.agentId !== speaker)
                .map((a) => (
                  <div key={a.config.agentId} className="persona-row">
                    <label className="checkbox-row" style={{ minWidth: 150 }}>
                      <input
                        type="checkbox"
                        checked={members.includes(a.config.agentId)}
                        onChange={() => toggle(members, setMembers, a.config.agentId)}
                      />
                      {a.config.agentId} <span className="muted-cell">({a.config.adapter})</span>
                    </label>
                    <input
                      value={stances[a.config.agentId] ?? ""}
                      onChange={(e) => setStances({ ...stances, [a.config.agentId]: e.target.value })}
                      placeholder="私密立场（可留空），如「支持/反对」"
                    />
                  </div>
                ))}
            </fieldset>
            <label>
              议长（可选，居中主持，不参与表决）
              <select value={speaker} onChange={(e) => setSpeaker(e.target.value)}>
                <option value="">无议长</option>
                {agents.map((a) => (
                  <option key={a.config.agentId} value={a.config.agentId}>{a.config.agentId}</option>
                ))}
              </select>
            </label>
            <p className="muted-cell">
              换皮自「谈判/外交」的联盟博弈：议员先私密串联党团（<code>whip.offer</code> 仅对该二人可见），互选成团；再对法案投 <code>yes/no/abstain</code>，赞成多于反对即通过。每人只知自己的私密立场，上帝视角可见全部党鞭与党团图。未改动任何引擎能力。
            </p>
          </>
        )}

        {template === "prediction-market" && (
          <>
            <label>
              事件（市场为其定价的二元未来）
              <input required value={event} onChange={(e) => setEvent(e.target.value)} />
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={outcome} onChange={(e) => setOutcome(e.target.checked)} />
              真实结果 = 会发生（YES 合约到期结算 100，否则 0）——仅上帝可见，交易者看不到
            </label>
            <label>
              交易轮次
              <input type="number" min={1} max={10} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
            </label>
            <fieldset>
              <legend>买家（填现金 + 私密信念概率 0~1 即成为买家）</legend>
              {agents.map((a) => (
                <div key={a.config.agentId} className="persona-row">
                  <span style={{ minWidth: 90 }}>{a.config.agentId}</span>
                  <input
                    type="number"
                    placeholder="现金"
                    value={pmBuyerRows[a.config.agentId]?.cash ?? ""}
                    onChange={(e) => setPmBuyerRows({ ...pmBuyerRows, [a.config.agentId]: { ...pmBuyerRows[a.config.agentId], cash: e.target.value } })}
                  />
                  <input
                    type="number"
                    step="0.05"
                    min={0}
                    max={1}
                    placeholder="信念 0~1"
                    value={pmBuyerRows[a.config.agentId]?.belief ?? ""}
                    onChange={(e) => setPmBuyerRows({ ...pmBuyerRows, [a.config.agentId]: { ...pmBuyerRows[a.config.agentId], belief: e.target.value } })}
                  />
                </div>
              ))}
            </fieldset>
            <fieldset>
              <legend>卖家（填持有合约数 + 私密信念概率即成为卖家）</legend>
              {agents.map((a) => (
                <div key={a.config.agentId} className="persona-row">
                  <span style={{ minWidth: 90 }}>{a.config.agentId}</span>
                  <input
                    type="number"
                    placeholder="持有合约"
                    value={pmSellerRows[a.config.agentId]?.shares ?? ""}
                    onChange={(e) => setPmSellerRows({ ...pmSellerRows, [a.config.agentId]: { ...pmSellerRows[a.config.agentId], shares: e.target.value } })}
                  />
                  <input
                    type="number"
                    step="0.05"
                    min={0}
                    max={1}
                    placeholder="信念 0~1"
                    value={pmSellerRows[a.config.agentId]?.belief ?? ""}
                    onChange={(e) => setPmSellerRows({ ...pmSellerRows, [a.config.agentId]: { ...pmSellerRows[a.config.agentId], belief: e.target.value } })}
                  />
                </div>
              ))}
            </fieldset>
            <p className="muted-cell">
              换皮自「市场/交易所」的双向拍卖：买卖 YES 合约，成交价即市场的<strong>隐含概率</strong>；每轮撮合高买低卖、按中间价成交。回合结束后事件按上帝设定的真实结果结算（YES=100 或 0），最终财富揭示谁对未来定价最准。每人只知自己的私密信念，真实结果全程对交易者保密。未改动任何引擎能力。
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
