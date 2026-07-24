import type { WorldState, WorldTemplate } from "../core/types.js";
import { debateWorldTemplate } from "./debateWorldTemplate.js";

export const worldTemplates: Record<string, WorldTemplate<WorldState>> = {
  debate: debateWorldTemplate as unknown as WorldTemplate<WorldState>,
};

export function getWorldTemplate(id: string): WorldTemplate<WorldState> | undefined {
  return worldTemplates[id];
}
