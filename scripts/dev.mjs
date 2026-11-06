#!/usr/bin/env node
// 로컬 개발: API Worker(jsbeob-api, :8788)와 사이트(astro dev, :4321)를 함께 띄운다.
// 사이트 SSR 은 service binding 으로 API 를 부르므로 API 가 없으면 데이터 페이지가 비거나 500 이 난다.
// Ctrl+C 한 번이면 둘 다 멈춘다. 하나만 띄우려면 pnpm dev:site / pnpm dev:api.
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = (name) => path.join(root, "node_modules/.bin", name);

const portInUse = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" }, () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
  });

const children = [];
function run(label, color, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, stdio: ["inherit", "pipe", "pipe"], env: process.env });
  const tag = `\x1b[${color}m[${label}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const l of lines) out.write(tag + l + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    process.stdout.write(`${tag}종료 (code ${code})\n`);
    shutdown(code ?? 0);
  });
  children.push(child);
}

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGINT");
  setTimeout(() => process.exit(code), 1500);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

if (await portInUse(8788)) {
  console.log("[api] 8788 이 이미 사용 중 — 떠 있는 API 를 그대로 쓴다.");
} else {
  run("api", "33", bin("wrangler"), ["dev", "-c", "wrangler.toml", "--port", "8788"], path.join(root, "jsbeob-api"));
}
run("site", "36", bin("astro"), ["dev"], root);
