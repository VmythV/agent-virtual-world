import type { Observation } from "./types.js";

/**
 * Convention shared by every world template + adapter pair: templates tell
 * the agent what kind of action is expected next via
 * `visibleState.expectedActionType`, so a generic adapter (API-backed or
 * CLI-backed) doesn't need template-specific logic to pick an action type.
 */
export function expectedActionType(observation: Observation, fallback = "speak"): string {
  const visible = observation.visibleState as { expectedActionType?: string } | undefined;
  return visible?.expectedActionType ?? fallback;
}

/**
 * Renders an Observation as plain text. Shared by every text-oriented
 * adapter (API or CLI) so the same world state produces the same prompt
 * regardless of which kind of agent is reading it.
 */
export function buildPrompt(observation: Observation): string {
  const historyText = observation.history
    .map((event) => `[${event.type}]${event.actorId ? ` ${event.actorId}:` : ""} ${JSON.stringify(event.payload)}`)
    .join("\n");
  const instructionText = observation.instruction ? `\n\n上帝指令: ${observation.instruction}` : "";

  return [
    `当前世界状态: ${JSON.stringify(observation.visibleState)}`,
    "",
    "历史事件:",
    historyText || "(暂无)",
    instructionText,
    "",
    "请给出你的发言内容（纯文本，直接输出，不要额外解释）。",
  ].join("\n");
}
