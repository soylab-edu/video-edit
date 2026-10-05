import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { supervise } from "../scripts/preview-supervisor.mjs";

test(
  "preview restarts an exited tunnel and stops its replacement cleanly",
  { timeout: 8000 },
  async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "moa-supervisor-"));
    const file = path.join(dir, "launches");
    let restarts = 0;
    const code = `const fs=require('fs'); const file=process.argv[1];const n=fs.existsSync(file)?+fs.readFileSync(file):0;fs.writeFileSync(file,String(n+1));if(n===0)process.exit(1);setInterval(()=>{},1000);`;
    const monitor = supervise({
      command: process.execPath,
      args: ["-e", code, file],
      options: { stdio: "ignore" },
      retryDelay: () => 10,
      onExit: async () => {
        restarts++;
      },
    });
    t.after(async () => {
      monitor.stop();
      await monitor.done;
      await fs.rm(dir, { recursive: true, force: true });
    });
    for (let i = 0; i < 100; i++) {
      if ((await fs.readFile(file, "utf8").catch(() => "0")) === "2") break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(await fs.readFile(file, "utf8"), "2");
    assert.equal(restarts, 1);
    const pid = monitor.pid;
    monitor.stop();
    await monitor.done;
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  },
);
