#!/usr/bin/env node
// 로컬 개발: API Worker(jsbeob-api, 기본 :8788)와 사이트(astro dev, 기본 :4321)를 함께 띄운다.
// 사이트 SSR 은 service binding 으로 API 를 부르므로 API 가 없으면 데이터 페이지가 비거나 500 이 난다.
// Ctrl+C 한 번이면 둘 다 멈춘다. 하나만 띄우려면 pnpm dev:site / pnpm dev:api (= 이 스크립트에 site / api).
// 포트는 scripts/dev-ports.mjs 규칙(SITE_PORT/API_PORT 환경변수 > .dev-ports > 기본값)을 따른다.
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { DEFAULT_SITE_PORT, devEnv, repoRoot as root } from "./dev-ports.mjs";

const mode = process.argv[2] ?? "both"; // both | api | site
if (!["both", "api", "site"].includes(mode)) {
  console.error(`알 수 없는 모드: ${mode} (both | api | site)`);
  process.exit(2);
}
const { ports, env } = devEnv(root);
// DEV_HOST=100.x.x.x pnpm dev → 사이트를 그 주소로도 연다(같은 Tailscale 망의 다른 기기에서 보기). 기본은 localhost 만
const devHost = process.env.DEV_HOST?.trim() || "";
const bin = (name) => path.join(root, "node_modules/.bin", name);

const portInUse = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" }, () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
  });

const children = [];
function run(label, color, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, stdio: ["inherit", "pipe", "pipe"], env });
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

console.log(`[dev] 사이트 http://localhost:${ports.site} · API http://localhost:${ports.api}` + (ports.isolated ? " (이 폴더 전용 레지스트리)" : ""));

if (mode !== "site") {
  if (mode === "both" && (await portInUse(ports.api))) {
    console.log(`[api] ${ports.api} 이 이미 사용 중 — 떠 있는 API 를 그대로 쓴다.`);
  } else {
    // --test-scheduled: Cron(올림함 원본 1년 삭제)을 /__scheduled 로 직접 불러 볼 수 있게 (로컬 전용 경로)
    const args = ["dev", "-c", "wrangler.toml", "--port", String(ports.api), "--test-scheduled"];
    // 로그인 콜백·허용 출처가 이 사이트 포트를 가리키게 (기본 포트면 .dev.vars 값 그대로)
    if (ports.site !== DEFAULT_SITE_PORT) args.push("--var", `SITE_ORIGIN:http://localhost:${ports.site}`);
    // DEV_HOST(예: Tailscale 주소)로 사이트를 열면 그 출처의 쿠키 요청도 받게 (올림함 출처 검사)
    if (devHost) args.push("--var", `ALLOWED_ORIGINS:http://${devHost}:${ports.site}`);
    // 디버거(inspector) 포트도 worktree 마다 고정 — 기본(9229부터 빈 것)은 두 곳이 동시에 뜰 때 서로 같은 번호를 잡는다
    if (ports.isolated) args.push("--inspector-port", String(ports.api + 1000));
    run("api", "33", bin("wrangler"), args, path.join(root, "jsbeob-api"));
  }
}
if (mode !== "api") run("site", "36", bin("astro"), ["dev", "--port", String(ports.site), ...(devHost ? ["--host", devHost] : [])], root);
