#!/usr/bin/env node
// 공용 자료실 → 사진 창고 동기화 시험 — 로컬 전용. `pnpm dev:api`(또는 pnpm dev)를 띄운 뒤 `pnpm test:library-sync`.
// jsbeob-api/.dev.vars 에 LIBRARY_SYNC_TOKEN(32자 이상)이 있어야 한다(.dev.vars.example 참고).
// 임시 폴더에 시험용 자료실(사이드카·그림·index.jsonl, 설계 4절 형식)을 만들고 GENMEDIA_ROOT 로 넘겨
//   --dry → --apply → 다시 --dry(변화 없음) → 표기 바꿈 → 파일 바꿈 → use.web false(지움 + 쓰는 곳) → 색인에서 빠짐(고아)
// 순서로 확인한다. 끝에 시험 행(library_id LTEST-…)·시험 홈 타일을 로컬 D1 에서 지운다. 운영(--remote)은 건드리지 않는다.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { loadDevPorts } from "./dev-ports.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = `http://localhost:${loadDevPorts(root).api}`;
const TOKEN = /^LIBRARY_SYNC_TOKEN\s*=\s*"?([^"\n]*)"?/m.exec(readFileSync(path.join(root, "jsbeob-api/.dev.vars"), "utf8"))?.[1] ?? "";
if (TOKEN.length < 32) {
  console.error("jsbeob-api/.dev.vars 에 LIBRARY_SYNC_TOKEN(32자 이상)을 넣고 API 를 다시 띄워 주세요 (openssl rand -hex 32)");
  process.exit(2);
}

const d1 = (sql) => {
  const out = execFileSync(path.join(root, "node_modules/.bin/wrangler"), ["d1", "execute", "jsbeob-db", "--local", "-c", "wrangler.toml", "--json", "--command", sql], {
    cwd: path.join(root, "jsbeob-api"),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(out.slice(out.indexOf("[")))[0].results;
};

let pass = 0;
let fail = 0;
function check(name, ok, extra = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !extra ? "" : `  — ${extra}`}`);
}
async function call(p, { method = "GET", body, headers = {}, token = TOKEN } = {}) {
  const res = await fetch(API + p, { method, body, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } });
  return { res, data: await res.json().catch(() => ({})) };
}

// ── 시험용 자료실 ────────────────────────────────────────────────────────
const G = mkdtempSync(path.join(os.tmpdir(), "jsbeob-libsync-"));
const LIB = "assets-shared/library";
const run = Date.now().toString(36);
const ID = (s) => `LTEST-${run}-${s}`;
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");

async function picture(rel, { w, h, color, format = "jpeg" }) {
  const abs = path.join(G, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  // 무늬를 넣어 압축이 너무 잘 되지 않게(파생본 크기 시험)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${color}"/>${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 97) % w}" cy="${(i * 61) % h}" r="${40 + i * 3}" fill="hsl(${i * 9},70%,50%)" opacity="0.5"/>`).join("")}</svg>`;
  await sharp(Buffer.from(svg))[format]().toFile(abs);
  return abs;
}

const entries = {};
async function entry(key, { kind = "image", topic = "시험", license = "PD", web = true, modifiable = true, credit, title, description, year, fileOpts, derived, warnings = [] }) {
  const id = ID(key);
  const dir = `${LIB}/${kind}/${topic}`;
  const files = [];
  const orig = `${dir}/${id}_원본.${fileOpts?.format === "png" ? "png" : "jpg"}`;
  const abs = await picture(orig, fileOpts ?? { w: 800, h: 600, color: "#a33" });
  files.push({ path: orig, role: "original", sha256: sha(abs), bytes: readFileSync(abs).byteLength, mtime: new Date().toISOString() });
  if (derived) {
    const dp = `${dir}/${id}_보정.jpg`;
    const dabs = await picture(dp, derived);
    files.push({ path: dp, role: "derived", sha256: sha(dabs), bytes: readFileSync(dabs).byteLength, mtime: new Date().toISOString() });
  }
  const it = {
    schema: 1,
    id,
    title: title ?? `시험 그림 ${key}`,
    ...(description ? { description } : {}),
    kind,
    files,
    source: { url: `https://example.org/${key}`, creator: "시험", holder: "시험 소장처" },
    license: { code: license },
    credit: credit ?? `시험 소장처 · ${license}`,
    use: { video: true, web },
    modifiable,
    ...(year ? { year } : {}),
    tags: ["시험"],
    added: { at: "2026-11-28", by: "test-library-sync" },
    meta_path: `${dir}/${id}.meta.json`,
    origin: "sidecar",
    warnings,
    indexed_at: new Date().toISOString(),
  };
  // 사이드카도 실제처럼 둔다(도구는 색인만 읽음)
  const side = { ...it, files: it.files.map((f) => ({ ...f, path: path.basename(f.path) })) };
  delete side.meta_path, delete side.origin, delete side.warnings, delete side.indexed_at;
  writeFileSync(path.join(G, it.meta_path), JSON.stringify(side, null, 2));
  entries[key] = it;
  return it;
}
function writeIndex(keys = Object.keys(entries)) {
  writeFileSync(path.join(G, LIB, "index.jsonl"), keys.map((k) => JSON.stringify(entries[k])).join("\n") + "\n");
}
function sync(...args) {
  try {
    const out = execFileSync("node", [path.join(root, "scripts/library-sync.mjs"), "--json", "--api", API, ...args], {
      encoding: "utf8",
      env: { ...process.env, GENMEDIA_ROOT: G, LIBRARY_SYNC_TOKEN: TOKEN },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(out);
  } catch (e) {
    if (e.stdout?.trim().startsWith("{")) return { ...JSON.parse(e.stdout), exitCode: e.status };
    throw new Error(`도구 실패: ${e.stderr || e.message}`);
  }
}
const ids = (list) => list.map((x) => x.id).sort();
const mine = async () => (await call("/api/library-sync/media")).data.media.filter((m) => m.library_id.startsWith(`LTEST-${run}-`));
const byLib = async (key) => (await mine()).filter((m) => m.library_id === ID(key));

let tileId = null;
try {
  // ── 열쇠 ──
  check("열쇠 없으면 401", (await call("/api/library-sync/media", { token: "" })).res.status === 401);
  check("틀린 열쇠 401", (await call("/api/library-sync/media", { token: "x".repeat(64) })).res.status === 401);
  check("맞는 열쇠 200", (await call("/api/library-sync/media")).res.status === 200);

  // ── 시험 자료 ──
  await entry("big", { kind: "map", fileOpts: { w: 4000, h: 3000, color: "#2a6" }, year: { made: "1934" }, description: "큰 지형도 — 2560 으로 줄어야 함" });
  await entry("kogl3", { kind: "aerial", license: "KOGL-3", modifiable: false, credit: "국토지리정보원 항공사진(1966) · 공공누리 제3유형", year: { shot: "1966" }, fileOpts: { w: 3000, h: 2000, color: "#36c" } });
  await entry("derived", { license: "CC-BY-SA", credit: "홍길동 · Wikimedia Commons (CC BY-SA 4.0)", fileOpts: { w: 1200, h: 900, color: "#c63" }, derived: { w: 1000, h: 700, color: "#3c6" } });
  await entry("png", { kind: "satellite", license: "USGS-PD", fileOpts: { w: 640, h: 480, color: "#999", format: "png" } });
  await entry("noweb", { web: false });
  await entry("unknown", { license: "UNKNOWN" });
  await entry("warned", { warnings: ["use.web 이 라이선스 기본값보다 넓음 — false 로 색인"] });
  await entry("text", { kind: "text" });
  await entry("longcredit", { credit: "가".repeat(201) });
  writeIndex();

  // 1) --dry
  const dry = sync();
  check("dry: 올릴 것 4건(지도·항공·파생본·png)", JSON.stringify(ids(dry.plan.upload)) === JSON.stringify([ID("big"), ID("derived"), ID("kogl3"), ID("png")].sort()), JSON.stringify(ids(dry.plan.upload)));
  const skipped = Object.fromEntries(dry.plan.skip.map((x) => [x.id, x.reason]));
  check("dry: use.web false 건너뜀", /use\.web/.test(skipped[ID("noweb")] ?? ""));
  check("dry: UNKNOWN 건너뜀", /UNKNOWN/.test(skipped[ID("unknown")] ?? ""));
  check("dry: 라이선스 경고 건너뜀", /라이선스 경고/.test(skipped[ID("warned")] ?? ""));
  check("dry: kind=text 건너뜀", /kind=text/.test(skipped[ID("text")] ?? ""));
  check("dry: credit 200자 초과 건너뜀(자르지 않음)", /201자/.test(skipped[ID("longcredit")] ?? ""));
  check("dry: 아무것도 안 올라감", (await mine()).length === 0);
  check("dry: 파생본(derived)을 고름", dry.plan.upload.find((x) => x.id === ID("derived"))?.src.role === "derived");

  // 2) --apply
  const ap = sync("--apply");
  check("apply: 4건 성공", ap.results.length === 4 && ap.results.every((r) => r.ok), JSON.stringify(ap.results.filter((r) => !r.ok)));
  const rows = await mine();
  check("apply: jsbeob 에 4행", rows.length === 4);
  const big = rows.find((r) => r.library_id === ID("big"));
  check("큰 지도는 긴 변 2560 webp", big?.width === 2560 && big?.height === 1920 && big?.content_type === "image/webp", JSON.stringify(big));
  check("표기: alt=title · caption=description · taken_at=year.made", big?.alt === "시험 그림 big" && big?.caption?.startsWith("큰 지형도") && big?.taken_at === "1934");
  check("표기: source_url · license_code", big?.source_url === "https://example.org/big" && big?.license_code === "PD");
  check("library_sha256 = 원본 해시", big?.library_sha256 === entries.big.files[0].sha256);
  const k3 = rows.find((r) => r.library_id === ID("kogl3"));
  check("KOGL-3: 줄이기만(비율 그대로) · credit 에 공공누리 표기 · taken_at=year.shot", k3?.width === 2560 && k3?.height === 1707 && /공공누리 제3유형$/.test(k3?.credit ?? "") && k3?.taken_at === "1966", JSON.stringify(k3));
  const dv = rows.find((r) => r.library_id === ID("derived"));
  check("derived 가 있으면 그것을 보냄(1000×700)", dv?.width === 1000 && dv?.height === 700 && dv?.library_sha256 === entries.derived.files[1].sha256);
  const pg = rows.find((r) => r.library_id === ID("png"));
  check("작은 png 는 다시 굽지 않고 그대로", pg?.content_type === "image/png" && ap.results.find((r) => r.id === ID("png"))?.sent?.reencoded === false);
  const file = await fetch(API + new URL(big.url, API).pathname);
  check("올린 파일을 받을 수 있음", file.ok && (await file.arrayBuffer()).byteLength === big.size_bytes);

  // 3) 다시 --dry → 변화 없음
  const again = sync();
  const p2 = again.plan;
  check("다시 dry: 할 일 없음", !p2.upload.length && !p2.replace.length && !p2.update.length && !p2.delete.length && !p2.orphan.length && p2.same.length === 4);

  // 같은 그림을 다른 자료실 id 로 → 409 (sha256 중복 방지 규칙)
  {
    const buf = readFileSync(path.join(G, entries.png.files[0].path));
    const meta = Buffer.from(JSON.stringify({ library_id: ID("dup"), library_sha256: "0".repeat(64) })).toString("base64url");
    const r = await call("/api/library-sync/media", { method: "POST", body: buf, headers: { "Content-Type": "image/png", "X-Library-Meta": meta } });
    check("같은 그림 다른 id 는 409", r.res.status === 409 && r.data.code === "sha_conflict");
  }

  // 4) 표기만 바꿈
  entries.big.credit = "조선총독부 육지측량부 1934 · Stanford University Libraries (퍼블릭 도메인)";
  entries.big.description = "고친 설명";
  writeIndex();
  const up = sync();
  check("표기 바뀜: 고침 1건(credit·caption)", up.plan.update.length === 1 && Object.keys(up.plan.update[0].diff).sort().join() === "caption,credit");
  const upa = sync("--apply");
  check("표기 고침 반영", upa.results.every((r) => r.ok) && (await byLib("big"))[0]?.credit === entries.big.credit);

  // 5) 파일 바뀜 → 같은 media 행에 새 파일
  const beforePng = (await byLib("png"))[0];
  await picture(entries.png.files[0].path, { w: 500, h: 500, color: "#123", format: "png" });
  entries.png.files[0].sha256 = sha(path.join(G, entries.png.files[0].path));
  writeIndex();
  const rp = sync();
  check("파일 바뀜: 바꿈 1건", rp.plan.replace.length === 1 && rp.plan.replace[0].media_id === beforePng.id);
  const rpa = sync("--apply");
  const afterPng = (await byLib("png"))[0];
  check("파일 바꿈 반영: 같은 id · 새 해시 · 새 주소", rpa.results.every((r) => r.ok) && afterPng.id === beforePng.id && afterPng.sha256 !== beforePng.sha256 && afterPng.url !== beforePng.url && afterPng.width === 500);

  // 6) use.web false → 지움 + 쓰는 곳 목록(홈 타일 하나에 붙여 둠)
  const kogl = (await byLib("kogl3"))[0];
  tileId = `ltest-${run}`;
  d1(`INSERT INTO home_tiles (id, title, href, media_id, status) VALUES ('${tileId}', '시험 타일', '/', '${kogl.id}', 'hidden')`);
  entries.kogl3.use.web = false;
  writeIndex();
  const del = sync();
  const dItem = del.plan.delete[0];
  check("use.web false: 지움 1건 + 쓰는 곳(홈 타일) 표시", del.plan.delete.length === 1 && dItem?.media_id === kogl.id && dItem.usage?.some((u) => u.type === "home" && u.id === tileId), JSON.stringify(dItem));
  const dela = sync("--apply");
  check("지움 반영: status=deleted", dela.results.every((r) => r.ok) && (await byLib("kogl3"))[0]?.status === "deleted");
  const after = sync();
  check("지운 뒤 dry: 다시 지우지 않고 건너뜀", !after.plan.delete.length && after.plan.skip.some((x) => x.id === ID("kogl3")));

  // 7) 색인에서 사라짐 → 고아로 보고만
  writeIndex(Object.keys(entries).filter((k) => k !== "derived"));
  const orph = sync("--apply");
  check("색인에서 빠짐: 고아 1건 보고", orph.plan.orphan.length === 1 && orph.plan.orphan[0].id === ID("derived"));
  check("고아는 지우지 않음", (await byLib("derived"))[0]?.status === "active" && !orph.results.length);

  // 8) 자료실에서 온 사진이 아니면 고치거나 지울 수 없음
  const plain = d1("SELECT id FROM media WHERE library_id IS NULL LIMIT 1")[0];
  if (plain) {
    const r = await call(`/api/library-sync/media/${plain.id}`, { method: "DELETE" });
    check("자료실 밖 사진은 지울 수 없음(403)", r.res.status === 403);
  }
  const bad = await call(`/api/library-sync/media/${afterPng.id}`, { method: "PATCH", body: JSON.stringify({ credit: "가".repeat(201) }), headers: { "Content-Type": "application/json" } });
  check("credit 200자 초과 PATCH 는 400", bad.res.status === 400 && bad.data.code === "too_long");

  // 9) 화면: 본문 그림 블록에 자료실 사진 표기가 그림 바로 아래 나옴
  {
    // jsbeob-api 는 확장자 없이 import 한다(wrangler 번들) — node 에서 읽도록 ".ts" 를 붙여 찾는 훅
    const { register } = await import("node:module");
    register(
      "data:text/javascript," +
        encodeURIComponent(
          `export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith(".") && !/\\.[cm]?[jt]s$/.test(s)) return next(s + ".ts", c); throw e; } }`
        )
    );
    const { renderBlocks } = await import("../jsbeob-api/blocks.ts");
    const ctx = { media: new Map([["m1", { url: "/x.webp", width: 10, height: 10, alt: "a", caption: "설명", credit: "국토지리정보원 · 공공누리 제3유형" }], ["m2", { url: "/y.webp", width: 10, height: 10, alt: "b", caption: "옛 사진", credit: null }]]), keys: new Map(), refs: new Map(), imgrefs: new Map(), points: new Map() };
    const html = renderBlocks([{ type: "image", id: "b1", media_id: "m1" }, { type: "image", id: "b2", media_id: "m2" }], ctx);
    check("렌더: 자료실 사진은 figcaption 안에 표기", html.includes('<figcaption>설명<span class="credit">국토지리정보원 · 공공누리 제3유형</span></figcaption>'), html);
    check("렌더: 일반 사진은 예전처럼 설명만", html.includes("<figcaption>옛 사진</figcaption>"));
  }
} catch (e) {
  fail++;
  console.error("✗ 시험 중단:", e.message);
} finally {
  if (tileId) d1(`DELETE FROM home_tiles WHERE id='${tileId}'`);
  d1(`DELETE FROM media WHERE library_id LIKE 'LTEST-${run}-%'`);
  rmSync(G, { recursive: true, force: true });
}
console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
