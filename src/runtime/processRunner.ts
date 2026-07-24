import { spawn } from "node:child_process";

export interface RunProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  input: string;
  signal: AbortSignal;
}

export interface RunProcessResult {
  stdout: string;
  stderr: string;
}

/** Spawns `command`, writes `input` to stdin, and resolves with collected stdout/stderr. */
export function runProcess(options: RunProcessOptions): Promise<RunProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const onAbort = () => child.kill("SIGTERM");
    options.signal.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      options.signal.removeEventListener("abort", onAbort);
      reject(err);
    });

    child.on("close", (exitCode) => {
      options.signal.removeEventListener("abort", onAbort);
      if (options.signal.aborted) {
        reject(new Error("runProcess: timed out and the process was killed"));
        return;
      }
      if (exitCode !== 0) {
        reject(new Error(`runProcess: "${options.command}" exited with code ${exitCode}: ${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });

    child.stdin.write(options.input, "utf8");
    child.stdin.end();
  });
}
