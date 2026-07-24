#!/usr/bin/env node
// Stand-in for a real CLI coding agent (Claude Code / Codex CLI) used to
// exercise CliAgentAdapter's process-spawning, sandboxing and timeout
// plumbing without the cost/latency of a real session. Point
// CliAgentAdapter's `command`/`args` at the real CLI binary to swap this
// out; the stdin-in / stdout-out contract is the same either way.

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const roundMatch = input.match(/"round":(\d+)/);
  const round = roundMatch ? roundMatch[1] : "?";
  process.stdout.write(
    `[cli-agent] 第${round}轮：来自 CLI 子进程的发言，基于收到的 ${input.length} 字节 prompt 生成。\n`,
  );
});
