import { useEffect, useState } from "react";
import type { AgentConfig, StoredAgent } from "../types";
import { createAgent, deleteAgent, listAgents, updateAgent } from "../api";

type Adapter = "api" | "mock" | "cli" | "human";
type CliPreset = "claude-code" | "custom";

interface FormState {
  agentId: string;
  adapter: Adapter;
  systemPrompt: string;
  model: string;
  responsesText: string;
  cliPreset: CliPreset;
  maxBudgetUsd: string;
  allowTools: boolean;
  customCommand: string;
  customArgsText: string;
}

const EMPTY_FORM: FormState = {
  agentId: "",
  adapter: "mock",
  systemPrompt: "",
  model: "",
  responsesText: "",
  cliPreset: "claude-code",
  maxBudgetUsd: "0.05",
  allowTools: false,
  customCommand: "",
  customArgsText: "",
};

function AgentsTab() {
  const [agents, setAgents] = useState<StoredAgent[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const load = () => {
    listAgents()
      .then(setAgents)
      .catch((err) => setError(err.message));
  };

  useEffect(load, []);

  function startEdit(agent: StoredAgent) {
    setEditingId(agent.config.agentId);
    setForm(configToForm(agent.config));
    setError(undefined);
  }

  function startCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(undefined);
  }

  async function handleDelete(id: string) {
    if (!window.confirm(`删除 Agent "${id}"？`)) return;
    try {
      await deleteAgent(id);
      if (editingId === id) startCreate();
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setSaving(true);
    try {
      const config = formToConfig(form);
      if (editingId) {
        await updateAgent(editingId, config);
      } else {
        await createAgent(config);
      }
      startCreate();
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="agents-tab">
      <section className="agents-list">
        <h2>已注册 Agent</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>适配器</th>
              <th>摘要</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.config.agentId}>
                <td className="mono">{agent.config.agentId}</td>
                <td>{agent.config.adapter}</td>
                <td className="muted-cell">{summarize(agent.config)}</td>
                <td className="row-actions">
                  <button onClick={() => startEdit(agent)}>编辑</button>
                  <button onClick={() => handleDelete(agent.config.agentId)}>删除</button>
                </td>
              </tr>
            ))}
            {agents.length === 0 && (
              <tr>
                <td colSpan={4} className="muted-cell">
                  还没有 Agent，在右侧创建一个
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="agent-form">
        <h2>{editingId ? `编辑 Agent "${editingId}"` : "新建 Agent"}</h2>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <label>
            Agent ID
            <input
              required
              disabled={!!editingId}
              value={form.agentId}
              onChange={(e) => setForm({ ...form, agentId: e.target.value })}
              placeholder="pro-1"
            />
          </label>

          <label>
            适配器类型
            <select
              value={form.adapter}
              onChange={(e) => setForm({ ...form, adapter: e.target.value as Adapter })}
            >
              <option value="mock">mock（免费、确定性，用于测试）</option>
              <option value="api">api（直接调用 Anthropic API）</option>
              <option value="cli">cli（拉起 Coding Agent CLI 进程）</option>
              <option value="human">human（由你在展示侧亲自操作这个席位）</option>
            </select>
          </label>

          {form.adapter === "api" && (
            <>
              <label>
                System Prompt
                <textarea
                  required
                  rows={3}
                  value={form.systemPrompt}
                  onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                />
              </label>
              <label>
                模型（可选）
                <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="claude-sonnet-5" />
              </label>
            </>
          )}

          {form.adapter === "mock" && (
            <label>
              固定回复（每行一条，按调用顺序循环）
              <textarea
                required
                rows={4}
                value={form.responsesText}
                onChange={(e) => setForm({ ...form, responsesText: e.target.value })}
                placeholder={"第一句\n第二句"}
              />
            </label>
          )}

          {form.adapter === "cli" && (
            <>
              <label>
                CLI 预设
                <select
                  value={form.cliPreset}
                  onChange={(e) => setForm({ ...form, cliPreset: e.target.value as CliPreset })}
                >
                  <option value="claude-code">claude-code（真实 claude -p 非交互调用）</option>
                  <option value="custom">custom（自定义命令 + 参数）</option>
                </select>
              </label>

              {form.cliPreset === "claude-code" ? (
                <>
                  <label>
                    System Prompt
                    <textarea
                      required
                      rows={3}
                      value={form.systemPrompt}
                      onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                    />
                  </label>
                  <label>
                    模型
                    <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="haiku" />
                  </label>
                  <label>
                    单次调用预算上限（美元）
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.maxBudgetUsd}
                      onChange={(e) => setForm({ ...form, maxBudgetUsd: e.target.value })}
                    />
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={form.allowTools}
                      onChange={(e) => setForm({ ...form, allowTools: e.target.checked })}
                    />
                    允许工具（搜索/读写/执行）—— 研究类世界需要；默认关闭（最小权限）
                  </label>
                </>
              ) : (
                <>
                  <label>
                    命令
                    <input
                      required
                      value={form.customCommand}
                      onChange={(e) => setForm({ ...form, customCommand: e.target.value })}
                      placeholder="/usr/bin/node"
                    />
                  </label>
                  <label>
                    参数（每行一个，脚本路径请用绝对路径——进程运行在临时沙箱目录下）
                    <textarea
                      rows={3}
                      value={form.customArgsText}
                      onChange={(e) => setForm({ ...form, customArgsText: e.target.value })}
                      placeholder={"/absolute/path/to/script.mjs"}
                    />
                  </label>
                  {relativeScriptArgs(form.customArgsText).length > 0 && (
                    <div className="form-warning">
                      ⚠ 检测到疑似相对路径参数：{relativeScriptArgs(form.customArgsText).join("、")}
                      。CLI 进程运行在每次调用新建的临时沙箱目录里，相对路径会解析失败——请改用绝对路径。
                    </div>
                  )}
                </>
              )}
            </>
          )}

          <div className="form-actions">
            <button type="submit" disabled={saving}>
              {editingId ? "保存修改" : "创建"}
            </button>
            {editingId && (
              <button type="button" onClick={startCreate}>
                取消编辑
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

function configToForm(config: AgentConfig): FormState {
  if (config.adapter === "api") {
    return { ...EMPTY_FORM, agentId: config.agentId, adapter: "api", systemPrompt: config.systemPrompt, model: config.model ?? "" };
  }
  if (config.adapter === "human") {
    return { ...EMPTY_FORM, agentId: config.agentId, adapter: "human" };
  }
  if (config.adapter === "mock") {
    return { ...EMPTY_FORM, agentId: config.agentId, adapter: "mock", responsesText: config.responses.join("\n") };
  }
  if (config.cli.preset === "claude-code") {
    return {
      ...EMPTY_FORM,
      agentId: config.agentId,
      adapter: "cli",
      cliPreset: "claude-code",
      systemPrompt: config.cli.systemPrompt ?? "",
      model: config.cli.model ?? "",
      maxBudgetUsd: config.cli.maxBudgetUsd !== undefined ? String(config.cli.maxBudgetUsd) : "",
      allowTools: config.cli.allowTools ?? false,
    };
  }
  return {
    ...EMPTY_FORM,
    agentId: config.agentId,
    adapter: "cli",
    cliPreset: "custom",
    customCommand: config.cli.command,
    customArgsText: (config.cli.args ?? []).join("\n"),
  };
}

function formToConfig(form: FormState): AgentConfig {
  if (form.adapter === "api") {
    return { agentId: form.agentId, adapter: "api", systemPrompt: form.systemPrompt, model: form.model || undefined };
  }
  if (form.adapter === "human") {
    return { agentId: form.agentId, adapter: "human" };
  }
  if (form.adapter === "mock") {
    return {
      agentId: form.agentId,
      adapter: "mock",
      responses: form.responsesText.split("\n").map((s) => s.trim()).filter(Boolean),
    };
  }
  if (form.cliPreset === "claude-code") {
    return {
      agentId: form.agentId,
      adapter: "cli",
      cli: {
        preset: "claude-code",
        systemPrompt: form.systemPrompt || undefined,
        model: form.model || undefined,
        maxBudgetUsd: form.maxBudgetUsd ? Number(form.maxBudgetUsd) : undefined,
        allowTools: form.allowTools || undefined,
      },
    };
  }
  return {
    agentId: form.agentId,
    adapter: "cli",
    cli: {
      preset: "custom",
      command: form.customCommand,
      args: form.customArgsText.split("\n").map((s) => s.trim()).filter(Boolean),
    },
  };
}

/** Args that look like a script path but aren't absolute — they'll break in the sandbox cwd. */
function relativeScriptArgs(argsText: string): string[] {
  return argsText
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("-") && !s.startsWith("/") && !s.startsWith("~") && /[\/.]|\.(mjs|js|cjs|ts|py|sh)$/.test(s) && (s.includes("/") || /\.(mjs|js|cjs|ts|py|sh)$/.test(s)));
}

function summarize(config: AgentConfig): string {
  if (config.adapter === "api") return config.systemPrompt.slice(0, 60);
  if (config.adapter === "human") return "由人类在展示侧操作";
  if (config.adapter === "mock") return `${config.responses.length} 条固定回复`;
  if (config.cli.preset === "claude-code") return `claude-code, model=${config.cli.model ?? "默认"}`;
  return `custom: ${config.cli.command} ${(config.cli.args ?? []).join(" ")}`;
}

export default AgentsTab;
