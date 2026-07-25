#!/usr/bin/env node
// Stand-in for a tool-enabled coding CLI agent doing research. A real
// claude-code agent (allowTools) would actually search/read/run; this
// fixture just simulates "using a tool" deterministically so the research
// world demo/test is free and offline. Reads the prompt on stdin, prints a
// finding that references a (fake) tool result derived from the prompt size.
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const hits = (input.length % 5) + 1;
  process.stdout.write(`[已调用搜索工具] 找到 ${hits} 条相关资料，据此得到一个阶段性发现。`);
});
