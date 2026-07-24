#!/usr/bin/env node
// Stand-in for a real coding CLI agent in a collaborative build. Runs with
// its cwd set to the SHARED workspace, so each builder's edit accumulates.
// Reads the prompt on stdin, appends a deterministic line to progress.md
// (and creates it on the first turn), and prints a short summary on stdout.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const file = "progress.md";
  const prev = existsSync(file) ? readFileSync(file, "utf8") : "# Build Progress\n\n";
  const done = prev.split("\n").filter((l) => l.startsWith("- ")).length;
  const step = done + 1;
  writeFileSync(file, `${prev}- 第 ${step} 步：基于 ${input.length} 字节的 prompt 完成一处修改。\n`);
  process.stdout.write(`已完成第 ${step} 步：向 progress.md 追加了一行。`);
});
