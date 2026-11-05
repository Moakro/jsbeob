#!/usr/bin/env node
// 로컬 개발 전용 로그인 — 소셜 로그인(카카오·구글) 키 없이 관리자 화면을 쓰기 위한 도우미.
//
//  1) 로컬 D1(jsbeob-api/.wrangler)에 운영자 계정(level 4)을 만들거나 갱신하고
//  2) jsbeob-api/.dev.vars 의 AUTH_SECRET 으로 세션 토큰(jb_session)을 서명해
//  3) 브라우저 콘솔에 붙여 넣을 한 줄을 출력한다.
//
// 운영 AUTH_SECRET 은 이 파일이 모르므로 여기서 만든 토큰은 운영 사이트에서 통하지 않는다.
// 사용: pnpm dev:login [표시이름]
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "jsbeob-api");
const name = process.argv[2] || "로컬 운영자";
const USER_ID = "local-dev-admin";

let vars;
try {
  vars = readFileSync(path.join(apiDir, ".dev.vars"), "utf8");
} catch {
  console.error("jsbeob-api/.dev.vars 가 없습니다. .dev.vars.example 을 복사해 AUTH_SECRET 을 채우세요.");
  process.exit(1);
}
const secret = /^AUTH_SECRET="?([^"\n]+)"?/m.exec(vars)?.[1];
if (!secret || secret.includes("여기에")) {
  console.error("jsbeob-api/.dev.vars 의 AUTH_SECRET 이 비어 있습니다.");
  process.exit(1);
}

// 로컬 D1 에만 쓴다(--local). 운영 DB(--remote)는 건드리지 않는다.
const sql =
  `INSERT INTO users (id, provider, display_name, level, is_seed) VALUES ('${USER_ID}', 'local', '${name.replace(/'/g, "''")}', 4, 0) ` +
  `ON CONFLICT(id) DO UPDATE SET level=4, display_name=excluded.display_name, updated_at=datetime('now');`;
execFileSync(
  path.join(root, "node_modules/.bin/wrangler"),
  ["d1", "execute", "jsbeob-db", "--local", "-c", "wrangler.toml", "--command", sql],
  { cwd: apiDir, stdio: ["ignore", "ignore", "inherit"] },
);

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const now = Math.floor(Date.now() / 1000);
const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const body = b64url(JSON.stringify({ sub: USER_ID, iat: now, exp: now + 60 * 60 * 24 * 30 }));
const sig = b64url(createHmac("sha256", secret).update(`${head}.${body}`).digest());
const token = `${head}.${body}.${sig}`;

console.log(`로컬 운영자 '${name}' (id=${USER_ID}, level 4) 준비 완료.`);
console.log("http://localhost:4321 을 연 브라우저의 개발자 도구 콘솔에 아래 한 줄을 붙여 넣고 새로고침하세요 (30일 유효):\n");
console.log(`document.cookie = "jb_session=${token}; path=/; max-age=2592000";`);
