import { describe, it, expect } from "vitest";
import { resolveCliInvocation } from "../src/core/agentFactory.js";

describe("resolveCliInvocation — claude-code preset", () => {
  it("disables tools by default (least privilege)", () => {
    const { command, args } = resolveCliInvocation({ preset: "claude-code" });
    expect(command).toBe("claude");
    const i = args.indexOf("--tools");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe("");
  });

  it("enables tools when allowTools is set", () => {
    const { args } = resolveCliInvocation({ preset: "claude-code", allowTools: true });
    const i = args.indexOf("--tools");
    expect(args[i + 1]).toBe("default");
  });

  it("threads model, system prompt, budget, and extraArgs", () => {
    const { args } = resolveCliInvocation({
      preset: "claude-code",
      model: "haiku",
      systemPrompt: "be brief",
      maxBudgetUsd: 0.1,
      extraArgs: ["--verbose"],
    });
    expect(args).toEqual(expect.arrayContaining(["--model", "haiku", "--system-prompt", "be brief", "--max-budget-usd", "0.1", "--verbose"]));
  });

  it("passes custom command/args through untouched", () => {
    expect(resolveCliInvocation({ preset: "custom", command: "node", args: ["x.mjs"] })).toEqual({
      command: "node",
      args: ["x.mjs"],
    });
  });
});
