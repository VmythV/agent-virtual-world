import type { WorldSummary } from "./types";

export async function fetchWorlds(): Promise<WorldSummary[]> {
  const res = await fetch("/api/worlds");
  if (!res.ok) throw new Error(`GET /api/worlds failed: ${res.status}`);
  return res.json();
}
