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

export type ResponseShape = "text" | "choice";

/**
 * "text": the agent's raw output becomes payload.text (speaking, summaries,
 * verdicts). "choice": the agent must pick one of `expectedChoices()` and
 * the raw output becomes payload.target instead — used for actions like a
 * werewolf's kill vote or a vote-phase ballot where a free-text answer
 * isn't a valid action.
 */
export function expectedResponseShape(observation: Observation): ResponseShape {
  const visible = observation.visibleState as { responseShape?: ResponseShape } | undefined;
  return visible?.responseShape ?? "text";
}

export function expectedChoices(observation: Observation): string[] | undefined {
  const visible = observation.visibleState as { choices?: string[] } | undefined;
  return visible?.choices;
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
  const choices = expectedChoices(observation);

  const responseInstruction =
    expectedResponseShape(observation) === "choice" && choices && choices.length > 0
      ? `请从以下候选项中选择一个，只输出该候选项本身，不要输出任何其他文字：${choices.join(" / ")}`
      : "请给出你的发言内容（纯文本，直接输出，不要额外解释）。";

  return [
    `当前世界状态: ${JSON.stringify(observation.visibleState)}`,
    "",
    "历史事件:",
    historyText || "(暂无)",
    instructionText,
    "",
    responseInstruction,
  ].join("\n");
}

/**
 * Turns a raw model response into a validated choice: exact match wins;
 * otherwise the first choice that appears as a substring of the trimmed
 * response (models often add punctuation/explanation despite instructions
 * not to); otherwise falls back to the first choice so one bad response
 * doesn't crash the whole world run — see docs/architecture.md §2.6.
 */
export function parseChoiceResponse(rawText: string, choices: string[]): string {
  const trimmed = rawText.trim();
  if (choices.includes(trimmed)) return trimmed;
  const found = choices.find((choice) => trimmed.includes(choice));
  return found ?? choices[0];
}

/**
 * Shared by every text-generating adapter (API, CLI, mock): turns a raw
 * response string into the right AgentAction payload shape for this
 * Observation — {text} normally, {target} when a choice was expected.
 */
export function buildActionPayload(observation: Observation, rawText: string): Record<string, unknown> {
  const choices = expectedChoices(observation);
  if (expectedResponseShape(observation) === "choice" && choices && choices.length > 0) {
    return { target: parseChoiceResponse(rawText, choices) };
  }
  return { text: rawText.trim() };
}
