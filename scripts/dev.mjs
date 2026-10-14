// `pnpm dev` — brings up the whole local platform with prefixed logs:
//   Supabase (Docker via Colima) · game host :5555 · portal :3000 · simulator :5173 · reviewer · Metro :8081
// Flags: --no-mobile (skip Metro), --no-reviewer, --only=portal,game-host,...
// Metro runs headless here (its output is prefixed, so Expo's keyboard shortcuts are off). For the
// interactive Expo CLI, run `pnpm dev --no-mobile` and `pnpm --filter @thumbcade/mobile start` side by side.
import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const only = [...args].find((a) => a.startsWith("--only="))?.slice("--only=".length).split(",");

const services = [
  { name: "functions", cmd: ["supabase", "functions", "serve", "--env-file", "supabase/functions/.env"], dir: ".", color: 31 },
  { name: "game-host", dir: "services/game-host", script: "dev", color: 36 },
  { name: "portal", dir: "apps/portal", script: "dev", color: 33 },
  { name: "simulator", dir: "apps/simulator", script: "dev", color: 35 },
  { name: "reviewer", dir: "services/reviewer", script: "worker", color: 34, skip: args.has("--no-reviewer") },
  { name: "metro", dir: "apps/mobile", script: "start", color: 32, skip: args.has("--no-mobile") },
];

function log(name, color, line) {
  process.stdout.write(`\x1b[${color}m${name.padEnd(10)}\x1b[0m ${line}\n`);
}

function ensureDocker() {
  try {
    execSync("docker info", { stdio: "ignore" });
  } catch {
    log("docker", 31, "Docker isn't running — starting Colima…");
    execSync("colima start", { stdio: "inherit" });
  }
}

function ensureSupabase() {
  try {
    execSync("supabase status -o json", { cwd: root, stdio: "ignore" });
    log("supabase", 32, "already running — API http://127.0.0.1:54321 · Studio http://127.0.0.1:54323 · Mail http://127.0.0.1:54324");
  } catch {
    log("supabase", 32, "starting…");
    execSync("supabase start", { cwd: root, stdio: "inherit" });
  }
}

ensureDocker();
ensureSupabase();

const children = [];
for (const s of services) {
  if (s.skip || (only && !only.includes(s.name))) continue;
  if (!s.cmd) {
    const pkgPath = resolve(root, s.dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (!pkg.scripts?.[s.script]) continue;
  }
  if (s.name === "functions" && !existsSync(resolve(root, "supabase/functions/.env"))) {
    execSync("cp supabase/functions/.env.example supabase/functions/.env", { cwd: root });
  }
  const [bin, ...binArgs] = s.cmd ?? ["pnpm", "run", s.script];
  const child = spawn(bin, binArgs, {
    cwd: resolve(root, s.dir),
    env: { ...process.env, FORCE_COLOR: "1", BROWSER: "none" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) log(s.name, s.color, line);
    });
  }
  child.on("exit", (code) => log(s.name, s.color, `exited with ${code}`));
}

// SIGINT is what Ctrl+C sends; the Supabase CLI ignores SIGTERM. Anything still alive after 5 s is killed.
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  const alive = children.filter((c) => c.exitCode === null && c.signalCode === null);
  if (alive.length === 0) process.exit(0);
  let left = alive.length;
  for (const c of alive) {
    c.once("exit", () => --left === 0 && process.exit(0));
    c.kill("SIGINT");
  }
  setTimeout(() => {
    for (const c of alive) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
    process.exit(0);
  }, 5000).unref();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
