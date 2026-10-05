import { spawn } from "node:child_process";

// A reconnected free tunnel can receive a new URL. Supervision cannot preserve
// the domain or keep a tunnel running after the cloud environment stops.
export function supervise({
  command,
  args,
  options,
  onExit = async () => {},
  retryDelay = (attempt) => Math.min(1000 * 2 ** attempt, 30000),
}) {
  let child,
    stopped = false,
    timer,
    wake;
  const done = (async () => {
    let attempt = 0;
    while (!stopped) {
      const started = Date.now();
      const outcome = await new Promise((resolve) => {
        try {
          child = spawn(command, args, options);
          child.once("error", (error) => resolve({ error: error.message }));
          child.once("close", (code, signal) => resolve({ code, signal }));
        } catch (error) {
          resolve({ error: error.message });
        }
      });
      if (stopped) break;
      if (Date.now() - started > 60000) attempt = 0;
      await onExit(outcome);
      if (stopped) break;
      await new Promise((resolve) => {
        wake = resolve;
        timer = setTimeout(resolve, retryDelay(attempt++));
      });
      wake = null;
    }
  })();
  return {
    done,
    get pid() {
      return child?.pid;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      wake?.();
      if (child && child.exitCode === null) child.kill("SIGTERM");
    },
  };
}
