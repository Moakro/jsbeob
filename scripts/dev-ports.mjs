// 로컬 dev 포트 — 여러 worktree 에서 dev 서버를 동시에 띄울 수 있게 포트를 한곳에서 정한다.
// 우선순위: 환경변수 SITE_PORT / API_PORT > 저장소 최상위 .dev-ports(gitignore, worktree 준비 스크립트가 만듦) > 기본값 4321 / 8788.
// .dev-ports 가 있는 checkout(=worktree)은 wrangler 개발 레지스트리도 자기 폴더에 따로 둔다 — 사이트가 API 를
// 이름(jsbeob-api-preview)으로 찾으므로, 전역 레지스트리를 같이 쓰면 다른 worktree 의 API 에 붙는다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_SITE_PORT = 4321;
export const DEFAULT_API_PORT = 8788;

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readPortsFile(root) {
  const file = path.join(root, ".dev-ports");
  if (!fs.existsSync(file)) return null;
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*(SITE_PORT|API_PORT)\s*=\s*(\d+)\s*$/);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

export function loadDevPorts(root = repoRoot) {
  const file = readPortsFile(root);
  const num = (v) => (v && /^\d+$/.test(String(v)) ? Number(v) : undefined);
  const site = num(process.env.SITE_PORT) ?? file?.SITE_PORT ?? DEFAULT_SITE_PORT;
  const api = num(process.env.API_PORT) ?? file?.API_PORT ?? DEFAULT_API_PORT;
  // 레지스트리 분리: .dev-ports 가 있거나 기본과 다른 포트를 쓸 때.
  const isolated = file !== null || site !== DEFAULT_SITE_PORT || api !== DEFAULT_API_PORT;
  return { site, api, isolated };
}

/** dev 자식 프로세스(wrangler dev, astro dev)에 줄 환경변수. */
export function devEnv(root = repoRoot) {
  const ports = loadDevPorts(root);
  const env = { ...process.env, SITE_PORT: String(ports.site), API_PORT: String(ports.api) };
  if (ports.isolated) {
    const registry = path.join(root, ".wrangler", "dev-registry");
    env.WRANGLER_REGISTRY_PATH ??= registry; // wrangler dev (API)
    env.MINIFLARE_REGISTRY_PATH ??= registry; // astro dev 안의 @cloudflare/vite-plugin (사이트)
  }
  return { ports, env };
}
