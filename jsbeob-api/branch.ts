// 지부·분원 API (2026-11-06 신설)
//   GET    /api/content/branches            공개 목록(공개 상태만, 사진 URL 포함)
//   GET    /api/admin/branches              관리 목록(전체)
//   POST   /api/admin/branches              새 지부·분원
//   PUT    /api/admin/branches/order        순서 저장 { codes: [...] }
//   GET    /api/admin/branches/:code
//   PUT    /api/admin/branches/:code
//   DELETE /api/admin/branches/:code        소속 회원이 있으면 막는다
// 저장할 때 지도 장소(map_points, kind=branch)와 "지부·분원" 지도 태그를 자동으로 맞춘다 — 지도 버튼으로 바로 보이게.
import { BRANCHES } from "../src/data/branches";
import { mediaUrl } from "./content";

const KINDS = new Set(["지부", "분원"]);
const STATUSES = new Set(["published", "draft", "hidden"]);
const CODE_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;
/** 지도 버튼용 태그 — 없으면 만든다 */
const MAP_TAG = { id: "tag-branches", slug: "branches", name: "지부·분원", color: "#2F6DB5", icon: "pin" };

class InputError extends Error {}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
function str(v: unknown, max: number, label: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new InputError(`${label}: 문자열이어야 합니다`);
  const t = v.trim();
  if (t.length > max) throw new InputError(`${label}은(는) ${max}자 이하로 입력해 주세요`);
  return t === "" ? null : t;
}
function coord(v: unknown, min: number, max: number, label: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new InputError(`${label} 값이 잘못되었습니다`);
  return Math.round(n * 1e6) / 1e6;
}
/** 전화번호는 숫자만 저장 (국번 없는 번호도 허용: 7~12자리) */
function phoneDigits(v: unknown): string | null {
  const t = str(v, 30, "연락처");
  if (!t) return null;
  const d = t.replace(/\D/g, "");
  if (d.length < 7 || d.length > 12) throw new InputError("연락처 형식을 확인해 주세요 (예: 010-1234-5678, 02-123-4567)");
  return d;
}

/** 회원 소속·장소 검증에 쓰는 지부 코드 — DB 표 + (표가 아직 없을 때) 코드 목록 */
export async function branchCodeSet(env: any): Promise<Set<string>> {
  const set = new Set(BRANCHES.map((b) => b.code));
  try {
    const rs = await env.DB.prepare("SELECT code FROM branches").all();
    for (const r of rs.results ?? []) set.add(r.code);
  } catch {
    /* 마이그레이션 전 */
  }
  return set;
}

const SELECT = `SELECT b.*, m.r2_key AS photo_key, m.width AS photo_w, m.height AS photo_h,
                       (SELECT COUNT(*) FROM member_profiles mp WHERE mp.branch=b.code) AS member_count
                  FROM branches b LEFT JOIN media m ON m.id=b.photo_media_id`;

function shape(env: any, r: any, admin: boolean) {
  const out: any = {
    code: r.code,
    kind: r.kind,
    name: r.name,
    head_name: r.head_name,
    phone: r.phone,
    postcode: r.postcode,
    address: r.address,
    address_detail: r.address_detail,
    lat: r.lat,
    lng: r.lng,
    photo: r.photo_media_id ? { id: r.photo_media_id, url: mediaUrl(env, r.photo_key), width: r.photo_w, height: r.photo_h } : null,
    sort_order: r.sort_order,
  };
  if (admin) {
    out.status = r.status;
    out.map_point_id = r.map_point_id;
    out.member_count = r.member_count;
    out.updated_at = r.updated_at;
  }
  return out;
}

async function loadOne(env: any, code: string) {
  return env.DB.prepare(`${SELECT} WHERE b.code=?`).bind(code).first();
}

async function ensureMapTag(env: any) {
  const t = await env.DB.prepare("SELECT id FROM tags WHERE slug=?").bind(MAP_TAG.slug).first();
  if (t) return t.id as string;
  const max = await env.DB.prepare("SELECT COALESCE(MAX(sort_order),0) AS m FROM tags").first();
  await env.DB.prepare(
    "INSERT INTO tags (id, slug, name, color, icon, on_map, sort_order, status) VALUES (?, ?, ?, ?, ?, 1, ?, 'active')",
  )
    .bind(MAP_TAG.id, MAP_TAG.slug, MAP_TAG.name, MAP_TAG.color, MAP_TAG.icon, (max?.m ?? 0) + 1)
    .run();
  return MAP_TAG.id;
}

/**
 * 지도 장소 맞추기 — 좌표가 있으면 map_points(kind=branch) 를 만들거나 고치고 "지부·분원" 태그를 붙인다.
 * 지부가 공개가 아니거나 좌표가 없으면 지도 장소를 숨김으로 둔다(지우지는 않음 — 글의 지도 블록이 참조할 수 있어서).
 */
async function syncMapPoint(env: any, b: any, uid: string) {
  const hasCoord = typeof b.lat === "number" && typeof b.lng === "number";
  let pointId: string | null = b.map_point_id;
  if (pointId) {
    const p = await env.DB.prepare("SELECT id FROM map_points WHERE id=?").bind(pointId).first();
    if (!p) pointId = null;
  }
  if (!pointId) {
    const p = await env.DB.prepare("SELECT id FROM map_points WHERE kind='branch' AND branch_code=?").bind(b.code).first();
    pointId = p?.id ?? null;
  }
  if (!pointId && !hasCoord) return null;
  const status = b.status === "published" && hasCoord ? "published" : "hidden";
  const summary = [b.address, b.address_detail].filter(Boolean).join(" ") || null;
  const stmts: any[] = [];
  if (pointId) {
    stmts.push(
      env.DB.prepare(
        `UPDATE map_points SET kind='branch', name=?, summary=?, lat=COALESCE(?, lat), lng=COALESCE(?, lng), branch_code=?,
           sort_order=?, status=?, updated_by=?, updated_at=datetime('now') WHERE id=?`,
      ).bind(b.name, summary, b.lat, b.lng, b.code, b.sort_order, status, uid, pointId),
    );
  } else {
    pointId = crypto.randomUUID();
    stmts.push(
      env.DB.prepare(
        `INSERT INTO map_points (id, kind, name, summary, lat, lng, branch_code, sort_order, status, created_by, updated_by)
         VALUES (?, 'branch', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(pointId, b.name, summary, b.lat, b.lng, b.code, b.sort_order, status, uid, uid),
    );
  }
  const tagId = await ensureMapTag(env);
  stmts.push(
    env.DB.prepare(
      "INSERT OR IGNORE INTO tag_links (tag_id, owner_type, owner_id, sort_order) VALUES (?, 'point', ?, ?)",
    ).bind(tagId, pointId, b.sort_order),
    env.DB.prepare("UPDATE tag_links SET sort_order=? WHERE tag_id=? AND owner_type='point' AND owner_id=?").bind(
      b.sort_order,
      tagId,
      pointId,
    ),
    env.DB.prepare("UPDATE branches SET map_point_id=? WHERE code=?").bind(pointId, b.code),
  );
  await env.DB.batch(stmts);
  return pointId;
}

async function listAll(env: any, admin: boolean) {
  const where = admin ? "" : "WHERE b.status='published'";
  const rs = await env.DB.prepare(`${SELECT} ${where} ORDER BY b.sort_order, b.name`).all();
  return (rs.results ?? []).map((r: any) => shape(env, r, admin));
}

async function save(req: Request, env: any, code: string | null, uid: string) {
  const raw: any = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") return json({ error: "잘못된 요청입니다" }, 400);
  const existing = code ? await loadOne(env, code) : null;
  if (code && !existing) return json({ error: "not found" }, 404);

  const newCode = existing ? existing.code : str(raw.code, 30, "주소 이름")?.toLowerCase() ?? null;
  if (!newCode || !CODE_RE.test(newCode)) throw new InputError("주소 이름은 영문 소문자·숫자·-로 2~30자 입력해 주세요 (예: gwangju)");
  if (!existing && (await loadOne(env, newCode))) return json({ error: `이미 있는 주소 이름입니다: ${newCode}` }, 409);
  const kind = raw.kind;
  if (!KINDS.has(kind)) throw new InputError("분류(지부/분원)를 골라 주세요");
  const name = str(raw.name, 40, "지부·분원명");
  if (!name) throw new InputError("지부·분원명을 입력해 주세요");
  const lat = coord(raw.lat, -90, 90, "위도");
  const lng = coord(raw.lng, -180, 180, "경도");
  if ((lat === null) !== (lng === null)) throw new InputError("위도와 경도를 함께 입력해 주세요");
  const photo = str(raw.photo_media_id, 64, "사진");
  if (photo && !(await env.DB.prepare("SELECT id FROM media WHERE id=? AND status='active'").bind(photo).first())) {
    throw new InputError("사진을 찾을 수 없습니다");
  }
  const status = STATUSES.has(raw.status) ? raw.status : "published";
  let sortOrder = Number.isFinite(Number(raw.sort_order)) ? Math.trunc(Number(raw.sort_order)) : null;
  if (sortOrder === null) {
    const m = await env.DB.prepare("SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM branches").first();
    sortOrder = existing?.sort_order ?? m.n;
  }
  const vals = [
    kind,
    name,
    str(raw.head_name, 40, "지부·분원장"),
    phoneDigits(raw.phone),
    str(raw.postcode, 10, "우편번호"),
    str(raw.address, 200, "주소"),
    str(raw.address_detail, 100, "상세 주소"),
    lat,
    lng,
    photo,
    sortOrder,
    status,
    uid,
  ];
  if (existing) {
    await env.DB.prepare(
      `UPDATE branches SET kind=?, name=?, head_name=?, phone=?, postcode=?, address=?, address_detail=?, lat=?, lng=?,
         photo_media_id=?, sort_order=?, status=?, updated_by=?, updated_at=datetime('now') WHERE code=?`,
    )
      .bind(...vals, newCode)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO branches (kind, name, head_name, phone, postcode, address, address_detail, lat, lng,
         photo_media_id, sort_order, status, updated_by, code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(...vals, newCode)
      .run();
  }
  const row = await loadOne(env, newCode);
  await syncMapPoint(env, row, uid);
  return json({ item: shape(env, await loadOne(env, newCode), true) }, existing ? 200 : 201);
}

async function order(req: Request, env: any, uid: string) {
  const raw: any = await req.json().catch(() => null);
  const codes: string[] = Array.isArray(raw?.codes) ? raw.codes.filter((c: unknown) => typeof c === "string") : [];
  if (!codes.length) throw new InputError("순서 목록이 비었습니다");
  await env.DB.batch(
    codes.flatMap((c, i) => [
      env.DB.prepare("UPDATE branches SET sort_order=?, updated_at=datetime('now') WHERE code=?").bind(i + 1, c),
      env.DB.prepare(
        "UPDATE map_points SET sort_order=? WHERE id=(SELECT map_point_id FROM branches WHERE code=?)",
      ).bind(i + 1, c),
      env.DB.prepare(
        `UPDATE tag_links SET sort_order=? WHERE owner_type='point'
            AND owner_id=(SELECT map_point_id FROM branches WHERE code=?) AND tag_id=(SELECT id FROM tags WHERE slug=?)`,
      ).bind(i + 1, c, MAP_TAG.slug),
    ]),
  );
  return json({ items: await listAll(env, true) });
}

async function remove(env: any, code: string) {
  const row = await loadOne(env, code);
  if (!row) return json({ error: "not found" }, 404);
  if (row.member_count > 0) {
    return json({ error: `소속 회원이 ${row.member_count}명 있어 삭제할 수 없습니다. 숨김으로 바꿔 주세요.` }, 409);
  }
  const stmts = [env.DB.prepare("DELETE FROM branches WHERE code=?").bind(code)];
  if (row.map_point_id) {
    const used = await env.DB.prepare("SELECT 1 FROM content_refs WHERE to_type='point' AND to_id=? LIMIT 1")
      .bind(row.map_point_id)
      .first();
    // 글의 지도 블록이 쓰는 지도 장소는 남기고 숨긴다
    stmts.push(
      used
        ? env.DB.prepare("UPDATE map_points SET status='hidden', branch_code=NULL WHERE id=?").bind(row.map_point_id)
        : env.DB.prepare("DELETE FROM map_points WHERE id=?").bind(row.map_point_id),
    );
    if (!used) stmts.push(env.DB.prepare("DELETE FROM tag_links WHERE owner_type='point' AND owner_id=?").bind(row.map_point_id));
  }
  await env.DB.batch(stmts);
  return json({ ok: true });
}

export async function handleBranches(req: Request, env: any, path: string, ctx: { adminUser: (r: Request) => Promise<any> }) {
  const m = req.method;
  try {
    if (path === "/api/content/branches" && m === "GET") return json({ items: await listAll(env, false) });
    if (path !== "/api/admin/branches" && !path.startsWith("/api/admin/branches/")) return null;
    const admin = await ctx.adminUser(req);
    if (!admin) return json({ error: "운영자만 사용할 수 있습니다" }, 403);
    if (path === "/api/admin/branches" && m === "GET") return json({ items: await listAll(env, true) });
    if (path === "/api/admin/branches" && m === "POST") return await save(req, env, null, admin.id);
    if (path === "/api/admin/branches/order" && m === "PUT") return await order(req, env, admin.id);
    const r = path.match(/^\/api\/admin\/branches\/([a-z0-9-]+)$/);
    if (r && m === "GET") {
      const row = await loadOne(env, r[1]);
      return row ? json({ item: shape(env, row, true) }) : json({ error: "not found" }, 404);
    }
    if (r && m === "PUT") return await save(req, env, r[1], admin.id);
    if (r && m === "DELETE") return await remove(env, r[1]);
    return json({ error: "not found" }, 404);
  } catch (e) {
    if (e instanceof InputError) return json({ error: e.message }, 400);
    throw e;
  }
}
