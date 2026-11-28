#!/usr/bin/env node
// 공용 자료실(GenMedia assets-shared/library) → jsbeob 사진 창고(media) 가져오기 (2026-11-28, 자료실 설계 6절)
//
//   pnpm library:sync            = --dry. 무엇을 올리고·바꾸고·고치고·지울지, 고아·건너뛴 것까지 목록만 보인다
//   pnpm library:sync --apply    실제 반영 (운영 대상은 오너 확인 뒤에만)
//
// 읽는 것: $GENMEDIA_ROOT/assets-shared/library/index.jsonl (자료실 색인, 4절 형식). 자료실 쪽에는 아무것도 쓰지 않는다.
// 보낸 기록은 jsbeob media.library_id 가 곧 대응표다(사이드카는 건드리지 않음).
//
// 옵션·환경변수
//   --api <주소> | LIBRARY_SYNC_API      기본 http://localhost:<이 checkout 의 API 포트>. 운영은 https://jsbeob.com
//   LIBRARY_SYNC_TOKEN                   열쇠(값). 없으면 아래 파일에서 읽는다
//   --token-file <경로> | LIBRARY_SYNC_TOKEN_FILE   기본 ~/.config/jsbeob-library-sync/token (권한 600)
//   --index <경로>                        기본 $GENMEDIA_ROOT/assets-shared/library/index.jsonl
//   GENMEDIA_ROOT                         기본 ~/GenMedia — 색인의 files[].path 는 이 기준 상대 경로
//   --json                                결과를 JSON 한 덩어리로(시험·다른 도구용)
//
// 보내는 조건: use.web === true · 라이선스 경고 없음 · kind ∈ image|map|aerial|satellite · credit 있음(200자 이하)
// 보내는 파일: files 중 role=derived, 없으면 original → 웹용 파생본(긴 변 2560px, 8MB 이하, jpg·png·webp).
//   이미 조건에 맞는 jpg·png·webp 는 다시 굽지 않고 그대로 보낸다.
//   modifiable=false(공공누리 3·4)는 크기 줄이기·형식 바꾸기만 한다(자르기·보정 없음 — 이 도구는 원래 그것만 한다).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { loadDevPorts } from "./dev-ports.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const WEB_KINDS = new Set(["image", "map", "aerial", "satellite"]);
/** 웹에 쓸 수 없는 라이선스 — 색인 도구가 이미 막지만 여기서도 한 번 더 */
const NO_WEB_LICENSES = new Set(["AI", "PAID", "UNKNOWN"]);
const MAX_EDGE = 2560;
const MAX_BYTES = 8 * 1024 * 1024;
const LIMITS = { alt: 300, caption: 500, credit: 200, taken_at: 100, source_url: 1000 };
const META_KEYS = ["alt", "caption", "credit", "taken_at", "source_url", "license_code"];

// ── 옵션 ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { apply: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) die(`${a} 다음에 값을 넣어 주세요`);
      return v;
    };
    if (a === "--apply") o.apply = true;
    else if (a === "--dry") o.apply = false;
    else if (a === "--json") o.json = true;
    else if (a === "--api") o.api = val();
    else if (a === "--index") o.index = val();
    else if (a === "--token-file") o.tokenFile = val();
    else if (a === "-h" || a === "--help") {
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
      process.exit(0);
    } else die(`모르는 옵션: ${a}`);
  }
  return o;
}
function die(msg) {
  console.error(`library-sync: ${msg}`);
  process.exit(2);
}
const expandHome = (p) => (p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p);

// ── 색인 읽기·판정 ─────────────────────────────────────────────────────────
export function readIndex(file) {
  const items = [];
  const problems = [];
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    let it;
    try {
      it = JSON.parse(line);
    } catch {
      problems.push({ line: i + 1, reason: "JSON 이 아닙니다" });
      return;
    }
    if (it?.schema !== 1) problems.push({ line: i + 1, id: it?.id, reason: `모르는 schema(${it?.schema}) — 건너뜀` });
    else if (typeof it.id !== "string" || !it.id) problems.push({ line: i + 1, reason: "id 가 없습니다" });
    else items.push(it);
  });
  const seen = new Set();
  for (const it of items) {
    if (seen.has(it.id)) problems.push({ id: it.id, reason: "색인에 같은 id 가 두 번 — 뒤의 것을 씀" });
    seen.add(it.id);
  }
  return { items: [...new Map(items.map((it) => [it.id, it])).values()], problems };
}

/** 색인 warnings 중 라이선스·쓸 곳(use.*) 관련 경고 — 하나라도 있으면 웹에 보내지 않는다 */
export function licenseWarnings(it) {
  const ws = Array.isArray(it.warnings) ? it.warnings : [];
  return ws.filter((w) => /licen|라이선스|use\.|use_|기본값|UNKNOWN/i.test(typeof w === "string" ? w : JSON.stringify(w)));
}

/** 웹에 보낼 수 있나 — 안 되면 이유 */
export function ineligible(it) {
  if (it.use?.web !== true) return "use.web 이 true 가 아님";
  const lw = licenseWarnings(it);
  if (lw.length) return `라이선스 경고: ${lw.map((w) => (typeof w === "string" ? w : JSON.stringify(w))).join(" / ")}`;
  const code = it.license?.code;
  if (!code || NO_WEB_LICENSES.has(code)) return `웹에 쓸 수 없는 라이선스(${code ?? "없음"})`;
  if (!WEB_KINDS.has(it.kind)) return `그림 종류가 아님(kind=${it.kind})`;
  return null;
}

/** 보낼 파일 — derived 가 있으면 그것, 없으면 original */
export function pickFile(it) {
  const files = Array.isArray(it.files) ? it.files : [];
  return files.find((f) => f?.role === "derived") ?? files.find((f) => f?.role === "original") ?? null;
}

const clean = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
function cut(v, max, field, warns) {
  if (v === null || v.length <= max) return v;
  warns.push(`${field} 가 ${v.length}자라 ${max}자로 줄임`);
  return v.slice(0, max - 1) + "…";
}

/** 색인 항목 → media 표기 칸 (설계 6절 '표기 문구') */
export function metaFor(it, warns = []) {
  const year = it.year ?? {};
  const meta = {
    alt: cut(clean(it.title), LIMITS.alt, "title", warns),
    caption: cut(clean(it.description), LIMITS.caption, "description", warns),
    credit: clean(it.credit),
    taken_at: cut(clean(year.shot) ?? clean(year.made), LIMITS.taken_at, "year", warns),
    source_url: clean(it.source?.url),
    license_code: clean(it.license?.code),
  };
  if (meta.source_url && meta.source_url.length > LIMITS.source_url) {
    warns.push(`source.url 이 ${meta.source_url.length}자라 뺌`);
    meta.source_url = null;
  }
  return meta;
}

/** 서버 행과 다른 표기 칸 */
export function metaDiff(meta, row) {
  const d = {};
  for (const k of META_KEYS) if ((meta[k] ?? null) !== (row[k] ?? null)) d[k] = { from: row[k] ?? null, to: meta[k] ?? null };
  return d;
}

// ── 계획 세우기 (서버에 쓰지 않음) ─────────────────────────────────────────
export function plan(items, rows, genmediaRoot) {
  const out = { upload: [], replace: [], update: [], delete: [], orphan: [], skip: [], same: [] };
  const byLib = new Map();
  for (const r of rows) {
    if (!byLib.has(r.library_id)) byLib.set(r.library_id, []);
    byLib.get(r.library_id).push(r);
  }
  for (const it of items) {
    const rs = byLib.get(it.id) ?? [];
    const active = rs.filter((r) => r.status === "active");
    const why = ineligible(it);
    if (why) {
      // 예전에 보냈는데 이제 웹에 쓸 수 없다 → 지움(쓰는 곳 목록은 실행 전에 붙인다)
      for (const r of active) out.delete.push({ id: it.id, media_id: r.id, title: it.title, reason: why });
      if (!active.length) out.skip.push({ id: it.id, title: it.title, reason: why });
      continue;
    }
    const warns = [];
    const meta = metaFor(it, warns);
    if (!meta.credit) {
      out.skip.push({ id: it.id, title: it.title, reason: "credit(표기 문구)이 없음 — 표기 없이 올리지 않음" });
      continue;
    }
    if (meta.credit.length > LIMITS.credit) {
      out.skip.push({ id: it.id, title: it.title, reason: `credit 이 ${meta.credit.length}자 — 200자 이하로 줄여야 함(라이선스 표기가 잘리지 않게 자르지 않음)` });
      continue;
    }
    const f = pickFile(it);
    if (!f?.path) {
      out.skip.push({ id: it.id, title: it.title, reason: "보낼 파일(derived·original)이 없음" });
      continue;
    }
    const abs = path.resolve(genmediaRoot, f.path);
    if (!existsSync(abs)) {
      out.skip.push({ id: it.id, title: it.title, reason: `파일이 없음: ${f.path}` });
      continue;
    }
    const src = { abs, rel: f.path, role: f.role, sha256: /^[0-9a-f]{64}$/.test(f.sha256 ?? "") ? f.sha256 : null };
    const base = { id: it.id, title: it.title, src, meta, modifiable: it.modifiable !== false, warnings: warns };
    if (active.length > 1) warns.push(`jsbeob 에 이 id 의 사진이 ${active.length}개 — 첫 것만 맞춤(${active.map((r) => r.id).join(", ")})`);
    const row = active[0];
    if (!row) {
      out.upload.push(base);
      continue;
    }
    if (!src.sha256) src.sha256 = sha256File(abs);
    if (row.library_sha256 !== src.sha256) {
      out.replace.push({ ...base, media_id: row.id });
      continue;
    }
    const diff = metaDiff(meta, row);
    if (Object.keys(diff).length) out.update.push({ ...base, media_id: row.id, diff });
    else out.same.push({ id: it.id, media_id: row.id });
  }
  // 색인에서 사라진 자료 — 지우지 않고 보고만(사람이 확인 후 관리 화면에서 삭제)
  const inIndex = new Set(items.map((it) => it.id));
  for (const r of rows) {
    if (r.status === "active" && !inIndex.has(r.library_id)) out.orphan.push({ id: r.library_id, media_id: r.id, title: r.alt, url: r.url });
  }
  return out;
}

function sha256File(abs) {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

// ── 웹용 파생본 ────────────────────────────────────────────────────────────
const TYPE_OF = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** 보낼 바이트 만들기. 이미 조건(형식·긴 변·크기)에 맞으면 원본 그대로, 아니면 긴 변 2560 webp 로 굽는다 */
export async function webVersion(abs) {
  const input = readFileSync(abs);
  const meta = await sharp(input, { limitInputPixels: false }).metadata();
  const orient = meta.orientation && meta.orientation >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
  const [w, h] = orient;
  const ct = TYPE_OF[meta.format];
  const rotated = meta.orientation && meta.orientation !== 1;
  // EXIF(촬영 위치 등)가 붙은 그림은 다시 구워 떼어 낸다 — 보이는 모습은 같다
  if (ct && !rotated && !meta.exif && Math.max(w, h) <= MAX_EDGE && input.byteLength <= MAX_BYTES && !(meta.pages > 1)) {
    return { buf: input, contentType: ct, width: w, height: h, reencoded: false };
  }
  // 크기 줄이기·형식 바꾸기만. rotate() 는 EXIF 방향대로 세워 두는 것(보이는 모습은 원본과 같음)
  let edge = MAX_EDGE;
  for (let tries = 0; tries < 8; tries++) {
    for (const quality of [86, 78, 70]) {
      const { data, info } = await sharp(input, { limitInputPixels: false })
        .rotate()
        .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
        .webp({ quality, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      if (data.byteLength <= MAX_BYTES) return { buf: data, contentType: "image/webp", width: info.width, height: info.height, reencoded: true };
    }
    edge = Math.round(edge * 0.8);
  }
  throw new Error("8MB 이하로 줄이지 못했습니다");
}

// ── API ──────────────────────────────────────────────────────────────────
function client(api, token) {
  return async function call(p, { method = "GET", body, headers = {} } = {}) {
    const res = await fetch(api.replace(/\/$/, "") + p, { method, body, headers: { Authorization: `Bearer ${token}`, ...headers } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(`${method} ${p} → ${res.status} ${data.error ?? ""}`.trim());
      e.status = res.status;
      e.data = data;
      throw e;
    }
    return data;
  };
}
const b64url = (obj) => Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");

async function sendFile(call, method, p, item) {
  const v = await webVersion(item.src.abs);
  const meta = { library_id: item.id, library_sha256: item.src.sha256 ?? sha256File(item.src.abs), ...item.meta };
  const data = await call(p, {
    method,
    body: v.buf,
    headers: { "Content-Type": v.contentType, "X-Image-Width": String(v.width), "X-Image-Height": String(v.height), "X-Library-Meta": b64url(meta) },
  });
  return { ...data, sent: { bytes: v.buf.byteLength, width: v.width, height: v.height, content_type: v.contentType, reencoded: v.reencoded } };
}

// ── 출력 ─────────────────────────────────────────────────────────────────
function printPlan(p, { api, index, apply }) {
  const L = (s = "") => console.log(s);
  L(`자료실 → jsbeob 사진 창고  ${apply ? "【실제 반영 --apply】" : "【미리보기 --dry — 아무것도 바꾸지 않음】"}`);
  L(`  색인: ${index}`);
  L(`  대상: ${api}`);
  L();
  const sec = (title, list, line) => {
    L(`■ ${title} ${list.length}건`);
    for (const x of list) L(`  - ${line(x)}`);
    if (list.length) L();
  };
  const warn = (x) => (x.warnings?.length ? `  ⚠ ${x.warnings.join("; ")}` : "");
  const lic = (x) => `${x.meta.license_code}${x.modifiable ? "" : "·변경금지"}`;
  sec("올림(새로)", p.upload, (x) => `${x.id} ${x.title ?? ""} [${lic(x)}] ← ${x.src.rel}${warn(x)}`);
  sec("파일 바꿈(같은 사진 자리에 새 파일, 글 연결 그대로)", p.replace, (x) => `${x.id} ${x.title ?? ""} → media ${x.media_id} ← ${x.src.rel}${warn(x)}`);
  sec("표기 고침", p.update, (x) => `${x.id} → media ${x.media_id}: ${Object.entries(x.diff).map(([k, d]) => `${k} 「${d.from ?? ""}」→「${d.to ?? ""}」`).join(", ")}${warn(x)}`);
  sec("지움(웹 사용 끔)", p.delete, (x) => `${x.id} → media ${x.media_id} (${x.reason})${usageText(x.usage)}`);
  sec("고아(색인에서 사라짐 — 지우지 않음, 사람이 확인)", p.orphan, (x) => `${x.id} → media ${x.media_id} ${x.title ?? ""}${usageText(x.usage)}`);
  sec("건너뜀", p.skip, (x) => `${x.id} ${x.title ?? ""} — ${x.reason}`);
  if (p.problems?.length) sec("색인 문제", p.problems, (x) => `${x.line ? `${x.line}줄 ` : ""}${x.id ?? ""} ${x.reason}`);
  L(`변화 없음 ${p.same.length}건`);
}
function usageText(usage) {
  if (!usage) return "";
  if (!usage.length) return " · 쓰는 곳 없음";
  return ` · 쓰는 곳 ${usage.length}: ${usage.map((u) => `${u.type}:${u.title}`).join(", ")}`;
}

// ── 실행 ─────────────────────────────────────────────────────────────────
export async function run(argv) {
  const opt = parseArgs(argv);
  const genmediaRoot = path.resolve(expandHome(process.env.GENMEDIA_ROOT ?? "~/GenMedia"));
  const index = path.resolve(expandHome(opt.index ?? path.join(genmediaRoot, "assets-shared/library/index.jsonl")));
  const api = opt.api ?? process.env.LIBRARY_SYNC_API ?? `http://localhost:${loadDevPorts(root).api}`;
  let token = process.env.LIBRARY_SYNC_TOKEN ?? "";
  if (!token) {
    const tf = expandHome(opt.tokenFile ?? process.env.LIBRARY_SYNC_TOKEN_FILE ?? "~/.config/jsbeob-library-sync/token");
    try {
      token = readFileSync(tf, "utf8").trim();
      if ((statSync(tf).mode & 0o077) !== 0) console.error(`library-sync: 경고 — 열쇠 파일 권한이 600 이 아닙니다: ${tf}`);
    } catch {
      die(`열쇠가 없습니다 — LIBRARY_SYNC_TOKEN 또는 열쇠 파일(${tf})`);
    }
  }
  if (!existsSync(index)) die(`자료실 색인이 없습니다: ${index}`);

  const call = client(api, token);
  const { items, problems } = readIndex(index);
  const { media: rows } = await call("/api/library-sync/media");
  const p = plan(items, rows, genmediaRoot);
  p.problems = problems;
  // 지움·고아는 쓰는 곳을 붙여 보인다(설계 6절: 글에 붙은 곳 목록)
  for (const x of [...p.delete, ...p.orphan]) x.usage = (await call(`/api/library-sync/media/${x.media_id}/usage`)).usage;
  // 미리보기에서도 파일을 열 수 있는지 확인(깨진 그림·모르는 형식은 여기서 걸러 보인다)
  for (const list of [p.upload, p.replace]) {
    for (let i = list.length - 1; i >= 0; i--) {
      const x = list[i];
      try {
        const m = await sharp(x.src.abs, { limitInputPixels: false }).metadata();
        x.source = { format: m.format, width: m.width, height: m.height, bytes: statSync(x.src.abs).size };
      } catch (e) {
        list.splice(i, 1);
        p.skip.push({ id: x.id, title: x.title, reason: `그림을 열지 못함(${e.message})` });
      }
    }
  }

  const results = [];
  if (opt.apply) {
    const step = async (kind, x, fn) => {
      try {
        const r = await fn();
        results.push({ kind, id: x.id, ok: true, ...r });
      } catch (e) {
        results.push({ kind, id: x.id, ok: false, error: e.message, data: e.data });
      }
    };
    for (const x of p.upload) await step("upload", x, () => sendFile(call, "POST", "/api/library-sync/media", x));
    for (const x of p.replace) await step("replace", x, () => sendFile(call, "PUT", `/api/library-sync/media/${x.media_id}/file`, x));
    for (const x of p.update) {
      const body = Object.fromEntries(Object.entries(x.diff).map(([k, d]) => [k, d.to]));
      await step("update", x, () => call(`/api/library-sync/media/${x.media_id}`, { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
    }
    for (const x of p.delete) await step("delete", x, () => call(`/api/library-sync/media/${x.media_id}`, { method: "DELETE" }));
  }

  const failed = results.filter((r) => !r.ok);
  if (opt.json) {
    const slim = (x) => {
      const { src, ...rest } = x;
      return src ? { ...rest, src: { rel: src.rel, role: src.role, sha256: src.sha256 } } : rest;
    };
    const plain = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Array.isArray(v) ? v.map(slim) : v]));
    console.log(JSON.stringify({ api, index, apply: opt.apply, plan: plain, results }, null, 2));
  } else {
    printPlan(p, { api, index, apply: opt.apply });
    if (opt.apply) {
      console.log();
      console.log(`반영 결과: 성공 ${results.length - failed.length} · 실패 ${failed.length}`);
      for (const r of results) {
        const extra = r.sent ? ` (${r.sent.width}×${r.sent.height} ${r.sent.content_type} ${(r.sent.bytes / 1048576).toFixed(1)}MB${r.sent.reencoded ? "" : " 원본 그대로"}${r.deduped ? ", 같은 그림 있어 그 행 사용" : ""})` : "";
        console.log(`  ${r.ok ? "✓" : "✗"} ${r.kind} ${r.id}${r.ok ? extra : ` — ${r.error}`}`);
      }
    } else {
      console.log();
      console.log("반영하려면 --apply 를 붙여 다시 실행하세요.");
    }
  }
  return failed.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`library-sync: ${e.message}`);
      process.exit(2);
    }
  );
}
