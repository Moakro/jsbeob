#!/usr/bin/env node
// 올림함 AI 초안 감시 서비스 (미니PC, 2026-11-27 — docs/design/ai-intake.md 4.3)
//
// 30초마다 사이트 API 에 새 올림(status=uploaded)이 있는지만 묻는다(AI 비용 없음).
// 있으면 한 번에 하나씩: 원본을 임시 폴더에 받기(한글 HWP·HWPX 는 HTML+그림으로 변환, convert-hwp.mjs) → AI(기본: 오너 구독 `claude -p`) → 답의 틀 검사
// → 블록 조립(천기·음력·상대 날짜) → 결과 쓰기(ready / failed). 끝나면 임시 폴더를 지운다.
//
// 설정(환경 변수 — systemd 에서는 EnvironmentFile, 예시는 env.example):
//   INTAKE_API_BASE      사이트 주소 (예: https://jsbeob.com, 로컬: http://localhost:<API 포트>)
//   INTAKE_TOKEN_FILE    감시 서비스 전용 열쇠 파일(API 의 INTAKE_WORKER_TOKEN 과 같은 값, 권한 600)
//   INTAKE_EXTRACTOR     AI 부르는 방식 (claude-cli, 기본)
//   INTAKE_MODEL         모델 (기본 claude-opus-5-5)
//   INTAKE_POLL_SECONDS  확인 간격 (기본 30)
//   INTAKE_TIMEOUT_SECONDS  한 건 AI 시간 제한 (기본 300)
//   INTAKE_MAX_PER_DAY   하루(한국 날짜) 최대 처리 건수 (기본 30)
//   INTAKE_WORK_DIR      임시 폴더를 만들 곳 (기본 OS 임시 폴더)
//   CLAUDE_BIN           claude 실행 파일 (기본 PATH 의 claude)
//
// 손으로 한 번만: node tools/intake-watcher/watcher.mjs --once
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleDraft, kstDate, validateExtracted } from "../../jsbeob-api/intake-draft.mjs";
import { HANGUL_TYPES, HangulError, convertHangul } from "./convert-hwp.mjs";

const EXTRACTORS = {
  "claude-cli": () => import("./extractors/claude-cli.mjs"),
};

const cfg = {
  base: (process.env.INTAKE_API_BASE ?? "").replace(/\/+$/, ""),
  tokenFile: process.env.INTAKE_TOKEN_FILE ?? "",
  extractor: process.env.INTAKE_EXTRACTOR || "claude-cli",
  model: process.env.INTAKE_MODEL || "claude-opus-5-5",
  pollMs: Math.max(5, Number(process.env.INTAKE_POLL_SECONDS) || 30) * 1000,
  timeoutMs: Math.max(30, Number(process.env.INTAKE_TIMEOUT_SECONDS) || 300) * 1000,
  maxPerDay: Math.max(1, Number(process.env.INTAKE_MAX_PER_DAY) || 30),
  workDir: process.env.INTAKE_WORK_DIR || tmpdir(),
};
const once = process.argv.includes("--once");
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf", ...HANGUL_TYPES };

const log = (...a) => console.log(new Date().toISOString(), ...a);
let stopping = false;
let wake = null;
let ai;

async function main() {
  if (!/^https?:\/\//.test(cfg.base)) die("INTAKE_API_BASE 를 넣어 주세요 (예: https://jsbeob.com)");
  if (!cfg.tokenFile) die("INTAKE_TOKEN_FILE 을 넣어 주세요");
  const token = (await readFile(cfg.tokenFile, "utf8").catch(() => die(`열쇠 파일을 읽지 못했습니다: ${cfg.tokenFile}`))).trim();
  if (token.length < 32) die("열쇠가 너무 짧습니다(32자 이상)");
  if (!EXTRACTORS[cfg.extractor]) die(`모르는 INTAKE_EXTRACTOR: ${cfg.extractor} (${Object.keys(EXTRACTORS).join(", ")})`);
  ai = await EXTRACTORS[cfg.extractor]();
  await mkdir(cfg.workDir, { recursive: true, mode: 0o700 });
  const api = client(cfg.base, token);
  log(`시작 — ${cfg.base}, ${ai.name}/${cfg.model}, ${cfg.pollMs / 1000}초마다${once ? " (한 번만)" : ""}`);

  const day = { ymd: "", n: 0 };
  for (;;) {
    if (stopping) break;
    let worked = false;
    try {
      const today = kstDate().ymd;
      if (day.ymd !== today) Object.assign(day, { ymd: today, n: 0 });
      if (day.n >= cfg.maxPerDay) {
        if (day.n === cfg.maxPerDay) log(`오늘 처리 상한(${cfg.maxPerDay}건) — 내일까지 쉽니다`), day.n++;
      } else {
        const { intake } = await api.post("/api/intake-worker/claim", { accept: Object.keys(HANGUL_TYPES) });
        if (intake) {
          day.n++;
          worked = true;
          await processOne(api, intake);
        }
      }
    } catch (e) {
      log("확인 실패:", e.message);
    }
    if (once || stopping) break;
    if (!worked) await sleep(cfg.pollMs); // 하나 처리했으면 바로 다음 것을 묻는다
  }
  log("끝");
}

async function processOne(api, it) {
  const t0 = Date.now();
  log(`잡음 ${it.id} (시도 ${it.attempt}, 파일 ${it.files.length}${it.skipped_files?.length ? `, 못 읽는 형식 ${it.skipped_files.length}` : ""})`);
  const dir = await mkdtemp(join(cfg.workDir, "jsbeob-intake-"));
  try {
    const files = [];
    const fileWarnings = []; // 한글 문서 변환에서 빠진 것·못 읽은 파일 — 초안 확인 목록에 넣는다
    const unread = [];
    for (const f of it.files) {
      const ext = EXT[f.content_type];
      if (!ext) continue;
      const buf = await api.file(`/api/intake-worker/${it.id}/file/${f.n}`);
      const path = `${f.n}.${ext}`; // 원래 이름은 쓰지 않는다(경로·글자 문제)
      await writeFile(join(dir, path), buf, { mode: 0o600 });
      if (!HANGUL_TYPES[f.content_type]) {
        files.push({ path, name: f.name, content_type: f.content_type });
        continue;
      }
      try {
        const c = await convertHangul({ src: path, dir, n: f.n, name: f.name });
        files.push(...c.files);
        fileWarnings.push(...c.warnings);
        log(`  한글 변환 ${f.n} → 파일 ${c.files.length}, 경고 ${c.warnings.length}`);
      } catch (e) {
        if (!(e instanceof HangulError)) throw e;
        unread.push(`${f.name}: ${e.message}`);
        log(`  한글 변환 실패 ${f.n}: ${e.message}`);
      }
    }
    if (unread.length && !files.length) {
      // 읽을 파일이 하나도 안 남았으면 메모만으로 초안을 만들지 않는다
      await api.post(`/api/intake-worker/${it.id}/result`, {
        attempt: it.attempt, ok: false, model: cfg.model, error: `파일을 읽지 못했습니다 — ${unread.join(" / ")}`.slice(0, 500),
      });
      log(`  읽을 파일 없음 → failed (${secs(t0)})`);
      return;
    }
    const ctx = { uploadedAt: it.created_at, hint: it.hint, note: it.note, url: it.url, files };
    const r = await ai.extract(ctx, { dir, model: cfg.model, timeoutMs: cfg.timeoutMs, log });
    const errs = validateExtracted(r.extracted);
    if (errs.length) throw new Error(`AI 답이 정해진 틀에 맞지 않습니다: ${errs.slice(0, 3).join("; ")}`);
    if (r.denied?.length) log(`  거절된 도구 요청: ${r.denied.join(", ")}`);
    if (r.extracted.readable === false) {
      await api.post(`/api/intake-worker/${it.id}/result`, {
        attempt: it.attempt, ok: false, model: r.model,
        error: `글씨를 읽을 수 없습니다 — 다시 찍어 올리거나 직접 작성해 주세요${r.extracted.warnings?.length ? ` (${r.extracted.warnings.join(" / ").slice(0, 200)})` : ""}`,
      });
      log(`  읽을 수 없음 → failed (${secs(t0)})`);
      return;
    }
    const d = assembleDraft(r.extracted, ctx);
    for (const t of [...fileWarnings].reverse()) d.warnings.unshift({ level: "check", text: t });
    for (const t of [...unread].reverse()) d.warnings.unshift({ level: "check", text: `이 파일은 못 읽어 빼고 읽었습니다 — ${t}` });
    if (it.skipped_files?.length) d.warnings.unshift({ level: "info", text: `AI 가 아직 못 읽는 형식은 빼고 읽었습니다: ${it.skipped_files.join(", ")}` });
    await api.post(`/api/intake-worker/${it.id}/result`, {
      attempt: it.attempt, ok: true, kind: d.kind, title: d.title, extracted: r.extracted, draft_blocks: d.draft_blocks,
      warnings: d.warnings, model: r.model, input_tokens: r.input_tokens, output_tokens: r.output_tokens,
    });
    log(`  초안 → ready (${d.kind}, 블록 ${d.draft_blocks.length}, 확인 ${d.warnings.length}, 토큰 ${r.input_tokens}/${r.output_tokens}${r.cost_usd != null ? `, API 환산 $${r.cost_usd.toFixed(3)}` : ""}, ${secs(t0)})`);
  } catch (e) {
    if (stopping) {
      // 감시 서비스를 끄느라 멈춘 것 — 실패로 적지 않는다. 10분 뒤 다시 잡힌다
      log(`  멈춤 — 결과를 쓰지 않았습니다(10분 뒤 다시 잡힘)`);
      return;
    }
    log(`  실패: ${e.message} (${secs(t0)})`);
    await api
      .post(`/api/intake-worker/${it.id}/result`, { attempt: it.attempt, ok: false, model: cfg.model, error: String(e.message).slice(0, 500) })
      .catch((e2) => log(`  실패 기록도 못 함: ${e2.message} — 10분 뒤 다시 잡힙니다`));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function client(base, token) {
  const h = { Authorization: `Bearer ${token}` };
  const check = async (res) => {
    if (res.ok) return res;
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${body.slice(0, 200)}`);
  };
  const timeout = () => AbortSignal.timeout(60_000);
  return {
    post: async (path, body) =>
      (await check(await fetch(base + path, { method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: timeout() }))).json(),
    file: async (path) => Buffer.from(await (await check(await fetch(base + path, { headers: h, signal: timeout() }))).arrayBuffer()),
  };
}

function sleep(ms) {
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    wake = () => (clearTimeout(t), r());
  });
}
const secs = (t0) => `${((Date.now() - t0) / 1000).toFixed(1)}초`;
function die(msg) {
  console.error(msg);
  process.exit(2);
}
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    if (stopping) process.exit(1);
    stopping = true;
    log(`${sig} — 멈춥니다`);
    ai?.stop?.();
    wake?.();
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
