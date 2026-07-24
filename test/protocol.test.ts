import { describe, it, expect } from "vitest";
import {
  buildActionPayload,
  expectedActionType,
  expectedChoices,
  expectedResponseShape,
  parseChoiceResponse,
} from "../src/core/protocol.js";
import type { Observation } from "../src/core/types.js";

function obs(visibleState: unknown): Observation {
  return { worldId: "w", agentId: "a", visibleState, history: [] };
}

describe("parseChoiceResponse", () => {
  const choices = ["alice", "bob", "carol"];

  it("takes an exact match", () => {
    expect(parseChoiceResponse("bob", choices)).toBe("bob");
  });

  it("finds a choice embedded in a noisy response", () => {
    expect(parseChoiceResponse("我投给 carol，因为……", choices)).toBe("carol");
  });

  it("falls back to the first choice when nothing matches", () => {
    expect(parseChoiceResponse("弃权", choices)).toBe("alice");
  });

  it("trims surrounding whitespace before matching", () => {
    expect(parseChoiceResponse("  bob \n", choices)).toBe("bob");
  });
});

describe("expected* accessors", () => {
  it("reads expectedActionType with a fallback", () => {
    expect(expectedActionType(obs({ expectedActionType: "vote" }))).toBe("vote");
    expect(expectedActionType(obs({}))).toBe("speak");
    expect(expectedActionType(obs({}), "custom")).toBe("custom");
  });

  it("reads responseShape and choices", () => {
    expect(expectedResponseShape(obs({ responseShape: "choice" }))).toBe("choice");
    expect(expectedResponseShape(obs({}))).toBe("text");
    expect(expectedChoices(obs({ choices: ["x"] }))).toEqual(["x"]);
    expect(expectedChoices(obs({}))).toBeUndefined();
  });
});

describe("buildActionPayload", () => {
  it("produces {text} for text responses", () => {
    expect(buildActionPayload(obs({}), "  hello  ")).toEqual({ text: "hello" });
  });

  it("produces {target} for choice responses, validated against choices", () => {
    const o = obs({ responseShape: "choice", choices: ["a", "b"] });
    expect(buildActionPayload(o, "b")).toEqual({ target: "b" });
    expect(buildActionPayload(o, "nonsense")).toEqual({ target: "a" });
  });

  it("falls back to text when choice shape has no choices", () => {
    expect(buildActionPayload(obs({ responseShape: "choice" }), "hi")).toEqual({ text: "hi" });
  });
});
