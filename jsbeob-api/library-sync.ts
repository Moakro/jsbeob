// 공용 자료실(GenMedia assets-shared/library) → 사진 창고(media) 가져오기 API (2026-11-28, 자료실 설계 6절)
// 미니PC 동기화 도구(scripts/library-sync.mjs) 전용 열쇠 LIBRARY_SYNC_TOKEN(Authorization: Bearer)으로만 쓴다 —
// 관리자 쿠키로는 못 쓰고, 열쇠가 설정되지 않았으면(32자 미만) 이 길은 404.
// 자료실에서 온 사진만(media.library_id 가 있는 행) 고치거나 지울 수 있다. R2 키는 사진 창고 규칙 그대로.
//
//   GET    /api/library-sync/media                 자료실에서 온 행 전부(지운 것 포함) — 도구가 색인과 비교
//   GET    /api/library-sync/media/:id/usage       이 사진을 쓰는 곳(글·장소·홈 편성·게시글)
//   POST   /api/library-sync/media                 새로 올리기. 본문 = 그림 바이트, X-Library-Meta = base64url(JSON)
//                                                  sha256 이 같은 사진이 있으면 그 행을 쓴다(사진 창고 중복 방지 규칙)
//   PUT    /api/library-sync/media/:id/file        파일 바꾸기(같은 행에 새 파일 — 글에 붙은 연결은 그대로 따라간다)
//   PATCH  /api/library-sync/media/:id             표기(alt·caption·credit·taken_at·source_url·license_code)만 고치기
//   DELETE /api/library-sync/media/:id             지우기(status=deleted, R2 원본은 남김) — 쓰는 곳 목록을 함께 돌려줌
import { mediaUrl } from "./content";
import { sameSecret } from "./intake";

const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MEDIA_MAX_BYTES = 8 * 1024 * 1024;
const LIB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const LICENSE_RE = /^[A-Z0-9][A-Z0-9.-]{0,23}$/;
const ID_RE = /^[0-9a-f-]{36}$/;
/** 표기 칸과 길이 — 관리자 사진 창고(content.ts adminUpdateMedia)와 같은 한도 */
const META_FIELDS: [string, number][] = [
  ["alt", 300],
  ["caption", 500],
  ["credit", 200],
  ["taken_at", 100],
  ["source_url", 1000],
];
const COLS =
  "id, r2_key, sha256, content_type, width, height, size_bytes, alt, caption, credit, taken_at, source_url, status, library_id, library_sha256, license_code, created_at, updated_at";

class SyncError extends Error {
  constructor(msg, public status = 400, public code = "bad_request", public extra = {}) {
    super(msg);
  }
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
const err = (error, code, status, extra = {}) => json({ error, code, ...extra }, status);

export async function handleLibrarySync(req, env, path) {
  if (!path.startsWith("/api/library-sync/")) return null;
  const want = env.LIBRARY_SYNC_TOKEN ?? "";
  if (want.length < 32) return err("not found", "not_found", 404);
  const got = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!(await sameSecret(got, want))) return err("열쇠가 맞지 않습니다", "bad_sync_token", 401);
  try {
    const m = req.method;
    if (path === "/api/library-sync/media" && m === "GET") return await listSynced(env);
    if (path === "/api/library-sync/media" && m === "POST") return await upload(req, env);
    const um = path.match(/^\/api\/library-sync\/media\/([^/]+)\/usage$/);
    if (um && m === "GET") return json({ usage: await mediaUsage(env, um[1]) });
    const fm = path.match(/^\/api\/library-sync\/media\/([^/]+)\/file$/);
    if (fm && m === "PUT") return await replaceFile(req, env, fm[1]);
    const rm = path.match(/^\/api\/library-sync\/media\/([^/]+)$/);
    if (rm && m === "PATCH") return await patchMeta(req, env, rm[1]);
    if (rm && m === "DELETE") return await remove(env, rm[1]);
    return err("not found", "not_found", 404);
  } catch (e) {
    if (e instanceof SyncError) return err(e.message, e.code, e.status, e.extra);
    throw e;
  }
}

function shape(env, r) {
  return {
    id: r.id,
    url: mediaUrl(env, r.r2_key),
    sha256: r.sha256,
    content_type: r.content_type,
    width: r.width,
    height: r.height,
    size_bytes: r.size_bytes,
    alt: r.alt,
    caption: r.caption,
    credit: r.credit,
    taken_at: r.taken_at,
    source_url: r.source_url,
    status: r.status,
    library_id: r.library_id,
    library_sha256: r.library_sha256,
    license_code: r.license_code,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

async function listSynced(env) {
  const rs = await env.DB.prepare(`SELECT ${COLS} FROM media WHERE library_id IS NOT NULL ORDER BY library_id, created_at`).all();
  return json({ media: (rs.results ?? []).map((r) => shape(env, r)) });
}

async function loadSynced(env, id) {
  if (!ID_RE.test(id)) throw new SyncError("not found", 404, "not_found");
  const row = await env.DB.prepare(`SELECT ${COLS} FROM media WHERE id=?`).bind(id).first();
  if (!row) throw new SyncError("not found", 404, "not_found");
  if (!row.library_id) throw new SyncError("자료실에서 온 사진이 아닙니다", 403, "not_library_media");
  return row;
}

/** 이 사진을 쓰는 곳 — 관리자 삭제 검사(content.ts adminDeleteMedia)와 같은 범위 + 게시글 본문 블록 */
export async function mediaUsage(env, id) {
  const rs = await env.DB.prepare(
    `SELECT 'article' AS type, a.id, a.title AS title FROM articles a
       WHERE a.hero_media_id=?1 OR a.thumb_media_id=?1 OR a.id IN (SELECT owner_id FROM media_links WHERE owner_type='article' AND media_id=?1)
     UNION ALL
     SELECT 'place' AS type, p.id, p.name AS title FROM places p
       WHERE p.hero_media_id=?1 OR p.thumb_media_id=?1 OR p.id IN (SELECT owner_id FROM media_links WHERE owner_type='place' AND media_id=?1)
     UNION ALL
     SELECT 'home' AS type, h.id, '홈 편성 · ' || h.title AS title FROM home_tiles h WHERE h.media_id=?1
     UNION ALL
     SELECT 'home' AS type, hh.slot AS id, '홈 편성 · 모바일 히어로 사진' AS title FROM home_hero hh WHERE hh.media_id=?1
     UNION ALL
     SELECT 'post' AS type, po.id, po.board || ' · ' || po.title AS title FROM posts po
       WHERE po.status != 'deleted' AND instr(po.body_blocks, '"media_id":"' || ?1 || '"') > 0`
  )
    .bind(id)
    .all();
  return rs.results ?? [];
}

/** X-Library-Meta(base64url JSON) 또는 PATCH 본문에서 표기 칸 읽기 — 길이를 넘으면 거절(도구가 미리 경고) */
function readMeta(raw, { requireLibrary }) {
  if (!raw || typeof raw !== "object") throw new SyncError("메타가 없습니다");
  const out: Record<string, string | null> = {};
  if (requireLibrary || "library_id" in raw) {
    if (typeof raw.library_id !== "string" || !LIB_ID_RE.test(raw.library_id)) throw new SyncError("library_id 형식이 틀렸습니다");
    out.library_id = raw.library_id;
  }
  if (requireLibrary || "library_sha256" in raw) {
    if (typeof raw.library_sha256 !== "string" || !SHA_RE.test(raw.library_sha256)) throw new SyncError("library_sha256 형식이 틀렸습니다");
    out.library_sha256 = raw.library_sha256;
  }
  if ("license_code" in raw) {
    const v = raw.license_code;
    if (v !== null && (typeof v !== "string" || !LICENSE_RE.test(v))) throw new SyncError("license_code 형식이 틀렸습니다");
    out.license_code = v;
  }
  for (const [f, max] of META_FIELDS) {
    if (!(f in raw)) continue;
    const v = raw[f];
    if (v === null || v === undefined) {
      out[f] = null;
      continue;
    }
    if (typeof v !== "string") throw new SyncError(`${f} 는 문자열이어야 합니다`);
    const t = v.trim();
    if (t.length > max) throw new SyncError(`${f} 는 ${max}자 이하여야 합니다 (${t.length}자)`, 400, "too_long", { field: f });
    out[f] = t === "" ? null : t;
  }
  return out;
}

function metaHeader(req) {
  const h = req.headers.get("X-Library-Meta") ?? "";
  if (!h) throw new SyncError("X-Library-Meta 가 없습니다");
  try {
    const b64 = h.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    throw new SyncError("X-Library-Meta 를 읽지 못했습니다");
  }
}

/** 올린 그림 바이트 검사 + 해시 — 사진 창고(adminUploadMedia)와 같은 형식·크기 제한 */
async function readImage(req) {
  const ct = (req.headers.get("Content-Type") ?? "").split(";")[0].trim();
  if (!MEDIA_TYPES.has(ct)) throw new SyncError("jpg·png·webp 사진만 올릴 수 있습니다", 415, "bad_type");
  const buf = await req.arrayBuffer();
  if (buf.byteLength === 0) throw new SyncError("빈 파일입니다");
  if (buf.byteLength > MEDIA_MAX_BYTES) throw new SyncError("사진이 너무 큽니다 (최대 8MB)", 413, "too_large");
  const width = Math.max(0, parseInt(req.headers.get("X-Image-Width") ?? "0", 10) || 0);
  const height = Math.max(0, parseInt(req.headers.get("X-Image-Height") ?? "0", 10) || 0);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { ct, buf, width, height, hash };
}

async function putObject(env, img, libraryId) {
  const now = new Date();
  const ext = img.ct === "image/jpeg" ? "jpg" : img.ct === "image/png" ? "png" : "webp";
  const id = crypto.randomUUID();
  const key = `media/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}.${ext}`;
  await env.UPLOADS.put(key, img.buf, {
    httpMetadata: { contentType: img.ct, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { uid: "library-sync", sha256: img.hash, library_id: libraryId },
  });
  return { id, key };
}

function setClause(meta) {
  const keys = Object.keys(meta);
  return { sql: keys.map((k) => `${k}=?`).join(", "), binds: keys.map((k) => meta[k]) };
}

async function upload(req, env) {
  const meta = readMeta(metaHeader(req), { requireLibrary: true });
  const img = await readImage(req);
  const existing = await env.DB.prepare(`SELECT ${COLS} FROM media WHERE sha256=?`).bind(img.hash).first();
  if (existing) {
    // 같은 그림이 이미 있다 — 다른 자료실 id 가 차지하고 있으면 거절, 아니면 그 행을 자료실 것으로 삼는다
    if (existing.library_id && existing.library_id !== meta.library_id) {
      throw new SyncError(`같은 그림이 이미 다른 자료실 id(${existing.library_id})로 올라가 있습니다`, 409, "sha_conflict", { media_id: existing.id });
    }
    const s = setClause(meta);
    await env.DB.prepare(`UPDATE media SET ${s.sql}, status='active', updated_at=datetime('now') WHERE id=?`).bind(...s.binds, existing.id).run();
    const row = await env.DB.prepare(`SELECT ${COLS} FROM media WHERE id=?`).bind(existing.id).first();
    return json({ media: shape(env, row), deduped: true, adopted: !existing.library_id });
  }
  const { id, key } = await putObject(env, img, meta.library_id);
  const cols = ["id", "r2_key", "sha256", "content_type", "width", "height", "size_bytes", ...Object.keys(meta)];
  const vals = [id, key, img.hash, img.ct, img.width, img.height, img.buf.byteLength, ...Object.values(meta)];
  await env.DB.prepare(`INSERT INTO media (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...vals).run();
  const row = await env.DB.prepare(`SELECT ${COLS} FROM media WHERE id=?`).bind(id).first();
  return json({ media: shape(env, row), deduped: false }, 201);
}

/** 파일 바꾸기 — 같은 media 행에 새 R2 객체를 단다. 주소가 바뀌므로(키가 새로) 캐시 걱정 없고,
 *  글·장소·홈 편성은 media id 로 붙어 있어 그대로 새 그림을 보인다. 예전 R2 객체는 남긴다(5분 페이지 캐시·되돌리기 대비). */
async function replaceFile(req, env, id) {
  const row = await loadSynced(env, id);
  const meta = readMeta(metaHeader(req), { requireLibrary: true });
  if (meta.library_id !== row.library_id) throw new SyncError("library_id 가 이 행과 다릅니다", 409, "library_mismatch");
  const img = await readImage(req);
  if (img.hash !== row.sha256) {
    const other = await env.DB.prepare("SELECT id, library_id FROM media WHERE sha256=? AND id != ?").bind(img.hash, id).first();
    if (other) throw new SyncError("같은 그림이 이미 다른 사진으로 올라가 있습니다", 409, "sha_conflict", { media_id: other.id, library_id: other.library_id });
  }
  const s = setClause(meta);
  if (img.hash === row.sha256) {
    await env.DB.prepare(`UPDATE media SET ${s.sql}, status='active', updated_at=datetime('now') WHERE id=?`).bind(...s.binds, id).run();
  } else {
    const { key } = await putObject(env, img, row.library_id);
    await env.DB.prepare(
      `UPDATE media SET r2_key=?, sha256=?, content_type=?, width=?, height=?, size_bytes=?, ${s.sql}, status='active', updated_at=datetime('now') WHERE id=?`
    )
      .bind(key, img.hash, img.ct, img.width, img.height, img.buf.byteLength, ...s.binds, id)
      .run();
  }
  const out = await env.DB.prepare(`SELECT ${COLS} FROM media WHERE id=?`).bind(id).first();
  return json({ media: shape(env, out), previous_r2_key: img.hash === row.sha256 ? null : row.r2_key });
}

async function patchMeta(req, env, id) {
  const row = await loadSynced(env, id);
  const raw = await req.json().catch(() => null);
  const meta = readMeta(raw, { requireLibrary: false });
  if ("library_id" in meta && meta.library_id !== row.library_id) throw new SyncError("library_id 는 바꿀 수 없습니다", 409, "library_mismatch");
  delete meta.library_id;
  if (!Object.keys(meta).length) throw new SyncError("바꿀 내용이 없습니다");
  const s = setClause(meta);
  await env.DB.prepare(`UPDATE media SET ${s.sql}, updated_at=datetime('now') WHERE id=?`).bind(...s.binds, id).run();
  const out = await env.DB.prepare(`SELECT ${COLS} FROM media WHERE id=?`).bind(id).first();
  return json({ media: shape(env, out) });
}

/** 지우기 — 자료실에서 웹 사용을 끈 경우(라이선스 재확인 등). 쓰는 곳이 있어도 지운다(화면에서 빠짐):
 *  도구가 --dry 에 쓰는 곳 목록을 먼저 보이고 오너 승인 뒤에만 --apply 하므로. 돌려주는 usage 로 사후 확인. */
async function remove(env, id) {
  const row = await loadSynced(env, id);
  const usage = await mediaUsage(env, id);
  if (row.status !== "deleted") {
    await env.DB.prepare("UPDATE media SET status='deleted', updated_at=datetime('now') WHERE id=?").bind(id).run();
  }
  return json({ ok: true, already: row.status === "deleted", usage });
}
