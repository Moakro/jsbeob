// 편집진 '＋ 올리기' 올림함 — 0단계(AI 없음) (2026-11-27, docs/design/ai-intake.md 4.1·4.5)
//
//   POST   /api/intake               multipart(files[], note, url, hint, source) → R2 비공개 저장 + 기록 행
//   GET    /api/intake               올림함 목록(?status=open|published|discarded|all), ＋ 배지 숫자(open)
//   GET    /api/intake/count         ＋ 배지 숫자만
//   GET    /api/intake/:id           한 건(원본 목록·메모)
//   GET    /api/intake/:id/file/:n   원본 보기 — 편집진만, Cache-Control: private, no-store
//   DELETE /api/intake/:id           버리기(원본도 R2 에서 삭제, 기록은 'discarded' 로 남김)
//   POST   /api/intake/:id/extract   AI 다시 읽기(실패·초안 준비됨 → 'uploaded' 로 되돌려 감시 서비스가 다시 가져가게) — 1단계
//   POST   /api/intake/:id/calendar  달력만 등록 — 글 없이 일정만 events 에 넣고 published (event_ids)
//   DELETE /api/intake/:id/calendar  달력 등록 되돌리기 — 만든 일정 지우고 게시 전으로
//   (한 건 보기에는 같은 파일을 올린 다른 건(same_file)·달력의 비슷한 일정(similar_events) 경고가 붙는다 — 2단계 중복 경고)
//
// 1단계(AI 초안, 2026-11-27): 사이트 서버는 AI 를 부르지 않는다. 미니PC 감시 서비스(tools/intake-watcher)가
// 감시 서비스 전용 열쇠(INTAKE_WORKER_TOKEN, Authorization: Bearer)로 아래를 부른다 — 회원 쿠키로는 못 쓴다.
//   POST   /api/intake-worker/claim           처리할 올림 하나 잡기(uploaded → extracting, attempts+1) → {intake|null}
//   GET    /api/intake-worker/:id/file/:n     원본 받기(R2 비공개 intake/)
//   POST   /api/intake-worker/:id/result      결과 쓰기 → ready / failed (잡을 때 받은 attempt 가 맞을 때만)
//
// 원본 키는 intake/<연>/<월>/<id>/<순번>.<확장자> — /api/files 는 media/·comments/ 모양만 내주므로 이 접두어는 절대 공개로 나가지 않는다.
// 모든 요청은 index.ts 의 requestUser 하나로 회원을 알아낸다(쿠키 + 출처 검사, 앱이 생기면 Bearer 토큰도 같은 자리).
// 응답은 모두 JSON, 오류는 {error, code}.
import { LEVEL } from "../src/data/levels";
import { titleSimilarity, titleKey } from "./intake-similar.mjs";

/** 올림함을 쓰는 최소 등급 — 편집진(60) 이상 (결정 1) */
export const INTAKE_LEVEL = LEVEL.EDITOR;
/** 원본 보관 기간(결정 9) */
const KEEP_DAYS = 365;
/** 한 건에 파일 수 */
const MAX_FILES = 10;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DOC_BYTES = 20 * 1024 * 1024;
const MAX_NOTE = 5000;
const MAX_URL = 2000;
/** 남용 방지: 한 사람당 시간당 건수, 처리 안 된 건이 이만큼 넘으면 경고 (6장) */
const PER_HOUR = 30;
const OPEN_WARN = 200;
/** 아직 처리하지 않은 상태 — ＋ 배지 숫자 */
const OPEN_STATUSES = ["uploaded", "extracting", "ready", "failed"];
const HINTS = new Set(["event_notice", "photos", "document"]);
const SOURCES = new Set(["web", "app", "share"]);

/** 받는 형식 — 확장자로 정한다(HWP 등은 브라우저가 붙이는 MIME 이 제각각). magic: 첫 바이트 검사(없으면 생략) */
const TYPES = {
  jpg: { ct: "image/jpeg", image: true, magic: [[0, [0xff, 0xd8, 0xff]]] },
  jpeg: { ct: "image/jpeg", image: true, magic: [[0, [0xff, 0xd8, 0xff]]], ext: "jpg" },
  png: { ct: "image/png", image: true, magic: [[0, [0x89, 0x50, 0x4e, 0x47]]] },
  webp: { ct: "image/webp", image: true, magic: [[0, [0x52, 0x49, 0x46, 0x46]], [8, [0x57, 0x45, 0x42, 0x50]]] },
  heic: { ct: "image/heic", image: true, magic: [[4, [0x66, 0x74, 0x79, 0x70]]] },
  heif: { ct: "image/heif", image: true, magic: [[4, [0x66, 0x74, 0x79, 0x70]]] },
  pdf: { ct: "application/pdf", magic: [[0, [0x25, 0x50, 0x44, 0x46]]] },
  hwp: { ct: "application/x-hwp", magic: [[0, [0xd0, 0xcf, 0x11, 0xe0]]] },
  hwpx: { ct: "application/hwp+zip", magic: [[0, [0x50, 0x4b]]] },
  docx: { ct: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: [[0, [0x50, 0x4b]]] },
  doc: { ct: "application/msword", magic: [[0, [0xd0, 0xcf, 0x11, 0xe0]]] },
};
/** MIME 만 있고 이름에 확장자가 없을 때(붙여넣은 캡처 등) */
const EXT_BY_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf" };
/** 브라우저가 바로 보여 줄 수 있는 형식 — 나머지는 내려받기 */
const INLINE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

const err = (error, code, status) => json({ error, code }, status);

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", ...headers },
  });
}

/**
 * /api/intake* 라우터. deps.requestUser(req) → {id, level, display_name} | {error, status}
 * (회원 확인은 index.ts 한 곳 — 쿠키 출처 검사·앞으로의 Bearer 토큰 포함)
 */
export async function handleIntake(req, env, path, deps) {
  if (path !== "/api/intake" && !path.startsWith("/api/intake/")) return null;
  const who = await deps.requestUser(req);
  if (!who || who.error) return err(who?.error ?? "로그인이 필요합니다", who?.code ?? "unauthenticated", who?.status ?? 401);
  if ((who.level ?? 0) < INTAKE_LEVEL) return err("편집진만 쓸 수 있습니다", "forbidden", 403);
  const m = req.method;
  if (path === "/api/intake") {
    if (m === "POST") return createIntake(req, env, who);
    if (m === "GET") return listIntakes(req, env);
  }
  if (path === "/api/intake/count" && m === "GET") return json({ open: await openCount(env) });
  const fm = path.match(/^\/api\/intake\/([0-9a-f-]{36})\/file\/(\d{1,2})$/);
  if (fm && (m === "GET" || m === "HEAD")) return serveIntakeFile(req, env, fm[1], Number(fm[2]));
  const xm = path.match(/^\/api\/intake\/([0-9a-f-]{36})\/extract$/);
  if (xm && m === "POST") return requestExtract(req, env, xm[1]);
  const cm = path.match(/^\/api\/intake\/([0-9a-f-]{36})\/calendar$/);
  if (cm && m === "POST") return publishCalendar(req, env, cm[1], who);
  if (cm && m === "DELETE") return undoCalendar(env, cm[1]);
  const im = path.match(/^\/api\/intake\/([0-9a-f-]{36})$/);
  if (im) {
    if (m === "GET") return getIntake(env, im[1]);
    if (m === "DELETE") return discardIntake(env, im[1], who);
  }
  return err("not found", "not_found", 404);
}

// ── 올리기 ─────────────────────────────────────────────────────────────
async function createIntake(req, env, who) {
  const ct = req.headers.get("Content-Type") ?? "";
  if (!ct.startsWith("multipart/form-data")) return err("multipart/form-data 로 보내 주세요", "bad_content_type", 415);
  const idem = (req.headers.get("Idempotency-Key") ?? "").trim();
  if (idem && !/^[A-Za-z0-9_.:-]{8,100}$/.test(idem)) return err("Idempotency-Key 형식이 맞지 않습니다", "bad_idempotency_key", 400);
  // 재전송: 같은 키로 이미 만든 건이 있으면 새로 만들지 않고 돌려준다(본문을 읽기 전에 — 큰 파일을 다시 받지 않게)
  if (idem) {
    const prev = await env.DB.prepare("SELECT * FROM intakes WHERE user_id=? AND idem_key=?").bind(who.id, idem).first();
    if (prev) return json({ ok: true, replayed: true, intake: shapeIntake(prev) });
  }
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM intakes WHERE user_id=? AND created_at > datetime('now', '-1 hour')"
  ).bind(who.id).first();
  if ((recent?.n ?? 0) >= PER_HOUR) return err(`한 시간에 ${PER_HOUR}건까지 올릴 수 있습니다`, "rate_limited", 429);

  let form;
  try {
    form = await req.formData();
  } catch {
    return err("올린 내용을 읽지 못했습니다", "bad_form", 400);
  }
  const note = str(form.get("note")).trim();
  const url = str(form.get("url")).trim();
  const hint = str(form.get("hint")).trim();
  const source = str(form.get("source")).trim() || "web";
  if (note.length > MAX_NOTE) return err(`메모는 ${MAX_NOTE}자까지입니다`, "note_too_long", 400);
  if (url && (url.length > MAX_URL || !/^https?:\/\/[^\s]+$/i.test(url))) return err("인터넷 주소는 http:// 또는 https:// 로 시작해야 합니다", "bad_url", 400);
  if (hint && !HINTS.has(hint)) return err("알 수 없는 종류입니다", "bad_hint", 400);
  if (!SOURCES.has(source)) return err("알 수 없는 출처입니다", "bad_source", 400);

  const raw = [...form.getAll("files[]"), ...form.getAll("files")].filter((f) => f && typeof f === "object" && "arrayBuffer" in f);
  if (raw.length > MAX_FILES) return err(`한 번에 파일 ${MAX_FILES}개까지 올릴 수 있습니다`, "too_many_files", 400);
  if (!raw.length && !note && !url) return err("파일·메모·주소 중 하나는 있어야 합니다", "empty", 400);

  // 파일 검사(형식·크기·첫 바이트) → 해시
  const files = [];
  for (const f of raw) {
    const name = cleanName(f.name || "");
    let ext = (name.match(/\.([A-Za-z0-9]{2,5})$/)?.[1] ?? "").toLowerCase();
    if (!TYPES[ext]) ext = EXT_BY_MIME[f.type] ?? ext;
    const t = TYPES[ext];
    if (!t) return err(`받지 않는 형식입니다: ${name || f.type || "이름 없음"} (사진 JPG·PNG·HEIC, PDF, 한글, 워드)`, "unsupported_type", 415);
    const max = t.image ? MAX_IMAGE_BYTES : MAX_DOC_BYTES;
    if (f.size > max) return err(`파일이 너무 큽니다: ${name} (${t.image ? "사진 8MB" : "문서 20MB"}까지)`, "too_large", 413);
    if (!f.size) return err(`빈 파일입니다: ${name}`, "empty_file", 400);
    const buf = await f.arrayBuffer();
    if (!magicOk(new Uint8Array(buf, 0, Math.min(16, buf.byteLength)), t.magic)) {
      return err(`파일 내용이 형식(${ext})과 맞지 않습니다: ${name}`, "type_mismatch", 415);
    }
    files.push({ buf, name: name || `파일.${t.ext ?? ext}`, ext: t.ext ?? ext, content_type: t.ct, size: buf.byteLength, sha256: await sha256Hex(buf) });
  }
  const fileHash = files.length ? await sha256Hex(new TextEncoder().encode(files.map((f) => f.sha256).join(","))) : null;

  // 같은 파일 묶음을 이미 올렸으면(버린 것 제외) 막지 않고 새 건을 만들되 알려 준다(2단계 중복 경고, 설계 7장 ①).
  // 전송이 끊겨 다시 보낸 경우는 위의 Idempotency-Key 가 막는다. 앞 건에 AI 초안이 있으면 그 초안을 그대로 가져와
  // AI 를 다시 부르지 않는다(설계 6장 '같은 파일 … AI 를 다시 부르지 않는다' — 'AI 다시 읽기'를 누를 때만).
  let dup = null;
  if (fileHash) {
    dup = await env.DB.prepare(
      `${SELECT} WHERE i.file_hash=? AND i.status <> 'discarded' ORDER BY i.created_at DESC LIMIT 1`
    ).bind(fileHash).first();
  }
  const copyDraft = !!dup && ["ready", "published"].includes(dup.status) && !!dup.kind && dup.draft_blocks != null;

  const id = crypto.randomUUID();
  const now = new Date();
  const prefix = `intake/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}/`;
  const stored = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const key = `${prefix}${i + 1}.${f.ext}`;
      await env.UPLOADS.put(key, f.buf, {
        httpMetadata: { contentType: f.content_type, cacheControl: "private, no-store" },
        customMetadata: { uid: who.id, intake: id, sha256: f.sha256 },
      });
      stored.push({ key, name: f.name, content_type: f.content_type, size: f.size, sha256: f.sha256 });
    }
    await env.DB.prepare(
      `INSERT INTO intakes (id, user_id, status, source, hint, note, url, files, file_hash, idem_key, purge_after)
       VALUES (?, ?, 'uploaded', ?, ?, ?, ?, ?, ?, ?, datetime('now', '+${KEEP_DAYS} days'))`
    ).bind(id, who.id, source, hint || null, note || null, url || null, JSON.stringify(stored), fileHash, idem || null).run();
    if (copyDraft) {
      const warns = [{ level: "info", text: "같은 파일을 앞서 올린 건의 AI 초안을 그대로 가져왔습니다. 새로 읽히려면 'AI 다시 읽기'를 누르세요." }, ...parseArr(dup.warnings)];
      await env.DB.prepare(
        `UPDATE intakes SET status='ready', kind=?, title=?, extracted=?, draft_blocks=?, warnings=?, model=?, updated_at=datetime('now') WHERE id=?`
      ).bind(dup.kind, dup.title, dup.extracted, dup.draft_blocks, JSON.stringify(warns.slice(0, 40)), dup.model, id).run();
    }
  } catch (e) {
    // 반쯤 올라간 원본은 지운다
    if (stored.length) await env.UPLOADS.delete(stored.map((s) => s.key)).catch(() => {});
    // 같은 키가 동시에 두 번 들어온 경우 — 먼저 들어간 건을 돌려준다
    if (idem) {
      const prev = await env.DB.prepare("SELECT * FROM intakes WHERE user_id=? AND idem_key=?").bind(who.id, idem).first();
      if (prev) return json({ ok: true, replayed: true, intake: shapeIntake(prev) });
    }
    throw e;
  }
  await onIntakeStatus(env, id, copyDraft ? "ready" : "uploaded");
  const row = await env.DB.prepare(`${SELECT} WHERE i.id=?`).bind(id).first();
  const open = await openCount(env);
  return json(
    {
      ok: true,
      intake: shapeIntake(row),
      open,
      ...(dup ? { duplicate: true, duplicate_of: shapeSameFile(dup), notice: sameFileNotice(dup) } : {}),
      ...(open > OPEN_WARN ? { warning: `처리하지 않은 올림이 ${open}건입니다. 올림함을 정리해 주세요.` } : {}),
    },
    201
  );
}

/**
 * 상태가 바뀌는 지점 — 앱 푸시(FCM)·1단계 대기열을 붙일 자리 (4.5 "상태가 바뀌는 지점을 한 함수로").
 * 0단계에서는 하는 일이 없다.
 */
export async function onIntakeStatus(_env, _id, _status) {}

// ── 목록·한 건 ────────────────────────────────────────────────────────
const SELECT = `SELECT i.*, u.display_name AS user_name, h.display_name AS handled_name, p.title AS post_title, p.board AS post_board
  FROM intakes i LEFT JOIN users u ON u.id = i.user_id LEFT JOIN users h ON h.id = i.handled_by LEFT JOIN posts p ON p.id = i.post_id`;

async function openCount(env) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM intakes WHERE status IN (${OPEN_STATUSES.map(() => "?").join(",")})`
  ).bind(...OPEN_STATUSES).first();
  return r?.n ?? 0;
}

async function listIntakes(req, env) {
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status") || "open";
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 50));
  const before = sp.get("before"); // created_at 커서
  const conds = [];
  const binds = [];
  if (status === "open") {
    conds.push(`i.status IN (${OPEN_STATUSES.map(() => "?").join(",")})`);
    binds.push(...OPEN_STATUSES);
  } else if (status === "published" || status === "discarded") {
    conds.push("i.status = ?");
    binds.push(status);
  } else if (status !== "all") {
    return err("알 수 없는 상태입니다", "bad_status", 400);
  }
  if (before) {
    conds.push("i.created_at < ?");
    binds.push(before);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rs = await env.DB.prepare(`${SELECT} ${where} ORDER BY i.created_at DESC LIMIT ?`).bind(...binds, limit + 1).all();
  const rows = rs.results ?? [];
  const more = rows.length > limit;
  const items = rows.slice(0, limit).map(shapeIntake);
  return json({ items, next: more ? rows[limit - 1].created_at : null, open: await openCount(env) });
}

async function getIntake(env, id) {
  const row = await env.DB.prepare(`${SELECT} WHERE i.id=?`).bind(id).first();
  if (!row) return err("없는 올림입니다", "not_found", 404);
  const [same_file, similar_events, events] = await Promise.all([sameFileIntakes(env, row), similarEvents(env, row), madeEvents(env, row)]);
  return json({ intake: { ...shapeIntake(row), events, same_file, similar_events } });
}

// ── 중복 경고 (2단계, 설계 7장 '같은 행사 중복 감지') ─────────────────────
/** 같은 파일 묶음(file_hash)을 올린 다른 건 — 버린 것 제외, 최근 5건 */
async function sameFileIntakes(env, row) {
  if (!row.file_hash) return [];
  const rs = await env.DB.prepare(
    `${SELECT} WHERE i.file_hash=? AND i.id<>? AND i.status <> 'discarded' ORDER BY i.created_at DESC LIMIT 5`
  ).bind(row.file_hash, row.id).all();
  return (rs.results ?? []).map(shapeSameFile);
}
function shapeSameFile(r) {
  return {
    id: r.id,
    status: r.status,
    created_at: r.created_at,
    user: { id: r.user_id, name: r.user_name ?? null },
    post: r.post_id && r.post_title != null ? { id: r.post_id, title: r.post_title, board: r.post_board } : null,
    event_count: parseArr(r.event_ids).length,
  };
}
/** 올릴 때 보여 줄 한 줄 — "이미 올린 것입니다(만든 글: …)" */
function sameFileNotice(r) {
  const made = r.post_title != null ? `만든 글: ${r.post_title}` : parseArr(r.event_ids).length ? `달력 일정 ${parseArr(r.event_ids).length}건` : "아직 게시 전";
  return `이미 올린 것입니다(${made}). 새 건으로도 넣었으니 필요 없으면 버려 주세요.`;
}

const SIMILAR_MIN = 0.5;
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/**
 * 초안의 일정(날짜가 정해진 것)마다 달력에서 ±1일 안에 이름이 비슷한 일정을 찾는다.
 * - 한 번 일정: 기간이 [시작-1일, 끝+1일] 과 겹치면 후보. 매년 일정(양력): 월·일이 ±1일 안이면 후보.
 * - 음력 일정(is_lunar)은 날짜를 바로 견줄 수 없어 이번에는 뺀다.
 * - 이 올림이 만든 글·일정은 뺀다. 편집진 화면이므로 비공개 일정도 본다.
 */
async function similarEvents(env, row) {
  if (["discarded"].includes(row.status)) return [];
  const own = new Set(parseArr(row.event_ids));
  const blocks = parseArr(row.draft_blocks)
    .filter((b) => b?.type === "schedule" && DATE_RE.test(b.start ?? ""))
    .slice(0, 10);
  const out = [];
  for (const b of blocks) {
    const name = b.label || row.title || "";
    if (titleKey(name).length < 2) continue;
    const end = DATE_RE.test(b.end ?? "") ? b.end : b.start;
    const lo = addDays(b.start, -1), hi = addDays(end, 1);
    const md = [-1, 0, 1].map((n) => addDays(b.start, n).slice(5));
    const rs = await env.DB.prepare(
      `SELECT ev.id, ev.title, ev.start_date, ev.end_date, ev.is_annual, ev.is_public, ev.category, ev.source_post_id, ev.source_block_id,
              sp.board AS source_board, sp.category AS source_category
         FROM events ev LEFT JOIN posts sp ON sp.id = ev.source_post_id
        WHERE ev.is_lunar = 0 AND (
              (ev.is_annual = 0 AND ev.start_date <= ? AND COALESCE(ev.end_date, ev.start_date) >= ?)
           OR (ev.is_annual = 1 AND substr(ev.start_date, 6) IN (?, ?, ?)))
        LIMIT 300`
    ).bind(hi, lo, ...md).all();
    const matches = (rs.results ?? [])
      .filter((e) => !own.has(e.id) && !(row.post_id && e.source_post_id === row.post_id))
      .map((e) => ({ ...e, score: Math.round(titleSimilarity(name, e.title) * 100) / 100 }))
      .filter((e) => e.score >= SIMILAR_MIN)
      .sort((a, c) => c.score - a.score)
      .slice(0, 5);
    if (matches.length) out.push({ label: name, start: b.start, end: b.end ?? null, matches });
  }
  return out;
}

/** '달력만 등록'으로 만든 일정(지금 남아 있는 것) */
async function madeEvents(env, row) {
  const ids = parseArr(row.event_ids).filter((x) => typeof x === "string").slice(0, 50);
  if (!ids.length) return [];
  const rs = await env.DB.prepare(
    `SELECT id, title, start_date, end_date, is_public, memo FROM events WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY start_date`
  ).bind(...ids).all();
  return rs.results ?? [];
}

// ── 달력만 등록 (1단계 남은 것, 설계 결정 5 ②) ──────────────────────────
/** 한 번에 만드는 일정 수 */
const MAX_CAL_EVENTS = 20;
const EV_TITLE_MAX = 200;
const EV_MEMO_MAX = 2000;
/**
 * 소식 글 없이 일정 블록(들)만 달력(events)에 넣는다. 본문 {events:[{label, start, end?, memo?}], public?:boolean}
 * - 공개 범위·카테고리는 소식 글의 일정과 같은 규칙(카테고리 '일정', 공개, 연례·음력 아님). public:false 면 편집진만 보기(결정 5).
 * - 소식 글의 일정과 달리 메모(시간·장소)를 일정에 함께 넣는다 — 볼 글이 없으므로.
 * - 올림은 published, event_ids·handled_by 기록. 한 묶음(D1 batch)으로 — 올림을 먼저 published 로 바꾸고,
 *   바뀐 경우에만 일정이 들어가게 해서 두 사람이 동시에 눌러도 한 번만 만든다.
 */
async function publishCalendar(req, env, id, who) {
  let b;
  try {
    b = await req.json();
  } catch {
    return err("JSON 으로 보내 주세요", "bad_json", 400);
  }
  const row = await env.DB.prepare("SELECT id, status, title FROM intakes WHERE id=?").bind(id).first();
  if (!row) return err("없는 올림입니다", "not_found", 404);
  if (row.status === "published") return err("이미 게시한 올림입니다", "already_published", 409);
  if (row.status === "discarded") return err("버린 올림입니다", "discarded", 409);
  const raw = Array.isArray(b?.events) ? b.events : [];
  if (!raw.length) return err("달력에 넣을 일정이 없습니다", "no_events", 400);
  if (raw.length > MAX_CAL_EVENTS) return err(`한 번에 일정 ${MAX_CAL_EVENTS}개까지 넣을 수 있습니다`, "too_many_events", 400);
  const evs = [];
  for (const [i, e] of raw.entries()) {
    const n = raw.length > 1 ? `${i + 1}번째 일정: ` : "";
    const title = String(e?.label ?? "").replace(/\s*\n\s*/g, " ").trim() || String(row.title ?? "").trim();
    const start = String(e?.start ?? "");
    const end = String(e?.end ?? "");
    const memo = String(e?.memo ?? "").trim();
    if (!title) return err(`${n}이름을 적어 주세요`, "bad_event", 400);
    if (title.length > EV_TITLE_MAX) return err(`${n}이름은 ${EV_TITLE_MAX}자까지입니다`, "bad_event", 400);
    if (!DATE_RE.test(start) || Number.isNaN(Date.parse(start))) return err(`${n}날짜를 정해 주세요`, "bad_event", 400);
    if (end && (!DATE_RE.test(end) || Number.isNaN(Date.parse(end)) || end < start)) return err(`${n}끝나는 날이 맞지 않습니다`, "bad_event", 400);
    if (memo.length > EV_MEMO_MAX) return err(`${n}메모는 ${EV_MEMO_MAX}자까지입니다`, "bad_event", 400);
    evs.push({ id: crypto.randomUUID(), title, start, end: end && end !== start ? end : null, memo: memo || null });
  }
  const pub = b?.public === false ? 0 : 1;
  const ids = JSON.stringify(evs.map((e) => e.id));
  const res = await env.DB.batch([
    env.DB.prepare(
      "UPDATE intakes SET status='published', event_ids=?, handled_by=?, updated_at=datetime('now') WHERE id=? AND status NOT IN ('published','discarded')"
    ).bind(ids, who.id, id),
    ...evs.map((e) =>
      env.DB.prepare(
        `INSERT INTO events (id, user_id, title, start_date, end_date, category, is_annual, is_lunar, is_public, memo)
         SELECT ?, ?, ?, ?, ?, '일정', 0, 0, ?, ? WHERE EXISTS (SELECT 1 FROM intakes WHERE id=? AND status='published' AND event_ids=?)`
      ).bind(e.id, who.id, e.title, e.start, e.end, pub, e.memo, id, ids)
    ),
  ]);
  if (!res[0]?.meta?.changes) return err("그 사이 다른 사람이 처리한 올림입니다", "already_published", 409);
  await onIntakeStatus(env, id, "published");
  return getIntake(env, id);
}

/**
 * 달력 등록 되돌리기 — 설계에 되돌리기 규정이 없어 간단히: 만든 일정을 지우고 올림을 게시 전 상태로 돌린다.
 * (AI 초안이 있으면 '초안 준비', 없으면 '올림'.) 달력에서 그 사이 고친 일정도 함께 지워진다(확인 창에서 알림).
 * 소식 글로 게시한 올림은 해당 없음(글 삭제는 글 화면에서).
 */
async function undoCalendar(env, id) {
  const row = await env.DB.prepare("SELECT id, status, kind, post_id, event_ids FROM intakes WHERE id=?").bind(id).first();
  if (!row) return err("없는 올림입니다", "not_found", 404);
  if (row.status !== "published" || row.post_id || !row.event_ids) return err("달력만 등록한 올림이 아닙니다", "not_calendar", 409);
  const ids = parseArr(row.event_ids).filter((x) => typeof x === "string");
  const back = row.kind ? "ready" : "uploaded";
  const res = await env.DB.batch([
    env.DB.prepare(
      "UPDATE intakes SET status=?, event_ids=NULL, handled_by=NULL, updated_at=datetime('now') WHERE id=? AND status='published' AND post_id IS NULL AND event_ids=?"
    ).bind(back, id, row.event_ids),
    ...(ids.length
      ? [env.DB.prepare(
          `DELETE FROM events WHERE id IN (${ids.map(() => "?").join(",")}) AND source_post_id IS NULL AND NOT EXISTS (SELECT 1 FROM intakes WHERE id=? AND event_ids IS NOT NULL)`
        ).bind(...ids, id)]
      : []),
  ]);
  if (!res[0]?.meta?.changes) return err("그 사이 다른 사람이 처리한 올림입니다", "stale", 409);
  await onIntakeStatus(env, id, back);
  return getIntake(env, id);
}

/** 응답 모양 — R2 키는 내보내지 않는다(원본은 file_url 로만) */
export function shapeIntake(r) {
  const files = parseArr(r.files);
  const purged = !!r.purged_at;
  return {
    id: r.id,
    status: r.status,
    source: r.source,
    hint: r.hint ?? null,
    note: r.note ?? null,
    url: r.url ?? null,
    user: { id: r.user_id, name: r.user_name ?? null },
    files: files.map((f, i) => ({
      n: i + 1,
      name: f.name,
      content_type: f.content_type,
      size: f.size,
      file_url: purged ? null : `/api/intake/${r.id}/file/${i + 1}`,
    })),
    // 1단계(AI)에서 채워지는 칸
    kind: r.kind ?? null,
    title: r.title ?? null,
    draft_blocks: parseArr(r.draft_blocks),
    warnings: parseArr(r.warnings),
    excluded: parseObj(r.extracted)?.excluded ?? [],
    doc_type: parseObj(r.extracted)?.doc_type ?? null,
    model: r.model ?? null,
    attempts: r.attempts ?? 0,
    ai_readable: aiReadable(r),
    error: r.error ?? null,
    // 결과
    post_id: r.post_id ?? null,
    post: r.post_id && r.post_title != null ? { id: r.post_id, title: r.post_title, board: r.post_board } : null,
    /** '달력만 등록'으로 만든 일정 id (한 건 보기에서는 events 에 제목·날짜도) */
    event_ids: parseArr(r.event_ids),
    handled_by: r.handled_by ? { id: r.handled_by, name: r.handled_name ?? null } : null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    purge_after: r.purge_after ?? null,
    purged_at: r.purged_at ?? null,
  };
}

// ── 원본 보기 ──────────────────────────────────────────────────────────
async function serveIntakeFile(req, env, id, n) {
  const row = await env.DB.prepare("SELECT files, purged_at FROM intakes WHERE id=?").bind(id).first();
  if (!row || row.purged_at) return err("없는 파일입니다", "not_found", 404);
  const f = parseArr(row.files)[n - 1];
  if (!f || typeof f.key !== "string" || !f.key.startsWith(`intake/`)) return err("없는 파일입니다", "not_found", 404);
  const obj = await env.UPLOADS.get(f.key);
  if (!obj) return err("없는 파일입니다", "not_found", 404);
  const ct = f.content_type || "application/octet-stream";
  const inline = INLINE_TYPES.has(ct) && new URL(req.url).searchParams.get("download") !== "1";
  const headers = new Headers({
    "Content-Type": ct,
    "Content-Length": String(obj.size),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name || `file-${n}`)}`,
    "Referrer-Policy": "no-referrer",
  });
  return new Response(req.method === "HEAD" ? null : obj.body, { headers });
}

// ── 버리기 ─────────────────────────────────────────────────────────────
async function discardIntake(env, id, who) {
  const row = await env.DB.prepare("SELECT id, status, files, purged_at FROM intakes WHERE id=?").bind(id).first();
  if (!row) return err("없는 올림입니다", "not_found", 404);
  if (row.status === "discarded") return json({ ok: true, already: true });
  await purgeFiles(env, row);
  await env.DB.prepare(
    "UPDATE intakes SET status='discarded', handled_by=?, purged_at=COALESCE(purged_at, datetime('now')), updated_at=datetime('now') WHERE id=?"
  ).bind(who.id, id).run();
  await onIntakeStatus(env, id, "discarded");
  return json({ ok: true });
}

async function purgeFiles(env, row) {
  if (row.purged_at) return;
  const keys = parseArr(row.files).map((f) => f?.key).filter((k) => typeof k === "string" && k.startsWith("intake/"));
  if (keys.length) await env.UPLOADS.delete(keys);
}

// ── 게시 연결 (index.ts createPost 가 쓴다) ────────────────────────────
/** 글로 옮길 수 있는 올림인지 — 문제가 있으면 오류 글을 돌려준다 */
export async function checkIntakeForPost(env, intakeId, user) {
  if (typeof intakeId !== "string" || !/^[0-9a-f-]{36}$/.test(intakeId)) return "올림 번호가 맞지 않습니다";
  if ((user?.level ?? 0) < INTAKE_LEVEL) return "편집진만 올림을 글로 옮길 수 있습니다";
  const row = await env.DB.prepare("SELECT status FROM intakes WHERE id=?").bind(intakeId).first();
  if (!row) return "없는 올림입니다";
  if (row.status === "published") return "이미 게시한 올림입니다";
  if (row.status === "discarded") return "버린 올림입니다";
  return null;
}
/** 글 저장과 같은 묶음(DB.batch)에 넣을 문 */
export function intakePublishStmt(env, intakeId, postId, uid) {
  return env.DB.prepare(
    "UPDATE intakes SET status='published', post_id=?, handled_by=?, updated_at=datetime('now') WHERE id=? AND status NOT IN ('published','discarded')"
  ).bind(postId, uid, intakeId);
}

// ── 1년 지난 원본 자동 삭제 (Cron, 하루 1번 — wrangler.toml [triggers]) ──
export async function purgeExpiredIntakes(env, limit = 200) {
  const rs = await env.DB.prepare(
    "SELECT id, files, purged_at FROM intakes WHERE purged_at IS NULL AND purge_after IS NOT NULL AND purge_after <= datetime('now') ORDER BY purge_after LIMIT ?"
  ).bind(limit).all();
  let n = 0;
  for (const row of rs.results ?? []) {
    await purgeFiles(env, row);
    // 원본과 함께 올린 메모·주소도 지운다. 기록(누가·언제·만든 글)은 남긴다
    await env.DB.prepare(
      "UPDATE intakes SET purged_at=datetime('now'), note=NULL, url=NULL, updated_at=datetime('now') WHERE id=?"
    ).bind(row.id).run();
    n++;
  }
  return n;
}


// ── AI 초안 1단계: 감시 서비스 전용 (2026-11-27) ─────────────────────────
// 사이트 서버는 AI 를 부르지 않는다. 미니PC 감시 서비스가 30초마다 claim 으로 새 올림만 묻고(AI 비용 없음),
// 있을 때만 AI(지금은 오너 구독 `claude -p`)를 깨워 초안을 만든 뒤 result 로 되돌린다.
// AI 를 부르는 쪽을 API 키 방식으로 바꿔도 이 세 엔드포인트와 결과 모양은 그대로다(docs/design/ai-intake.md 4.3).

/** AI 가 바로 읽는 원본 형식(HEIC 는 아직 — 'uploaded' 로 남고 직접 작성) */
const AI_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
/**
 * 감시 서비스가 변환해서 읽는 형식(2026-11-27: 한글 HWP·HWPX, 워드 DOCX. 옛 워드 .doc 은 감시 서비스가 받아서 이유와 함께 '못 읽음').
 * claim 때 감시 서비스가 accept 로 알려야만 넘긴다 —
 * 옛 감시 서비스(변환 기능 없음)가 받아서 빈 초안을 만드는 일이 없게. 화면의 ai_readable 은 이것까지 포함한다.
 */
const CONVERT_TYPES = new Set([
  "application/x-hwp",
  "application/hwp+zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);
const ALL_AI_TYPES = new Set([...AI_TYPES, ...CONVERT_TYPES]);
/** extracting 으로 이만큼 멈춰 있으면 다시 잡을 수 있다(감시 서비스가 도중에 꺼졌을 때) */
const STALE_MINUTES = 10;
/** 자동으로 다시 잡는 최대 횟수 — 넘으면 failed. '다시 시도'를 누르면 0 부터 */
const MAX_ATTEMPTS = 3;
const DRAFT_KINDS = new Set(["event_notice", "photos", "document", "unknown"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 이 올림을 AI 가 읽을 수 있나 — 읽을 수 있는 파일이 하나라도 있거나, 파일 없이 메모·주소만 있을 때 */
function aiReadable(r, types = ALL_AI_TYPES) {
  if (r.purged_at) return false;
  const files = parseArr(r.files);
  if (files.length) return files.some((f) => types.has(f?.content_type));
  return !!(r.note || r.url);
}

export async function handleIntakeWorker(req, env, path) {
  if (!path.startsWith("/api/intake-worker/")) return null;
  // 열쇠가 설정되지 않았으면 이 길은 없는 것으로
  const want = env.INTAKE_WORKER_TOKEN ?? "";
  if (want.length < 32) return err("not found", "not_found", 404);
  const got = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!(await sameSecret(got, want))) return err("열쇠가 맞지 않습니다", "bad_worker_token", 401);
  const m = req.method;
  if (path === "/api/intake-worker/claim" && m === "POST") return claimIntake(req, env);
  const fm = path.match(/^\/api\/intake-worker\/([0-9a-f-]{36})\/file\/(\d{1,2})$/);
  if (fm && m === "GET") return workerFile(env, fm[1], Number(fm[2]));
  const rm = path.match(/^\/api\/intake-worker\/([0-9a-f-]{36})\/result$/);
  if (rm && m === "POST") return writeResult(req, env, rm[1]);
  return err("not found", "not_found", 404);
}

export async function sameSecret(a, b) {
  // 길이·내용을 시간 차이로 알 수 없게 해시끼리 비교
  const [x, y] = await Promise.all([a, b].map((v) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(v))));
  const p = new Uint8Array(x), q = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < p.length; i++) d |= p[i] ^ q[i];
  return d === 0 && a.length > 0;
}

/** 처리할 올림 하나 잡기 — 오래된 것부터. 같은 행을 두 감시 서비스가 잡지 않도록 조건부 UPDATE 로 잡는다 */
async function claimIntake(req, env) {
  // 감시 서비스가 변환해서 읽을 수 있다고 알린 형식(accept)만 더한다
  const body = await req.json().catch(() => ({}));
  const accept = Array.isArray(body?.accept) ? body.accept.filter((t) => CONVERT_TYPES.has(t)) : [];
  const types = new Set([...AI_TYPES, ...accept]);
  const rs = await env.DB.prepare(
    `SELECT id, status, files, note, url, attempts, purged_at FROM intakes
     WHERE purged_at IS NULL AND (status='uploaded' OR (status='extracting' AND updated_at < datetime('now', '-${STALE_MINUTES} minutes')))
     ORDER BY created_at LIMIT 30`
  ).all();
  for (const r of rs.results ?? []) {
    if (!aiReadable(r, types)) continue; // 못 읽는 형식만 있는 건은 'uploaded' 로 남긴다(직접 작성)
    if (r.status === "extracting" && (r.attempts ?? 0) >= MAX_ATTEMPTS) {
      await env.DB.prepare(
        "UPDATE intakes SET status='failed', error=?, updated_at=datetime('now') WHERE id=? AND status='extracting' AND attempts=?"
      ).bind(`AI 읽기가 ${MAX_ATTEMPTS}번 끝나지 않았습니다`, r.id, r.attempts).run();
      await onIntakeStatus(env, r.id, "failed");
      continue;
    }
    const got = await env.DB.prepare(
      `UPDATE intakes SET status='extracting', attempts=attempts+1, error=NULL, updated_at=datetime('now')
       WHERE id=? AND attempts=? AND (status='uploaded' OR (status='extracting' AND updated_at < datetime('now', '-${STALE_MINUTES} minutes')))
       RETURNING *`
    ).bind(r.id, r.attempts ?? 0).first();
    if (!got) continue; // 그 사이 다른 쪽이 잡음
    await onIntakeStatus(env, r.id, "extracting");
    const files = parseArr(got.files);
    return json({
      intake: {
        id: got.id,
        attempt: got.attempts,
        hint: got.hint ?? null,
        note: got.note ?? null,
        url: got.url ?? null,
        created_at: got.created_at,
        // AI 가 읽을 수 있는 파일만(n 은 원본 순번)
        files: files
          .map((f, i) => ({ n: i + 1, name: f.name, content_type: f.content_type, size: f.size }))
          .filter((f) => types.has(f.content_type)),
        skipped_files: files.filter((f) => !types.has(f.content_type)).map((f) => f.name),
      },
    });
  }
  return json({ intake: null });
}

async function workerFile(env, id, n) {
  const row = await env.DB.prepare("SELECT files, status, purged_at FROM intakes WHERE id=?").bind(id).first();
  if (!row || row.purged_at || row.status !== "extracting") return err("없는 파일입니다", "not_found", 404);
  const f = parseArr(row.files)[n - 1];
  if (!f || typeof f.key !== "string" || !f.key.startsWith("intake/")) return err("없는 파일입니다", "not_found", 404);
  const obj = await env.UPLOADS.get(f.key);
  if (!obj) return err("없는 파일입니다", "not_found", 404);
  return new Response(obj.body, {
    headers: { "Content-Type": f.content_type || "application/octet-stream", "Content-Length": String(obj.size), "Cache-Control": "private, no-store" },
  });
}

/**
 * 결과 쓰기. 본문:
 *   성공 {attempt, ok:true, kind, title, extracted, draft_blocks, warnings, model, input_tokens?, output_tokens?} → ready
 *   실패 {attempt, ok:false, error, model?} → failed
 * attempt 가 잡을 때 받은 값과 다르면(그 사이 다시 잡힘·다시 시도) 409 — 늦게 끝난 결과가 새 결과를 덮지 않게.
 */
async function writeResult(req, env, id) {
  let b;
  try {
    b = await req.json();
  } catch {
    return err("JSON 으로 보내 주세요", "bad_json", 400);
  }
  const attempt = Number(b?.attempt);
  if (!Number.isInteger(attempt) || attempt < 1) return err("attempt 가 필요합니다", "bad_attempt", 400);
  const model = typeof b.model === "string" ? b.model.slice(0, 100) : null;
  let stmt;
  if (b.ok === false) {
    const msg = String(b.error ?? "AI 읽기 실패").slice(0, 500);
    stmt = env.DB.prepare(
      "UPDATE intakes SET status='failed', error=?, model=COALESCE(?, model), updated_at=datetime('now') WHERE id=? AND status='extracting' AND attempts=?"
    ).bind(msg, model, id, attempt);
  } else if (b.ok === true) {
    const bad = (m) => err(m, "bad_result", 400);
    if (!DRAFT_KINDS.has(b.kind)) return bad("kind 가 맞지 않습니다");
    const title = b.title == null ? null : String(b.title).replace(/\s*\n\s*/g, " ").trim().slice(0, 200) || null;
    const blocks = cleanDraftBlocks(b.draft_blocks);
    if (typeof blocks === "string") return bad(blocks);
    const warnings = (Array.isArray(b.warnings) ? b.warnings : [])
      .slice(0, 40)
      .map((w) => (typeof w === "string" ? { level: "check", text: w } : { level: w?.level === "info" ? "info" : "check", text: String(w?.text ?? "") }))
      .map((w) => ({ ...w, text: w.text.slice(0, 300) }))
      .filter((w) => w.text.trim());
    const extracted = b.extracted && typeof b.extracted === "object" ? JSON.stringify(b.extracted) : null;
    if (extracted && extracted.length > 100_000) return bad("extracted 가 너무 큽니다");
    const tok = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
    stmt = env.DB.prepare(
      `UPDATE intakes SET status='ready', kind=?, title=?, extracted=?, draft_blocks=?, warnings=?, model=?, input_tokens=?, output_tokens=?, error=NULL, updated_at=datetime('now')
       WHERE id=? AND status='extracting' AND attempts=?`
    ).bind(b.kind, title, extracted, JSON.stringify(blocks), JSON.stringify(warnings), model, tok(b.input_tokens), tok(b.output_tokens), id, attempt);
  } else {
    return err("ok 가 필요합니다", "bad_result", 400);
  }
  const r = await stmt.run();
  if (!r.meta?.changes) return err("이미 다른 결과가 있거나 다시 잡힌 올림입니다", "stale_attempt", 409);
  const status = b.ok ? "ready" : "failed";
  await onIntakeStatus(env, id, status);
  return json({ ok: true, status });
}

/** 초안 블록 검사 — 일정(schedule)·글(text)만. 날짜를 못 정한 일정은 start:"" 로 허용(편집기가 게시 전에 막음) */
function cleanDraftBlocks(raw) {
  if (!Array.isArray(raw)) return "draft_blocks 는 목록이어야 합니다";
  if (raw.length > 50) return "draft_blocks 가 너무 많습니다";
  const out = [];
  for (const b of raw) {
    if (b?.type === "schedule") {
      const start = String(b.start ?? "");
      const end = String(b.end ?? "");
      if (start && !DATE_RE.test(start)) return "일정 시작일 형식이 맞지 않습니다";
      if (end && (!DATE_RE.test(end) || !start || end < start)) return "일정 끝나는 날이 맞지 않습니다";
      const label = String(b.label ?? "").replace(/\s*\n\s*/g, " ").trim().slice(0, 200);
      const memo = String(b.memo ?? "").trim().slice(0, 1000);
      out.push({ type: "schedule", start, ...(end && end !== start ? { end } : {}), ...(label ? { label } : {}), ...(memo ? { memo } : {}) });
    } else if (b?.type === "text") {
      const text = String(b.text ?? "").slice(0, 20000);
      if (text.trim()) out.push({ type: "text", text });
    } else {
      return `초안에 쓸 수 없는 블록입니다: ${String(b?.type).slice(0, 20)}`;
    }
  }
  return out;
}

/** 편집진의 '다시 읽기·다시 시도' — 'uploaded' 로 되돌리면 감시 서비스가 다음 확인 때 가져간다 */
async function requestExtract(req, env, id) {
  const row = await env.DB.prepare("SELECT * FROM intakes WHERE id=?").bind(id).first();
  if (!row) return err("없는 올림입니다", "not_found", 404);
  if (!["failed", "ready", "uploaded"].includes(row.status)) return err("지금은 다시 읽을 수 없는 상태입니다", "bad_status", 409);
  if (!aiReadable(row)) return err("AI 가 읽을 수 있는 파일(사진 JPG·PNG·WebP, PDF, 한글 HWP·HWPX, 워드 DOCX)이 없습니다", "not_readable", 422);
  let hint = row.hint ?? null;
  const body = await req.json().catch(() => ({}));
  if (body && "hint" in body) {
    if (body.hint !== null && body.hint !== "" && !HINTS.has(body.hint)) return err("알 수 없는 종류입니다", "bad_hint", 400);
    hint = body.hint || null;
  }
  await env.DB.prepare(
    `UPDATE intakes SET status='uploaded', hint=?, attempts=0, error=NULL, draft_blocks=NULL, warnings=NULL, extracted=NULL, updated_at=datetime('now')
     WHERE id=? AND status IN ('failed','ready','uploaded')`
  ).bind(hint, id).run();
  await onIntakeStatus(env, id, "uploaded");
  return getIntake(env, id);
}

// ── 도우미 ─────────────────────────────────────────────────────────────
function str(v) {
  return typeof v === "string" ? v : "";
}
function parseObj(t) {
  try {
    const v = JSON.parse(t ?? "null");
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
function parseArr(t) {
  try {
    const v = JSON.parse(t ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function cleanName(n) {
  // 경로·제어 문자 제거, 길이 제한
  return String(n).replace(/^.*[\\/]/, "").replace(/[\u0000-\u001f\u007f"]/g, "").slice(0, 120).trim();
}
function magicOk(head, magic) {
  if (!magic) return true;
  return magic.every(([off, bytes]) => bytes.every((b, i) => head[off + i] === b));
}
async function sha256Hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
