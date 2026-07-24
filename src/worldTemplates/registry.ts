import type { WorldState, WorldTemplate } from "../core/types.js";
import { debateWorldTemplate } from "./debateWorldTemplate.js";
import { discussionWorldTemplate } from "./discussionWorldTemplate.js";
import { werewolfWorldTemplate } from "./werewolfWorldTemplate.js";
import { aquariumWorldTemplate } from "./aquariumWorldTemplate.js";
import { problemSolvingWorldTemplate } from "./problemSolvingWorldTemplate.js";
import { humanLabWorldTemplate } from "./humanLabWorldTemplate.js";

export const worldTemplates: Record<string, WorldTemplate<WorldState>> = {
  debate: debateWorldTemplate as unknown as WorldTemplate<WorldState>,
  discussion: discussionWorldTemplate as unknown as WorldTemplate<WorldState>,
  werewolf: werewolfWorldTemplate as unknown as WorldTemplate<WorldState>,
  aquarium: aquariumWorldTemplate as unknown as WorldTemplate<WorldState>,
  "problem-solving": problemSolvingWorldTemplate as unknown as WorldTemplate<WorldState>,
  "human-lab": humanLabWorldTemplate as unknown as WorldTemplate<WorldState>,
};

export function getWorldTemplate(id: string): WorldTemplate<WorldState> | undefined {
  return worldTemplates[id];
}
