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
