// 자료(문서·장소·지도·홈) API (/api/content/*, /api/admin/content/*)
// 복원: 2026-11-01 배포본(jsbeob-api-preview) 번들에서 복원. 원본 TS 타입 정보는 번들에서 사라져
// 대부분 생략되었다(tsconfig strict:false). 동작은 배포본과 같다.
import { BOARD_LABEL, PRIVATE_BOARDS_SQL } from "./boards";
import { isArticleCategory } from "./library";
import { BlockError, DOC_MARKER, MEMBER_KEY_RE, allMediaIds, blocksForEditor, blocksFromLegacy, imageItems, loadRenderCtx, loadTargetBlocks, normalizeBlocks, parseStoredBlocks, plainFromBlocks, pointStyles, refHref, refsOf, renderBlocks, resolveBlocks, s } from "./blocks";

const ARTICLE_KINDS = {
  about: ["person", "doctrine", "history", "org", "branches", "anthem", "directions", "overview"],
  // 자료실(library)의 종류는 고정 목록이 아니라 분류 표(library_categories, type=article)에서 읽는다(2026-09-28 — library.ts).
  library: []
};
async function validArticleKind(env, section, kind) {
  if (section === "library") return isArticleCategory(env.DB, kind);
  return !!ARTICLE_KINDS[section]?.includes(kind);
}
const LIBRARY_RESERVED_SLUGS = new Set(["p", "places", "library"]);
const PLACE_KINDS = ["jeongak", "landmark", "branch", "etc"];
const MAP_POINT_KINDS = ["jeongak", "branch", "affiliated", "sacred", "general"];
const MAP_KIND_LABEL = {
  jeongak: "전각",
  branch: "지부·분원",
  affiliated: "법종교",
  sacred: "성지",
  general: "장소"
};
const STATUSES = new Set(["draft", "published", "hidden"]);
const SLUG_RE = /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣_-]{0,79}$/;
const TITLE_MAX = 200;
const SUMMARY_MAX = 500;
const BODY_MAX = 2e5;
const GALLERY_MAX = 60;
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MEDIA_MAX_BYTES = 8 * 1024 * 1024;
const MEDIA_KEY_RE = /^media\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
const TYPE_MAP = { articles: "article", places: "place" };
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" }
  });
}
function nowIso() {
  return (new Date()).toISOString().replace(/\.\d+Z$/, "Z");
}
function str(v, max) {
  if (v === void 0 || v === null) return null;
  if (typeof v !== "string") throw new InputError("문자열이어야 합니다");
  const t = v.trim();
  if (t.length > max) throw new InputError(`${max}자 이하로 입력해 주세요`);
  return t === "" ? null : t;
}
class InputError extends Error {}
export function mediaUrl(env, key) {
  const base = (env.MEDIA_PUBLIC_BASE || "").replace(/\/$/, "");
  return base ? `${base}/${key}` : `/api/files/${key}`;
}
export async function handleContent(req, env, path, ctx) {
  try {
    return await routeContent(req, env, path, ctx);
  } catch (e) {
    if (e instanceof InputError || e instanceof BlockError) return json({ error: e.message }, 400);
    throw e;
  }
}
export function siteHosts(env, req) {
  const set = new Set(["jsbeob.com", "www.jsbeob.com"]);
  try {
    if (env.SITE_ORIGIN) set.add(new URL(env.SITE_ORIGIN).host.toLowerCase());
  } catch {
  }
  try {
    const o = req?.headers.get("Origin");
    if (o) set.add(new URL(o).host.toLowerCase());
  } catch {
  }
  return set;
}
function blocksOfRow(r) {
  return parseStoredBlocks(r.body_blocks) ?? blocksFromLegacy(r.body_md);
}
export async function renderRowBlocks(env, blocks) {
  const rctx = await loadRenderCtx(env.DB, blocks, (k) => mediaUrl(env, k));
  return { html: renderBlocks(blocks, rctx), rctx };
}
async function routeContent(req, env, path, ctx) {
  const m = req.method;
  {
    if (path.startsWith("/api/files/") && (m === "GET" || m === "HEAD")) return serveFile(req, env, path);
    if (path === "/api/content/articles" && m === "GET") return publicListArticles(req, env, ctx);
    let r = path.match(/^\/api\/content\/articles\/(about|library)\/([^/]+)$/);
    if (r && m === "GET") return publicGetArticle(req, env, ctx, r[1], dec(r[2]));
    if (path === "/api/content/places" && m === "GET") return publicListPlaces(req, env, ctx);
    if (path === "/api/content/map-points" && m === "GET") return publicListPoints(env);
    if (path === "/api/content/search" && m === "GET") return publicSearch(req, env);
    if (path === "/api/content/find" && m === "GET") return publicFind(req, env);
    if (path === "/api/content/backlinks" && m === "GET") return publicBacklinks(req, env);
    if (path === "/api/content/card" && m === "GET") return publicCard(req, env, ctx);
    if (path === "/api/content/imageblocks" && m === "GET") return publicImageBlocks(req, env);
    if (path === "/api/content/home-tiles" && m === "GET") return listHomeTiles(env, false);
    if (path === "/api/content/home-hero" && m === "GET") return getHomeHero(env);
    r = path.match(/^\/api\/content\/places\/([^/]+)$/);
    if (r && m === "GET") return publicGetPlace(req, env, ctx, dec(r[1]));
    if (
      // 사진 창고(/api/admin/media, /api/admin/media/:id)만 — /api/admin/media-videos(법종교 미디어)는 media.ts 가 받는다
      !(path === "/api/admin/media" || path.startsWith("/api/admin/media/")) && !path.startsWith("/api/admin/content") && !path.startsWith("/api/admin/revisions") && !path.startsWith("/api/admin/points") && !path.startsWith("/api/admin/tags") && !path.startsWith("/api/admin/home-tiles") && path !== "/api/admin/home-hero"
    ) {
      return null;
    }
    const admin = await ctx.adminUser(req);
    if (!admin) return json({ error: "운영자만 사용할 수 있습니다" }, 403);
    if (path === "/api/admin/tags" && m === "GET") return adminListTags(env);
    if (path === "/api/admin/tags" && m === "POST") return adminSaveTag(req, env, null, admin.id);
    if (path === "/api/admin/tags/order" && m === "PUT") return adminOrderTags(req, env);
    r = path.match(/^\/api\/admin\/tags\/([^/]+)$/);
    if (r && m === "GET") return adminGetTag(env, dec(r[1]));
    if (r && m === "PUT") return adminSaveTag(req, env, dec(r[1]), admin.id);
    if (r && m === "DELETE") return adminDeleteTag(env, dec(r[1]));
    if (path === "/api/admin/home-tiles" && m === "GET") return listHomeTiles(env, true);
    if (path === "/api/admin/home-tiles" && m === "POST") return adminSaveHomeTile(req, env, null, admin.id);
    if (path === "/api/admin/home-tiles/order" && m === "PUT") return adminOrderHomeTiles(req, env);
    r = path.match(/^\/api\/admin\/home-tiles\/([^/]+)$/);
    if (r && m === "PUT") return adminSaveHomeTile(req, env, dec(r[1]), admin.id);
    if (r && m === "DELETE") return adminDeleteHomeTile(env, dec(r[1]));
    if (path === "/api/admin/home-hero" && m === "PUT") return adminSaveHomeHero(req, env, admin.id);
    if (path === "/api/admin/points" && m === "GET") return adminListPoints(env);
    if (path === "/api/admin/points" && m === "POST") return adminSavePoint(req, env, ctx, null, admin.id);
    r = path.match(/^\/api\/admin\/points\/([^/]+)$/);
    if (r && m === "GET") return adminGetPoint(env, dec(r[1]));
    if (r && m === "PUT") return adminSavePoint(req, env, ctx, dec(r[1]), admin.id);
    if (r && m === "DELETE") return adminDeletePoint(env, dec(r[1]), admin.id);
    if (path === "/api/admin/media" && m === "GET") return adminListMedia(req, env);
    if (path === "/api/admin/media" && m === "POST") return adminUploadMedia(req, env, admin.id);
    r = path.match(/^\/api\/admin\/media\/([^/]+)$/);
    if (r && m === "PATCH") return adminUpdateMedia(req, env, r[1]);
    if (r && m === "DELETE") return adminDeleteMedia(env, r[1]);
    r = path.match(/^\/api\/admin\/revisions\/(\d+)$/);
    if (r && m === "GET") return adminGetRevision(env, Number(r[1]));
    r = path.match(/^\/api\/admin\/content\/articles\/([^/]+)\/chapters\/order$/);
    if (r && m === "PUT") return adminOrderChapters(req, env, r[1]);
    r = path.match(/^\/api\/admin\/content\/(articles|places)(?:\/([^/]+))?(?:\/(revisions))?$/);
    if (r) {
      const type = TYPE_MAP[r[1]];
      const id = r[2];
      if (!id && m === "GET") return adminList(req, env, type);
      if (!id && m === "POST") return adminSave(req, env, ctx, type, null, admin.id);
      if (id && r[3] === "revisions" && m === "GET") return adminListRevisions(env, type, id);
      if (id && !r[3] && m === "GET") return adminGet(env, type, id);
      if (id && !r[3] && m === "PUT") return adminSave(req, env, ctx, type, id, admin.id);
      if (id && !r[3] && m === "DELETE") return adminDelete(env, type, id, admin.id);
    }
    return json({ error: "not found" }, 404);
  }
}
function dec(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
async function serveFile(req, env, path) {
  const key = path.slice("/api/files/".length);
  if (!MEDIA_KEY_RE.test(key) && !MEMBER_KEY_RE.test(key)) return new Response("not found", { status: 404 });
  const etagIn = req.headers.get("If-None-Match");
  const obj = await env.UPLOADS.get(key);
  if (!obj) return new Response("not found", { status: 404 });
  const headers = new Headers();
  headers.set("Content-Type", obj.httpMetadata?.contentType ?? "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("ETag", obj.httpEtag);
  if (etagIn && etagIn === obj.httpEtag) return new Response(null, { status: 304, headers });
  return new Response(req.method === "HEAD" ? null : obj.body, { headers });
}
const MEDIA_COLS = "id, r2_key, content_type, width, height, size_bytes, alt, caption, credit, taken_at, source_url, created_at";
function shapeMedia(env, r) {
  return {
    id: r.id,
    url: mediaUrl(env, r.r2_key),
    width: r.width,
    height: r.height,
    content_type: r.content_type,
    size_bytes: r.size_bytes,
    alt: r.alt,
    caption: r.caption,
    credit: r.credit,
    taken_at: r.taken_at,
    source_url: r.source_url,
    created_at: r.created_at
  };
}
async function loadMediaMap(env, ids, activeOnly) {
  const out = new Map();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return out;
  const ph = uniq.map(() => "?").join(",");
  const rs = await env.DB.prepare(
    `SELECT ${MEDIA_COLS} FROM media WHERE id IN (${ph})${activeOnly ? " AND status='active'" : ""}`
  ).bind(...uniq).all();
  for (const r of rs.results ?? []) out.set(r.id, shapeMedia(env, r));
  return out;
}
async function loadGallery(env, type, id, activeOnly) {
  const rs = await env.DB.prepare(
    `SELECT m.id, m.r2_key, m.content_type, m.width, m.height, m.size_bytes, m.alt,
            COALESCE(l.caption, m.caption) AS caption, m.credit, m.taken_at, m.source_url, m.created_at,
            l.caption AS link_caption
       FROM media_links l JOIN media m ON m.id = l.media_id
      WHERE l.owner_type=? AND l.owner_id=? AND l.role='gallery'${activeOnly ? " AND m.status='active'" : ""}
      ORDER BY l.sort_order, m.created_at`
  ).bind(type, id).all();
  return (rs.results ?? []).map((r) => ({ ...shapeMedia(env, r), link_caption: r.link_caption }));
}
function parseMeta(s) {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
const imgIds = (r) => [r.hero_media_id ?? "", r.thumb_media_id ?? ""];
const pick = (m, id) => id ? m.get(id) ?? null : null;
function parseCrop(v) {
  let o = v;
  if (typeof v === "string") {
    try {
      o = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== "object") return null;
  const n = (a, lo, hi) => typeof a === "number" && Number.isFinite(a) ? Math.min(hi, Math.max(lo, a)) : null;
  const x = n(o.x, 0, 100), y = n(o.y, 0, 100), z = n(o.z, 1, 2.5);
  if (x === null || y === null || z === null) return null;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, z: Math.round(z * 100) / 100 };
}
const cropJson = (v) => {
  const c = parseCrop(v);
  return c && (c.x !== 50 || c.y !== 50 || c.z !== 1) ? JSON.stringify(c) : null;
};
const pickThumb = (m, r) => {
  const t = pick(m, r.thumb_media_id);
  return t ? { ...t, crop: parseCrop(r.thumb_crop) } : null;
};
function shapeArticle(r, media) {
  return {
    id: r.id,
    section: r.section,
    kind: r.kind,
    slug: r.slug,
    title: r.title,
    title_hanja: r.title_hanja,
    summary: r.summary,
    hero: pick(media, r.hero_media_id),
    // 상세 헤더 배경
    thumb: pickThumb(media, r),
    // 목록·카드 썸네일
    meta: parseMeta(r.meta),
    sort_order: r.sort_order,
    pinned: !!r.pinned,
    featured: !!r.featured,
    status: r.status,
    published_at: r.published_at,
    updated_at: r.updated_at,
    parent_id: r.parent_id ?? null,
    ...r.chapter_count !== void 0 ? { chapter_count: r.chapter_count } : {}
  };
}
async function viewerVis(req, ctx) {
  if (await ctx.adminUser(req) === null) return "public";
  return new URL(req.url).searchParams.get("preview") === "1" ? "preview" : "admin";
}
const visSql = (v, col = "status") => v === "preview" ? "1=1" : v === "admin" ? `${col} IN ('published','draft')` : `${col}='published'`;
async function loadChapters(env, bookId, vis) {
  const rs = await env.DB.prepare(
    `SELECT id, slug, title, title_hanja, status, sort_order FROM articles WHERE parent_id=?${vis ? ` AND ${visSql(vis)}` : ""}
      ORDER BY sort_order, title`
  ).bind(bookId).all();
  return rs.results ?? [];
}
async function publicListArticles(req, env, ctx) {
  const url = new URL(req.url);
  const section = url.searchParams.get("section") ?? "";
  const kind = url.searchParams.get("kind");
  if (!ARTICLE_KINDS[section]) return json({ error: "invalid section" }, 400);
  if (kind && !await validArticleKind(env, section, kind)) return json({ error: "invalid kind" }, 400);
  const vis = await viewerVis(req, ctx);
  const rs = await env.DB.prepare(
    `SELECT a.*, (SELECT COUNT(*) FROM articles c WHERE c.parent_id=a.id AND ${visSql(vis, "c.status")}) AS chapter_count
       FROM articles a WHERE a.section=? AND ${visSql(vis, "a.status")} AND a.parent_id IS NULL${kind ? " AND a.kind=?" : ""}
      ORDER BY a.sort_order, a.title`
  ).bind(...kind ? [section, kind] : [section]).all();
  const rows = rs.results ?? [];
  const media = await loadMediaMap(env, rows.flatMap(imgIds), true);
  return json({
    articles: rows.map((r) => shapeArticle(r, media))
  });
}
async function publicGetArticle(req, env, ctx, section, slug) {
  const vis = await viewerVis(req, ctx);
  const r = await env.DB.prepare(`SELECT * FROM articles WHERE section=? AND slug=? AND ${visSql(vis)}`).bind(section, slug).first();
  if (!r) return json({ error: "not found" }, 404);
  let book = null;
  if (r.parent_id) {
    book = await env.DB.prepare(
      `SELECT id, slug, kind, title, title_hanja FROM articles WHERE id=? AND ${visSql(vis)}`
    ).bind(r.parent_id).first();
    if (!book) return json({ error: "not found" }, 404);
  }
  const chapters = await loadChapters(env, book?.id ?? r.id, vis);
  const media = await loadMediaMap(env, imgIds(r), true);
  const gallery = await loadGallery(env, "article", r.id, true);
  const { html } = await renderRowBlocks(env, blocksOfRow(r));
  return json({
    article: {
      ...shapeArticle(r, media),
      body_html: html,
      gallery,
      book,
      chapters
    }
  });
}
function shapePlace(r, media, admin = false) {
  const showLoc = admin || !r.location_hidden;
  return {
    id: r.id,
    slug: r.slug,
    kind: r.kind,
    name: r.name,
    name_hanja: r.name_hanja,
    summary: r.summary,
    built: r.built,
    lat: showLoc ? r.lat : null,
    lng: showLoc ? r.lng : null,
    location_hidden: r.location_hidden,
    geojson: showLoc && r.geojson ? safeJson(r.geojson) : null,
    branch_code: r.branch_code,
    hero: pick(media, r.hero_media_id),
    thumb: pickThumb(media, r),
    sort_order: r.sort_order,
    status: r.status,
    updated_at: r.updated_at
  };
}
function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
async function withPointCoords(env, rows, anyStatus = false) {
  if (!rows.length) return rows;
  const ph = rows.map(() => "?").join(",");
  const rs = await env.DB.prepare(
    `SELECT place_id, lat, lng FROM map_points WHERE place_id IN (${ph})${anyStatus ? "" : " AND status='published'"}`
  ).bind(...rows.map((r) => r.id)).all();
  const byPlace = new Map((rs.results ?? []).map((p) => [p.place_id, p]));
  return rows.map((r) => {
    const p = byPlace.get(r.id);
    return { ...r, lat: p?.lat ?? null, lng: p?.lng ?? null, location_hidden: 0 };
  });
}
async function publicListPlaces(req, env, ctx) {
  const kind = new URL(req.url).searchParams.get("kind");
  if (kind && !PLACE_KINDS.includes(kind)) return json({ error: "invalid kind" }, 400);
  const vis = await viewerVis(req, ctx);
  const rs = await env.DB.prepare(
    `SELECT * FROM places WHERE ${visSql(vis)}${kind ? " AND kind=?" : ""} ORDER BY sort_order, name`
  ).bind(...kind ? [kind] : []).all();
  const rows = await withPointCoords(env, rs.results ?? []);
  const media = await loadMediaMap(env, rows.flatMap(imgIds), true);
  return json({ places: rows.map((r) => shapePlace(r, media)) });
}
async function publicGetPlace(req, env, ctx, slug) {
  const vis = await viewerVis(req, ctx);
  const found = await env.DB.prepare(`SELECT * FROM places WHERE slug=? AND ${visSql(vis)}`).bind(slug).first();
  if (!found) return json({ error: "not found" }, 404);
  const [r] = await withPointCoords(env, [found], vis === "preview");
  const media = await loadMediaMap(env, imgIds(r), true);
  const gallery = await loadGallery(env, "place", r.id, true);
  const { html } = await renderRowBlocks(env, blocksOfRow(r));
  return json({
    place: {
      ...shapePlace(r, media),
      body_html: html,
      gallery
    }
  });
}
const POINT_SELECT = `SELECT mp.*, p.slug AS p_slug, p.kind AS p_kind, p.name AS p_name, p.status AS p_status
  FROM map_points mp LEFT JOIN places p ON p.id = mp.place_id`;
function shapePoint(r, admin = false, tags = []) {
  const linked = r.place_id && r.p_slug && (admin || r.p_status === "published");
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    name_hanja: r.name_hanja,
    summary: r.summary,
    lat: r.lat,
    lng: r.lng,
    branch_code: r.branch_code,
    place: linked ? {
      id: r.place_id,
      slug: r.p_slug,
      kind: r.p_kind,
      name: r.p_name,
      status: r.p_status,
      href: refHref("place", { kind: r.p_kind, slug: r.p_slug })
    } : null,
    /** 붙은 태그 id(공개 = 지도 표시 태그만, 지도 버튼 순서 / 운영자 = 전부) */
    tags,
    sort_order: r.sort_order,
    status: r.status,
    updated_at: r.updated_at
  };
}
async function publicListPoints(env) {
  const rs = await env.DB.prepare(
    `${POINT_SELECT}
      WHERE mp.status='published' AND (
        EXISTS (SELECT 1 FROM tag_links tl JOIN tags t ON t.id=tl.tag_id
                 WHERE tl.owner_type='point' AND tl.owner_id=mp.id AND t.on_map=1 AND t.status='active')
        OR EXISTS (SELECT 1 FROM content_refs cr
                     LEFT JOIN articles a ON cr.from_type='article' AND a.id=cr.from_id
                     LEFT JOIN places pl ON cr.from_type='place' AND pl.id=cr.from_id
                     LEFT JOIN posts po ON cr.from_type='post' AND po.id=cr.from_id
                    WHERE cr.to_type='point' AND cr.to_id=mp.id
                      AND (a.status='published' OR pl.status='published' OR po.status='published'))
        OR p.status='published'
      )
      ORDER BY mp.sort_order, mp.name`
  ).all();
  const rows = rs.results ?? [];
  const styles = await pointStyles(env.DB, rows.map((r) => r.id));
  const points = rows.map((r) => {
    const st = styles.get(r.id);
    return { ...shapePoint(r, false, st?.tags ?? []), color: st?.color ?? DOC_MARKER.color, icon: st?.icon ?? DOC_MARKER.icon };
  });
  const shown = new Set(points.map((p) => p.id));
  const tr = await env.DB.prepare(
    `SELECT t.id, t.slug, t.name, t.color, t.icon, t.description, tl.owner_id AS pid
       FROM tags t JOIN tag_links tl ON tl.tag_id=t.id AND tl.owner_type='point'
       JOIN map_points mp ON mp.id=tl.owner_id
      WHERE t.on_map=1 AND t.status='active'
      ORDER BY t.sort_order, t.name, tl.sort_order, mp.name`
  ).all();
  const tags = [];
  for (const r of tr.results ?? []) {
    if (!shown.has(r.pid)) continue;
    let t = tags.find((x) => x.id === r.id);
    if (!t) tags.push(t = { id: r.id, slug: r.slug, name: r.name, color: r.color, icon: r.icon, description: r.description, members: [] });
    t.members.push(r.pid);
  }
  return json({ points, tags });
}
async function tagsOf(env, type, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rs = await env.DB.prepare(
    `SELECT tl.owner_id, tl.tag_id FROM tag_links tl JOIN tags t ON t.id=tl.tag_id
      WHERE tl.owner_type=? AND tl.owner_id IN (${ids.map(() => "?").join(",")}) ORDER BY t.sort_order, t.name`
  ).bind(type, ...ids).all();
  for (const r of rs.results ?? []) out.set(r.owner_id, [...out.get(r.owner_id) ?? [], r.tag_id]);
  return out;
}
async function tagLinkStmts(env, type, ownerId, tags) {
  if (tags === void 0) return [];
  if (!Array.isArray(tags) || tags.length > 50 || tags.some((t) => typeof t !== "string")) throw new InputError("태그 형식이 잘못되었습니다");
  const want = [...new Set(tags)];
  if (want.length) {
    const rs = await env.DB.prepare(`SELECT id FROM tags WHERE id IN (${want.map(() => "?").join(",")})`).bind(...want).all();
    if ((rs.results ?? []).length !== want.length) throw new InputError("없는 태그가 있습니다. 새로고침한 뒤 다시 골라 주세요");
  }
  const cur = await env.DB.prepare("SELECT tag_id FROM tag_links WHERE owner_type=? AND owner_id=?").bind(type, ownerId).all();
  const have = new Set((cur.results ?? []).map((r) => r.tag_id));
  const out = [];
  for (const t of have) {
    if (!want.includes(t)) out.push(env.DB.prepare("DELETE FROM tag_links WHERE tag_id=? AND owner_type=? AND owner_id=?").bind(t, type, ownerId));
  }
  for (const t of want) {
    if (have.has(t)) continue;
    out.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO tag_links (tag_id, owner_type, owner_id, sort_order)
         VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tag_links WHERE tag_id=?1 AND owner_type=?2))`
      ).bind(t, type, ownerId)
    );
  }
  return out;
}
async function adminListPoints(env) {
  const rs = await env.DB.prepare(`${POINT_SELECT} ORDER BY mp.kind, mp.sort_order, mp.name`).all();
  const rows = rs.results ?? [];
  const tags = await tagsOf(env, "point", rows.map((r) => r.id));
  const uses = await env.DB.prepare("SELECT to_id, COUNT(DISTINCT from_type || ':' || from_id) AS n FROM content_refs WHERE to_type='point' GROUP BY to_id").all();
  const useMap = new Map((uses.results ?? []).map((u) => [u.to_id, u.n]));
  const styles = await pointStyles(env.DB, rows.map((r) => r.id));
  return json({
    items: rows.map((r) => {
      const st = styles.get(r.id);
      return {
        ...shapePoint(r, true, tags.get(r.id) ?? []),
        uses: useMap.get(r.id) ?? 0,
        color: st?.color ?? DOC_MARKER.color,
        icon: st?.icon ?? DOC_MARKER.icon
      };
    })
  });
}
async function loadPoint(env, id) {
  const r = await env.DB.prepare(`${POINT_SELECT} WHERE mp.id=?`).bind(id).first();
  if (!r) return null;
  const tags = (await tagsOf(env, "point", [id])).get(id) ?? [];
  return { ...shapePoint(r, true, tags), place_id: r.place_id, created_at: r.created_at };
}
async function adminGetPoint(env, id) {
  const item = await loadPoint(env, id);
  if (!item) return json({ error: "not found" }, 404);
  return json({ item });
}
async function adminSavePoint(req, env, ctx, id, uid) {
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") return json({ error: "잘못된 요청입니다" }, 400);
  if (!MAP_POINT_KINDS.includes(raw.kind)) throw new InputError("분류 값이 잘못되었습니다");
  const name = str(raw.name, TITLE_MAX);
  if (!name) throw new InputError("이름을 입력해 주세요");
  const lat = num(raw.lat, -90, 90, "위도");
  const lng = num(raw.lng, -180, 180, "경도");
  if (lat === null || lng === null) throw new InputError("지도에서 위치를 정해 주세요");
  const status = typeof raw.status === "string" && STATUSES.has(raw.status) ? raw.status : "draft";
  const sortOrder = Number.isFinite(Number(raw.sort_order)) ? Math.trunc(Number(raw.sort_order)) : 0;
  const branch = raw.kind === "branch" ? str(raw.branch_code, 40) : null;
  if (branch && !ctx.branchCodes.has(branch)) throw new InputError("지부 코드가 잘못되었습니다");
  const placeId = str(raw.place_id, 64);
  if (placeId) {
    const p = await env.DB.prepare("SELECT id FROM places WHERE id=?").bind(placeId).first();
    if (!p) throw new InputError("연결할 자료를 찾을 수 없습니다");
    const taken = await env.DB.prepare("SELECT name FROM map_points WHERE place_id=? AND id<>?").bind(placeId, id ?? "").first();
    if (taken) return json({ error: `이 자료는 이미 지도 장소 "${taken.name}"에 연결되어 있습니다` }, 409);
  }
  const existing = id ? await loadPoint(env, id) : null;
  if (id && !existing) return json({ error: "not found" }, 404);
  const itemId = id ?? crypto.randomUUID();
  const tagStmts = await tagLinkStmts(env, "point", itemId, raw.tags);
  const vals = [raw.kind, name, str(raw.name_hanja, 100), str(raw.summary, SUMMARY_MAX), lat, lng, placeId, branch, sortOrder, status, uid];
  const stmts = [];
  if (existing) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO content_revisions (owner_type, owner_id, action, snapshot, edited_by) VALUES ('point', ?, 'update', ?, ?)"
      ).bind(itemId, JSON.stringify(existing), uid),
      env.DB.prepare(
        `UPDATE map_points SET kind=?, name=?, name_hanja=?, summary=?, lat=?, lng=?, place_id=?, branch_code=?, sort_order=?, status=?,
           updated_by=?, updated_at=datetime('now') WHERE id=?`
      ).bind(...vals, itemId)
    );
  } else {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO map_points (kind, name, name_hanja, summary, lat, lng, place_id, branch_code, sort_order, status, updated_by, created_by, id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(...vals, uid, itemId)
    );
  }
  stmts.push(...tagStmts);
  await env.DB.batch(stmts);
  return json({ item: await loadPoint(env, itemId) }, existing ? 200 : 201);
}
async function adminDeletePoint(env, id, uid) {
  const existing = await loadPoint(env, id);
  if (!existing) return json({ error: "not found" }, 404);
  const users = await usersOfPoint(env, id);
  if (users.length) return json({ error: "이 장소를 지도 블록으로 쓰는 글이 있어 삭제할 수 없습니다", usage: users }, 409);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO content_revisions (owner_type, owner_id, action, snapshot, edited_by) VALUES ('point', ?, 'delete', ?, ?)"
    ).bind(id, JSON.stringify(existing), uid),
    env.DB.prepare("DELETE FROM tag_links WHERE owner_type='point' AND owner_id=?").bind(id),
    env.DB.prepare("DELETE FROM map_points WHERE id=?").bind(id)
  ]);
  return json({ ok: true });
}
async function usersOfPoint(env, id) {
  const rs = await env.DB.prepare(
    `SELECT DISTINCT cr.from_type AS type, cr.from_id AS id,
            COALESCE(a.title, pl.name, po.title) AS title
       FROM content_refs cr
       LEFT JOIN articles a ON cr.from_type='article' AND a.id=cr.from_id
       LEFT JOIN places pl ON cr.from_type='place' AND pl.id=cr.from_id
       LEFT JOIN posts po ON cr.from_type='post' AND po.id=cr.from_id AND po.status<>'deleted'
      WHERE cr.to_type='point' AND cr.to_id=?`
  ).bind(id).all();
  return (rs.results ?? []).filter((r) => r.title !== null);
}
const TAG_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const TAG_ICON_KEYS = new Set(["temple", "building", "home", "star", "mountain", "flag", "pin"]);
function shapeTag(r) {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    color: r.color,
    icon: r.icon,
    description: r.description,
    on_map: !!r.on_map,
    sort_order: r.sort_order,
    status: r.status,
    updated_at: r.updated_at
  };
}
async function adminListTags(env) {
  const rs = await env.DB.prepare(
    `SELECT t.*,
            (SELECT COUNT(*) FROM tag_links l WHERE l.tag_id=t.id AND l.owner_type='point') AS n_point,
            (SELECT COUNT(*) FROM tag_links l WHERE l.tag_id=t.id AND l.owner_type<>'point') AS n_content
       FROM tags t ORDER BY t.sort_order, t.name`
  ).all();
  return json({ items: (rs.results ?? []).map((r) => ({ ...shapeTag(r), counts: { point: r.n_point, content: r.n_content } })) });
}
async function loadTag(env, id) {
  const r = await env.DB.prepare("SELECT * FROM tags WHERE id=?").bind(id).first();
  if (!r) return null;
  const pts = await env.DB.prepare(
    `SELECT mp.id, mp.name, mp.name_hanja, mp.kind, mp.status FROM tag_links l JOIN map_points mp ON mp.id=l.owner_id
      WHERE l.tag_id=? AND l.owner_type='point' ORDER BY l.sort_order, mp.name`
  ).bind(id).all();
  const cs = await env.DB.prepare(
    `SELECT l.owner_type AS type, l.owner_id AS id, COALESCE(a.title, p.name) AS title, COALESCE(a.status, p.status) AS status,
            a.section AS section
       FROM tag_links l
       LEFT JOIN articles a ON l.owner_type='article' AND a.id=l.owner_id
       LEFT JOIN places p ON l.owner_type='place' AND p.id=l.owner_id
      WHERE l.tag_id=? AND l.owner_type IN ('article','place') ORDER BY title`
  ).bind(id).all();
  return {
    ...shapeTag(r),
    points: pts.results ?? [],
    contents: (cs.results ?? []).filter((c) => c.title !== null)
  };
}
async function adminGetTag(env, id) {
  const item = await loadTag(env, id);
  if (!item) return json({ error: "not found" }, 404);
  return json({ item });
}
async function adminSaveTag(req, env, id, uid) {
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") return json({ error: "잘못된 요청입니다" }, 400);
  const name = str(raw.name, 40);
  if (!name) throw new InputError("태그 이름을 입력해 주세요");
  const slug = str(raw.slug, 80) ?? name.replace(/\s+/g, "-");
  if (!SLUG_RE.test(slug)) throw new InputError("주소(slug)는 영문·숫자·한글·-·_ 로 80자 이내여야 합니다");
  if (raw.color !== void 0 && !(typeof raw.color === "string" && TAG_COLOR_RE.test(raw.color))) {
    throw new InputError("태그 색은 #RRGGBB 형식이어야 합니다");
  }
  if (raw.icon !== void 0 && !(typeof raw.icon === "string" && TAG_ICON_KEYS.has(raw.icon))) {
    throw new InputError("고를 수 없는 아이콘입니다");
  }
  const color = raw.color ?? "#7A8592";
  const icon = raw.icon ?? "pin";
  const status = raw.status === "hidden" ? "hidden" : "active";
  const onMap = raw.on_map ? 1 : 0;
  const itemId = id ?? `tag-${crypto.randomUUID().slice(0, 8)}`;
  if (id && !await env.DB.prepare("SELECT id FROM tags WHERE id=?").bind(id).first()) return json({ error: "not found" }, 404);
  const dupName = await env.DB.prepare("SELECT id FROM tags WHERE (name=? OR slug=?) AND id<>?").bind(name, slug, itemId).first();
  if (dupName) return json({ error: "같은 이름이나 주소의 태그가 이미 있습니다" }, 409);
  const desc = str(raw.description, 300);
  const stmts = [];
  if (id) {
    stmts.push(
      env.DB.prepare(
        `UPDATE tags SET slug=?, name=?, color=?, icon=?, description=?, on_map=?, status=?, updated_by=?, updated_at=datetime('now') WHERE id=?`
      ).bind(slug, name, color, icon, desc, onMap, status, uid, itemId)
    );
  } else {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO tags (id, slug, name, color, icon, description, on_map, status, sort_order, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tags), ?, ?)`
      ).bind(itemId, slug, name, color, icon, desc, onMap, status, uid, uid)
    );
  }
  if (raw.points !== void 0) {
    if (!Array.isArray(raw.points) || raw.points.length > 500 || raw.points.some((x) => typeof x !== "string")) {
      throw new InputError("장소 목록 형식이 잘못되었습니다");
    }
    const ids = [...new Set(raw.points)];
    if (ids.length) {
      const rs = await env.DB.prepare(`SELECT id FROM map_points WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
      if ((rs.results ?? []).length !== ids.length) throw new InputError("없는 지도 장소가 있습니다. 새로고침한 뒤 다시 해 주세요");
    }
    stmts.push(env.DB.prepare("DELETE FROM tag_links WHERE tag_id=? AND owner_type='point'").bind(itemId));
    ids.forEach((pid, i) => {
      stmts.push(env.DB.prepare("INSERT INTO tag_links (tag_id, owner_type, owner_id, sort_order) VALUES (?, 'point', ?, ?)").bind(itemId, pid, i));
    });
  }
  await env.DB.batch(stmts);
  return json({ item: await loadTag(env, itemId) }, id ? 200 : 201);
}
async function adminOrderTags(req, env) {
  const raw = await req.json().catch(() => null);
  const ids = raw?.ids;
  if (!Array.isArray(ids) || ids.length > 500 || ids.some((x) => typeof x !== "string")) {
    return json({ error: "잘못된 요청입니다" }, 400);
  }
  const all = await env.DB.prepare("SELECT id FROM tags").all();
  const have = new Set((all.results ?? []).map((r) => r.id));
  if (new Set(ids).size !== ids.length || ids.length !== have.size || ids.some((x) => !have.has(x))) {
    return json({ error: "태그 목록이 바뀌었습니다. 새로고침한 뒤 다시 해 주세요" }, 409);
  }
  await env.DB.batch(ids.map((tid, i) => env.DB.prepare("UPDATE tags SET sort_order=? WHERE id=?").bind(i, tid)));
  return json({ ok: true });
}
async function adminDeleteTag(env, id) {
  const r = await env.DB.prepare("SELECT id FROM tags WHERE id=?").bind(id).first();
  if (!r) return json({ error: "not found" }, 404);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tag_links WHERE tag_id=?").bind(id),
    env.DB.prepare("DELETE FROM tags WHERE id=?").bind(id)
  ]);
  return json({ ok: true });
}
const COUNT_SOURCE_RE = /^(places:[a-z]{1,20}|articles:(about|library):[a-z]{1,20}|tag:[A-Za-z0-9가-힣_-]{1,80})$/;
async function countOf(env, src) {
  if (!src || !COUNT_SOURCE_RE.test(src)) return null;
  const [kind, a, b] = src.split(":");
  if (kind === "places") {
    const r2 = await env.DB.prepare("SELECT COUNT(*) AS n FROM places WHERE status='published' AND kind=?").bind(a).first();
    return r2?.n ?? 0;
  }
  if (kind === "articles") {
    const r2 = await env.DB.prepare("SELECT COUNT(*) AS n FROM articles WHERE status='published' AND section=? AND kind=? AND parent_id IS NULL").bind(a, b).first();
    return r2?.n ?? 0;
  }
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM tag_links tl JOIN tags t ON t.id=tl.tag_id JOIN map_points mp ON mp.id=tl.owner_id
      WHERE tl.owner_type='point' AND t.slug=? AND mp.status='published'`
  ).bind(a).first();
  return r?.n ?? 0;
}
async function listHomeTiles(env, admin) {
  const rs = await env.DB.prepare(
    `SELECT * FROM home_tiles${admin ? "" : " WHERE status='active'"} ORDER BY sort_order, created_at`
  ).all();
  const rows = rs.results ?? [];
  const media = await loadMediaMap(env, rows.map((r) => r.media_id ?? ""), true);
  const items = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      href: r.href,
      media_id: r.media_id,
      image: r.media_id ? media.get(r.media_id) ?? null : null,
      glyph: r.glyph,
      count_source: r.count_source,
      count_unit: r.count_unit,
      count: await countOf(env, r.count_source),
      sort_order: r.sort_order,
      status: r.status,
      updated_at: r.updated_at
    }))
  );
  return json({ items });
}
async function adminSaveHomeTile(req, env, id, uid) {
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") return json({ error: "잘못된 요청입니다" }, 400);
  const title = str(raw.title, 40);
  if (!title) throw new InputError("이름을 입력해 주세요");
  const href = str(raw.href, 300);
  if (!href || !(/^\/(?!\/)/.test(href) || /^https?:\/\//i.test(href))) throw new InputError("연결 주소는 /로 시작하는 사이트 주소나 http(s) 주소여야 합니다");
  const countSource = str(raw.count_source, 120);
  if (countSource && !COUNT_SOURCE_RE.test(countSource)) throw new InputError("개수 출처 형식이 잘못되었습니다");
  const mediaId = str(raw.media_id, 64);
  if (mediaId) await checkMediaIds(env, [mediaId]);
  const status = raw.status === "hidden" ? "hidden" : "active";
  const vals = [title, str(raw.subtitle, 120), href, mediaId, str(raw.glyph, 8), countSource, str(raw.count_unit, 8), status, uid];
  if (id) {
    const res = await env.DB.prepare(
      `UPDATE home_tiles SET title=?, subtitle=?, href=?, media_id=?, glyph=?, count_source=?, count_unit=?, status=?, updated_by=?,
         updated_at=datetime('now') WHERE id=?`
    ).bind(...vals, id).run();
    if (!res.meta.changes) return json({ error: "not found" }, 404);
  } else {
    id = `ht-${crypto.randomUUID().slice(0, 8)}`;
    await env.DB.prepare(
      `INSERT INTO home_tiles (title, subtitle, href, media_id, glyph, count_source, count_unit, status, updated_by, id, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM home_tiles))`
    ).bind(...vals, id).run();
  }
  return json({ ok: true, id }, raw.id ? 200 : 201);
}
async function adminOrderHomeTiles(req, env) {
  const ids = (await req.json().catch(() => null))?.ids;
  if (!Array.isArray(ids) || ids.length > 100 || ids.some((x) => typeof x !== "string")) return json({ error: "잘못된 요청입니다" }, 400);
  const all = await env.DB.prepare("SELECT id FROM home_tiles").all();
  const have = new Set((all.results ?? []).map((r) => r.id));
  if (new Set(ids).size !== ids.length || ids.length !== have.size || ids.some((x) => !have.has(x))) {
    return json({ error: "목록이 바뀌었습니다. 새로고침한 뒤 다시 해 주세요" }, 409);
  }
  await env.DB.batch(ids.map((x, i) => env.DB.prepare("UPDATE home_tiles SET sort_order=? WHERE id=?").bind(i, x)));
  return json({ ok: true });
}
async function adminDeleteHomeTile(env, id) {
  const res = await env.DB.prepare("DELETE FROM home_tiles WHERE id=?").bind(id).run();
  if (!res.meta.changes) return json({ error: "not found" }, 404);
  return json({ ok: true });
}
async function getHomeHero(env) {
  const row = await env.DB.prepare("SELECT media_id FROM home_hero WHERE slot='mobile'").first();
  const media = row ? await loadMediaMap(env, [row.media_id], true) : null;
  return json({ mobile: row ? media?.get(row.media_id) ?? null : null });
}
async function adminSaveHomeHero(req, env, uid) {
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object" || !("mobile_media_id" in raw)) return json({ error: "잘못된 요청입니다" }, 400);
  const mediaId = str(raw.mobile_media_id, 64);
  if (!mediaId) {
    await env.DB.prepare("DELETE FROM home_hero WHERE slot='mobile'").run();
  } else {
    await checkMediaIds(env, [mediaId]);
    await env.DB.prepare(
      `INSERT INTO home_hero (slot, media_id, updated_by) VALUES ('mobile', ?, ?)
       ON CONFLICT(slot) DO UPDATE SET media_id=excluded.media_id, updated_by=excluded.updated_by, updated_at=datetime('now')`
    ).bind(mediaId, uid).run();
  }
  return getHomeHero(env);
}
async function adminList(req, env, type) {
  const url = new URL(req.url);
  if (type === "article") {
    const section = url.searchParams.get("section") ?? "";
    if (!ARTICLE_KINDS[section]) return json({ error: "invalid section" }, 400);
    const rs2 = await env.DB.prepare(
      "SELECT a.*, (SELECT COUNT(*) FROM articles c WHERE c.parent_id=a.id) AS chapter_count FROM articles a WHERE a.section=? ORDER BY a.sort_order, a.title"
    ).bind(section).all();
    const rows2 = rs2.results ?? [];
    const media2 = await loadMediaMap(env, rows2.flatMap(imgIds), false);
    return json({
      items: rows2.map((r) => shapeArticle(r, media2))
    });
  }
  const rs = await env.DB.prepare("SELECT * FROM places ORDER BY kind, sort_order, name").all();
  const rows = rs.results ?? [];
  const media = await loadMediaMap(env, rows.flatMap(imgIds), false);
  return json({
    items: rows.map((r) => shapePlace(r, media, true))
  });
}
async function loadFull(env, type, id) {
  if (type === "article") {
    const r2 = await env.DB.prepare("SELECT * FROM articles WHERE id=?").bind(id).first();
    if (!r2) return null;
    const media2 = await loadMediaMap(env, imgIds(r2), false);
    const blocks2 = blocksOfRow(r2);
    const { rctx: rctx2 } = await renderRowBlocks(env, blocks2);
    const book = r2.parent_id ? await env.DB.prepare("SELECT id, slug, kind, title, status FROM articles WHERE id=?").bind(r2.parent_id).first() : null;
    return {
      ...shapeArticle(r2, media2),
      blocks: blocksForEditor(blocks2, rctx2),
      hero_media_id: r2.hero_media_id,
      thumb_media_id: r2.thumb_media_id,
      created_at: r2.created_at,
      gallery: await loadGallery(env, "article", id, false),
      tags: (await tagsOf(env, "article", [id])).get(id) ?? [],
      book,
      chapters: r2.parent_id ? [] : await loadChapters(env, id, null)
    };
  }
  const r = await env.DB.prepare("SELECT * FROM places WHERE id=?").bind(id).first();
  if (!r) return null;
  const media = await loadMediaMap(env, imgIds(r), false);
  const blocks = blocksOfRow(r);
  const { rctx } = await renderRowBlocks(env, blocks);
  return {
    ...shapePlace(r, media, true),
    geojson: r.geojson,
    blocks: blocksForEditor(blocks, rctx),
    hero_media_id: r.hero_media_id,
    thumb_media_id: r.thumb_media_id,
    created_at: r.created_at,
    gallery: await loadGallery(env, "place", id, false),
    tags: (await tagsOf(env, "place", [id])).get(id) ?? []
  };
}
async function adminGet(env, type, id) {
  const item = await loadFull(env, type, id);
  if (!item) return json({ error: "not found" }, 404);
  return json({ item });
}
function normGallery(v) {
  if (v === void 0 || v === null) return [];
  if (!Array.isArray(v)) throw new InputError("사진 목록 형식이 잘못되었습니다");
  if (v.length > GALLERY_MAX) throw new InputError(`사진은 ${GALLERY_MAX}장까지 넣을 수 있습니다`);
  const seen = new Set();
  const out = [];
  for (const g of v) {
    if (!g || typeof g !== "object" || typeof g.media_id !== "string") {
      throw new InputError("사진 목록 형식이 잘못되었습니다");
    }
    const id = g.media_id;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ media_id: id, caption: str(g.caption, 500) });
  }
  return out;
}
function normCommon(raw) {
  const slug = str(raw.slug, 80);
  if (!slug || !SLUG_RE.test(slug)) {
    throw new InputError("주소(slug)는 영문·숫자·한글·-·_ 로 80자 이내여야 합니다");
  }
  const status = raw.status ?? "draft";
  if (!STATUSES.has(status)) throw new InputError("상태 값이 잘못되었습니다");
  const sortOrder = raw.sort_order === void 0 || raw.sort_order === null || raw.sort_order === "" ? 0 : Number(raw.sort_order);
  if (!Number.isInteger(sortOrder) || Math.abs(sortOrder) > 1e6) throw new InputError("순서는 정수여야 합니다");
  const blocks = normalizeBlocks(raw.blocks ?? [], { allowMedia: true, allowKey: true });
  if (JSON.stringify(blocks).length > BODY_MAX) throw new InputError("본문이 너무 깁니다");
  return {
    slug,
    status,
    sort_order: sortOrder,
    summary: str(raw.summary, SUMMARY_MAX),
    blocks,
    hero_media_id: str(raw.hero_media_id, 64),
    thumb_media_id: str(raw.thumb_media_id, 64),
    thumb_crop: cropJson(raw.thumb_media_id ? raw.thumb_crop : null),
    gallery: normGallery(raw.gallery)
  };
}
function normMeta(v) {
  if (v === void 0 || v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw new InputError("추가 정보 형식이 잘못되었습니다");
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (!/^[a-z_]{1,30}$/.test(k)) continue;
    if (typeof val === "string") {
      if (val.trim()) out[k] = val.trim().slice(0, 500);
    } else if (Array.isArray(val)) {
      const arr = val.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 100));
      if (arr.length) out[k] = arr.slice(0, 30);
    }
  }
  const s = JSON.stringify(out);
  return s === "{}" ? null : s;
}
function num(v, min, max, label) {
  if (v === void 0 || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new InputError(`${label} 값이 잘못되었습니다`);
  return n;
}
async function checkMediaIds(env, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return;
  const ph = uniq.map(() => "?").join(",");
  const rs = await env.DB.prepare(`SELECT id FROM media WHERE status='active' AND id IN (${ph})`).bind(...uniq).all();
  if ((rs.results ?? []).length !== uniq.length) throw new InputError("없거나 삭제된 사진이 포함되어 있습니다");
}
async function adminSave(req, env, ctx, type, id, uid) {
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") return json({ error: "잘못된 요청입니다" }, 400);
  const c = normCommon(raw);
  await checkMediaIds(env, [c.hero_media_id ?? "", c.thumb_media_id ?? "", ...c.gallery.map((g) => g.media_id)]);
  const blocks = await resolveBlocks(env.DB, c.blocks, siteHosts(env, req));
  const { html, rctx } = await renderRowBlocks(env, blocks);
  const plain = plainFromBlocks(blocks, rctx);
  const blocksJson = JSON.stringify(blocks);
  let existing = null;
  if (id) {
    existing = await loadFull(env, type, id);
    if (!existing) return json({ error: "not found" }, 404);
  }
  const itemId = id ?? crypto.randomUUID();
  const tagStmts = await tagLinkStmts(env, type, itemId, raw.tags);
  const stmts = [];
  if (existing) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO content_revisions (owner_type, owner_id, action, snapshot, edited_by) VALUES (?, ?, 'update', ?, ?)"
      ).bind(type, itemId, JSON.stringify(existing), uid)
    );
  }
  const prevPublished = existing?.published_at ?? null;
  if (type === "article") {
    const section = raw.section;
    if (!ARTICLE_KINDS[section]) throw new InputError("구분(section) 값이 잘못되었습니다");
    const parentId = section === "library" ? str(raw.parent_id, 64) : void 0;
    let kind = raw.kind;
    let status = c.status;
    if (parentId) {
      if (parentId === itemId) throw new InputError("자기 자신을 책으로 지정할 수 없습니다");
      const parent = await env.DB.prepare("SELECT id, section, kind, status, parent_id FROM articles WHERE id=?").bind(parentId).first();
      if (!parent || parent.section !== "library" || parent.parent_id) throw new InputError("책을 찾을 수 없습니다");
      if (existing) {
        const own = await env.DB.prepare("SELECT COUNT(*) AS n FROM articles WHERE parent_id=?").bind(itemId).first();
        if ((own?.n ?? 0) > 0) throw new InputError("장이 있는 책은 다른 책의 장이 될 수 없습니다");
      }
      kind = parent.kind;
      status = parent.status;
    }
    if (!await validArticleKind(env, section, kind)) throw new InputError("종류(kind) 값이 잘못되었습니다");
    const title = str(raw.title, TITLE_MAX);
    if (!title) throw new InputError("제목을 입력해 주세요");
    const dup = await env.DB.prepare("SELECT id FROM articles WHERE section=? AND slug=? AND id<>?").bind(section, c.slug, itemId).first();
    if (dup) return json({ error: "같은 주소(slug)의 글이 이미 있습니다" }, 409);
    if (section === "library" && LIBRARY_RESERVED_SLUGS.has(c.slug.toLowerCase())) {
      throw new InputError(`'${c.slug}'는 자료실 주소로 쓸 수 없습니다. 다른 주소를 입력해 주세요`);
    }
    const now = nowIso();
    const publishedAt = status === "published" ? prevPublished ?? now : prevPublished;
    const pinned = section === "library" && !parentId && raw.pinned ? 1 : 0;
    const featured = section === "library" && !parentId && raw.featured ? 1 : 0;
    const vals = [
      section,
      kind,
      c.slug,
      title,
      str(raw.title_hanja, 100),
      c.summary,
      plain,
      html,
      blocksJson,
      c.hero_media_id,
      c.thumb_media_id,
      c.thumb_crop,
      normMeta(raw.meta),
      c.sort_order,
      pinned,
      featured,
      status,
      publishedAt,
      parentId ?? null,
      uid
    ];
    if (existing) {
      stmts.push(
        env.DB.prepare(
          `UPDATE articles SET section=?, kind=?, slug=?, title=?, title_hanja=?, summary=?, body_md=?, body_html=?, body_blocks=?,
             hero_media_id=?, thumb_media_id=?, thumb_crop=?, meta=?, sort_order=?, pinned=?, featured=?, status=?, published_at=?, parent_id=?,
             updated_by=?, updated_at=datetime('now')
           WHERE id=?`
        ).bind(...vals, itemId)
      );
    } else {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO articles (section, kind, slug, title, title_hanja, summary, body_md, body_html, body_blocks,
             hero_media_id, thumb_media_id, thumb_crop, meta, sort_order, pinned, featured, status, published_at, parent_id, updated_by, created_by, id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(...vals, uid, itemId)
      );
    }
    if (!parentId) {
      stmts.push(
        env.DB.prepare(
          `UPDATE articles SET status=?, kind=?, published_at=CASE WHEN ?='published' THEN COALESCE(published_at, ?) ELSE published_at END,
             updated_at=datetime('now')
           WHERE parent_id=? AND (status<>? OR kind<>?)`
        ).bind(status, kind, status, now, itemId, status, kind)
      );
    }
  } else {
    if (!PLACE_KINDS.includes(raw.kind)) throw new InputError("종류(kind) 값이 잘못되었습니다");
    const name = str(raw.name, TITLE_MAX);
    if (!name) throw new InputError("이름을 입력해 주세요");
    const lat = num(raw.lat, -90, 90, "위도");
    const lng = num(raw.lng, -180, 180, "경도");
    if (lat === null !== (lng === null)) throw new InputError("위도와 경도를 함께 입력해 주세요");
    let geojson = null;
    if (typeof raw.geojson === "string" && raw.geojson.trim()) {
      if (raw.geojson.length > 1e5) throw new InputError("지도 데이터가 너무 큽니다");
      const g = safeJson(raw.geojson);
      if (!g || typeof g !== "object" || typeof g.type !== "string") {
        throw new InputError("지도 데이터(GeoJSON) 형식이 잘못되었습니다");
      }
      geojson = JSON.stringify(g);
    }
    const branch = str(raw.branch_code, 40);
    if (branch && !ctx.branchCodes.has(branch)) throw new InputError("지부 코드가 잘못되었습니다");
    const dup = await env.DB.prepare("SELECT id FROM places WHERE slug=? AND id<>?").bind(c.slug, itemId).first();
    if (dup) return json({ error: "같은 주소(slug)의 장소가 이미 있습니다" }, 409);
    const vals = [
      raw.kind,
      c.slug,
      name,
      str(raw.name_hanja, 100),
      c.summary,
      plain,
      html,
      blocksJson,
      str(raw.built, 100),
      lat,
      lng,
      raw.location_hidden ? 1 : 0,
      geojson,
      branch,
      c.hero_media_id,
      c.thumb_media_id,
      c.thumb_crop,
      c.sort_order,
      c.status,
      uid
    ];
    if (existing) {
      stmts.push(
        env.DB.prepare(
          `UPDATE places SET kind=?, slug=?, name=?, name_hanja=?, summary=?, body_md=?, body_html=?, body_blocks=?, built=?,
             lat=?, lng=?, location_hidden=?, geojson=?, branch_code=?, hero_media_id=?, thumb_media_id=?, thumb_crop=?, sort_order=?, status=?,
             updated_by=?, updated_at=datetime('now')
           WHERE id=?`
        ).bind(...vals, itemId)
      );
    } else {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO places (kind, slug, name, name_hanja, summary, body_md, body_html, body_blocks, built, lat, lng,
             location_hidden, geojson, branch_code, hero_media_id, thumb_media_id, thumb_crop, sort_order, status, updated_by, created_by, id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(...vals, uid, itemId)
      );
    }
  }
  stmts.push(env.DB.prepare("DELETE FROM media_links WHERE owner_type=? AND owner_id=?").bind(type, itemId));
  c.gallery.forEach((g, i) => {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO media_links (owner_type, owner_id, media_id, role, sort_order, caption) VALUES (?, ?, ?, 'gallery', ?, ?)"
      ).bind(type, itemId, g.media_id, i, g.caption)
    );
  });
  allMediaIds(blocks).forEach((mid, i) => {
    stmts.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO media_links (owner_type, owner_id, media_id, role, sort_order) VALUES (?, ?, ?, 'inline', ?)"
      ).bind(type, itemId, mid, 1e3 + i)
    );
  });
  stmts.push(...refIndexStmts(env, type, itemId, blocks));
  stmts.push(...tagStmts);
  await env.DB.batch(stmts);
  const item = await loadFull(env, type, itemId);
  return json({ item }, existing ? 200 : 201);
}
async function adminDelete(env, type, id, uid) {
  const existing = await loadFull(env, type, id);
  if (!existing) return json({ error: "not found" }, 404);
  if (type === "article" && (existing.chapters ?? []).length) {
    return json({ error: "장이 있는 책은 지울 수 없습니다. 장을 먼저 지워 주세요" }, 409);
  }
  const table = type === "article" ? "articles" : "places";
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO content_revisions (owner_type, owner_id, action, snapshot, edited_by) VALUES (?, ?, 'delete', ?, ?)"
    ).bind(type, id, JSON.stringify(existing), uid),
    env.DB.prepare("DELETE FROM media_links WHERE owner_type=? AND owner_id=?").bind(type, id),
    env.DB.prepare("DELETE FROM content_refs WHERE from_type=? AND from_id=?").bind(type, id),
    env.DB.prepare("DELETE FROM tag_links WHERE owner_type=? AND owner_id=?").bind(type, id),
    env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(id)
  ]);
  return json({ ok: true });
}
async function adminOrderChapters(req, env, bookId) {
  const body = await req.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x) => typeof x === "string") : null;
  if (!ids) return json({ error: "잘못된 요청입니다" }, 400);
  const have = (await loadChapters(env, bookId, null)).map((c) => c.id);
  if (ids.length !== have.length || new Set(ids).size !== ids.length || ids.some((i) => !have.includes(i))) {
    return json({ error: "장 목록이 바뀌었습니다. 새로고침 후 다시 시도해 주세요" }, 409);
  }
  await env.DB.batch(
    ids.map((cid, i) => env.DB.prepare("UPDATE articles SET sort_order=? WHERE id=? AND parent_id=?").bind(i + 1, cid, bookId))
  );
  return json({ ok: true });
}
async function adminListRevisions(env, type, id) {
  const rs = await env.DB.prepare(
    `SELECT r.id, r.action, r.created_at, u.display_name AS editor
       FROM content_revisions r LEFT JOIN users u ON u.id = r.edited_by
      WHERE r.owner_type=? AND r.owner_id=? ORDER BY r.id DESC LIMIT 100`
  ).bind(type, id).all();
  return json({ revisions: rs.results ?? [] });
}
async function adminGetRevision(env, rid) {
  const r = await env.DB.prepare(
    "SELECT id, owner_type, owner_id, action, snapshot, created_at FROM content_revisions WHERE id=?"
  ).bind(rid).first();
  if (!r) return json({ error: "not found" }, 404);
  return json({ revision: { ...r, snapshot: safeJson(r.snapshot) } });
}
async function adminListMedia(req, env) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "60", 10) || 60, 1), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
  const where = ["m.status='active'"];
  const binds = [];
  if (q) {
    where.push("(m.caption LIKE ? OR m.alt LIKE ? OR m.credit LIKE ? OR m.taken_at LIKE ?)");
    const like = `%${q.replace(/[%_]/g, "")}%`;
    binds.push(like, like, like, like);
  }
  const rs = await env.DB.prepare(
    `SELECT ${MEDIA_COLS.split(", ").map((c) => "m." + c).join(", ")},
            (SELECT COUNT(*) FROM media_links l WHERE l.media_id=m.id)
          + (SELECT COUNT(*) FROM articles a WHERE a.hero_media_id=m.id OR a.thumb_media_id=m.id)
          + (SELECT COUNT(*) FROM places p WHERE p.hero_media_id=m.id OR p.thumb_media_id=m.id)
          + (SELECT COUNT(*) FROM home_tiles h WHERE h.media_id=m.id)
          + (SELECT COUNT(*) FROM home_hero hh WHERE hh.media_id=m.id) AS usage
       FROM media m WHERE ${where.join(" AND ")}
      ORDER BY m.created_at DESC, m.id LIMIT ? OFFSET ?`
  ).bind(...binds, limit + 1, offset).all();
  const rows = rs.results ?? [];
  return json({
    media: rows.slice(0, limit).map((r) => ({ ...shapeMedia(env, r), usage: r.usage })),
    has_more: rows.length > limit
  });
}
async function adminUploadMedia(req, env, uid) {
  const ct = (req.headers.get("Content-Type") ?? "").split(";")[0].trim();
  if (!MEDIA_TYPES.has(ct)) return json({ error: "jpg·png·webp 사진만 올릴 수 있습니다" }, 415);
  const buf = await req.arrayBuffer();
  if (buf.byteLength === 0) return json({ error: "빈 파일입니다" }, 400);
  if (buf.byteLength > MEDIA_MAX_BYTES) return json({ error: "사진이 너무 큽니다 (최대 8MB)" }, 413);
  const width = Math.max(0, parseInt(req.headers.get("X-Image-Width") ?? "0", 10) || 0);
  const height = Math.max(0, parseInt(req.headers.get("X-Image-Height") ?? "0", 10) || 0);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const existing = await env.DB.prepare(`SELECT ${MEDIA_COLS}, status FROM media WHERE sha256=?`).bind(hash).first();
  if (existing) {
    if (existing.status !== "active") {
      await env.DB.prepare("UPDATE media SET status='active', updated_at=datetime('now') WHERE id=?").bind(existing.id).run();
    }
    return json({ media: shapeMedia(env, existing), deduped: true });
  }
  const now = new Date();
  const ext = ct === "image/jpeg" ? "jpg" : ct === "image/png" ? "png" : "webp";
  const id = crypto.randomUUID();
  const key = `media/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}.${ext}`;
  await env.UPLOADS.put(key, buf, {
    httpMetadata: { contentType: ct, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { uid, sha256: hash }
  });
  await env.DB.prepare(
    `INSERT INTO media (id, r2_key, sha256, content_type, width, height, size_bytes, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, key, hash, ct, width, height, buf.byteLength, uid).run();
  const row = await env.DB.prepare(`SELECT ${MEDIA_COLS} FROM media WHERE id=?`).bind(id).first();
  return json({ media: shapeMedia(env, row), deduped: false }, 201);
}
async function adminUpdateMedia(req, env, id) {
  const raw = await req.json().catch(() => null);
  if (!raw) return json({ error: "잘못된 요청입니다" }, 400);
  const fields = [
    ["alt", 300],
    ["caption", 500],
    ["credit", 200],
    ["taken_at", 100],
    ["source_url", 1e3]
  ];
  const sets = [];
  const binds = [];
  for (const [f, max] of fields) {
    if (f in raw) {
      sets.push(`${f}=?`);
      binds.push(str(raw[f], max));
    }
  }
  if (!sets.length) return json({ error: "바꿀 내용이 없습니다" }, 400);
  const res = await env.DB.prepare(
    `UPDATE media SET ${sets.join(", ")}, updated_at=datetime('now') WHERE id=? AND status='active'`
  ).bind(...binds, id).run();
  if (!res.meta.changes) return json({ error: "not found" }, 404);
  const row = await env.DB.prepare(`SELECT ${MEDIA_COLS} FROM media WHERE id=?`).bind(id).first();
  return json({ media: shapeMedia(env, row) });
}
async function adminDeleteMedia(env, id) {
  const uses = await env.DB.prepare(
    `SELECT 'article' AS type, a.id, a.title AS title FROM articles a
       WHERE a.hero_media_id=?1 OR a.thumb_media_id=?1 OR a.id IN (SELECT owner_id FROM media_links WHERE owner_type='article' AND media_id=?1)
     UNION ALL
     SELECT 'place' AS type, p.id, p.name AS title FROM places p
       WHERE p.hero_media_id=?1 OR p.thumb_media_id=?1 OR p.id IN (SELECT owner_id FROM media_links WHERE owner_type='place' AND media_id=?1)
     UNION ALL
     SELECT 'home' AS type, h.id, '홈 편성 · ' || h.title AS title FROM home_tiles h WHERE h.media_id=?1
     UNION ALL
     SELECT 'home' AS type, hh.slot AS id, '홈 편성 · 모바일 히어로 사진' AS title FROM home_hero hh WHERE hh.media_id=?1`
  ).bind(id).all();
  const usage = uses.results ?? [];
  if (usage.length) {
    return json({ error: "이 사진을 쓰는 곳이 있어 삭제할 수 없습니다", usage }, 409);
  }
  const res = await env.DB.prepare(
    "UPDATE media SET status='deleted', updated_at=datetime('now') WHERE id=? AND status='active'"
  ).bind(id).run();
  if (!res.meta.changes) return json({ error: "not found" }, 404);
  return json({ ok: true });
}
export function refIndexStmts(env, fromType, fromId, blocks) {
  const out = [env.DB.prepare("DELETE FROM content_refs WHERE from_type=? AND from_id=?").bind(fromType, fromId)];
  for (const r of refsOf(blocks)) {
    out.push(
      env.DB.prepare(
        "INSERT OR REPLACE INTO content_refs (from_type, from_id, block_id, to_type, to_id) VALUES (?, ?, ?, ?, ?)"
      ).bind(fromType, fromId, r.block_id, r.kind, r.id)
    );
  }
  return out;
}
const BOARD_LABELS = BOARD_LABEL;
async function publicSearch(req, env) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 50);
  const kinds = new Set((url.searchParams.get("kinds") ?? "article,place,post").split(","));
  const limit = 8;
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const items = [];
  if (kinds.has("article")) {
    const rs = await env.DB.prepare(
      `SELECT id, section, kind, slug, title FROM articles WHERE status='published' AND title LIKE ? ORDER BY sort_order LIMIT ?`
    ).bind(like, limit).all();
    for (const r of rs.results ?? []) {
      items.push({ kind: "article", id: r.id, title: r.title, label: r.section === "library" ? "자료실" : "소개", href: refHref("article", r) });
    }
  }
  if (kinds.has("place")) {
    const rs = await env.DB.prepare(
      `SELECT id, kind, slug, name FROM places WHERE status='published' AND name LIKE ? ORDER BY sort_order LIMIT ?`
    ).bind(like, limit).all();
    for (const r of rs.results ?? []) {
      items.push({ kind: "place", id: r.id, title: r.name, label: r.kind === "jeongak" ? "전각" : "장소", href: refHref("place", r) });
    }
  }
  if (kinds.has("post")) {
    const rs = await env.DB.prepare(
      `SELECT id, board, category, title FROM posts WHERE status='published' AND board NOT IN (${PRIVATE_BOARDS_SQL}) AND title LIKE ? ORDER BY created_at DESC LIMIT ?`
    ).bind(like, limit).all();
    for (const r of rs.results ?? []) {
      items.push({ kind: "post", id: r.id, title: r.title, label: BOARD_LABELS[r.board] ?? "게시글", href: refHref("post", r) });
    }
  }
  return json({ items });
}
async function publicFind(req, env) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 50);
  const terms = [...new Set(q.split(/\s+/).map((t) => t.replace(/[%_]/g, "")).filter(Boolean))].slice(0, 5);
  if (!terms.length) return json({ items: [] });
  const likes = terms.map((t) => `%${t}%`);
  const LIMIT = 30;
  const refTitles = (type, alias) => `COALESCE((SELECT group_concat(COALESCE(a.title, p2.name), ' ') FROM content_refs r
       LEFT JOIN articles a ON r.to_type='article' AND a.id=r.to_id
       LEFT JOIN places p2 ON r.to_type='place' AND p2.id=r.to_id
      WHERE r.from_type='${type}' AND r.from_id=${alias}.id), '')`;
  const where = (cols) => terms.map(() => `(${cols}) LIKE ?`).join(" AND ");
  const catRs = await env.DB.prepare("SELECT key, label FROM library_categories").all();
  const catLabel = new Map((catRs.results ?? []).map((c) => [c.key, c.label]));
  const hits = [];
  const low = (x) => x.toLowerCase();
  const inTitle = (...xs) => terms.some((t) => xs.some((x) => low(x ?? "").includes(low(t))));
  const push = (h, titles, summary, blocks, legacy, refs) => {
    const body = blocks ? blocksPlain(blocks) : legacy ?? "";
    const all = low([...titles, summary, body, refs].filter(Boolean).join("\n"));
    if (!terms.every((t) => all.includes(low(t)))) return;
    let text = [summary, body].filter(Boolean).join("\n");
    if (refs && !terms.some((t) => low(text).includes(low(t)))) text = [text, `참조: ${refs}`].filter(Boolean).join("\n");
    hits.push({ ...h, text, inTitle: inTitle(...titles) });
  };
  const art = await env.DB.prepare(
    `SELECT a.id, a.section, a.kind, a.slug, a.title, a.title_hanja, a.summary, a.body_blocks, a.body_md, ${refTitles("article", "a")} AS refs
       FROM articles a
      WHERE a.status='published' AND ${where(`a.title || ' ' || COALESCE(a.title_hanja,'') || ' ' || COALESCE(a.summary,'') || ' ' || COALESCE(a.body_blocks, a.body_md) || ' ' || ${refTitles("article", "a")}`)}
      ORDER BY a.section, a.sort_order LIMIT ?`
  ).bind(...likes, LIMIT).all();
  for (const r of art.results ?? []) {
    const label = r.section === "library" ? `자료실 · ${catLabel.get(r.kind) ?? r.kind}` : "소개";
    push({ title: r.title, hanja: r.title_hanja, label, href: refHref("article", r), rank: r.section === "about" ? 1 : 3 }, [r.title, r.title_hanja], r.summary, r.body_blocks, r.body_md, r.refs);
  }
  const pl = await env.DB.prepare(
    `SELECT p.id, p.kind, p.slug, p.name, p.name_hanja, p.summary, p.body_blocks, p.body_md, ${refTitles("place", "p")} AS refs
       FROM places p
      WHERE p.status='published' AND ${where(`p.name || ' ' || COALESCE(p.name_hanja,'') || ' ' || COALESCE(p.summary,'') || ' ' || COALESCE(p.body_blocks, p.body_md) || ' ' || ${refTitles("place", "p")}`)}
      ORDER BY p.sort_order LIMIT ?`
  ).bind(...likes, LIMIT).all();
  for (const r of pl.results ?? []) {
    push({ title: r.name, hanja: r.name_hanja, label: r.kind === "jeongak" ? "전각" : "장소", href: refHref("place", r), rank: 2 }, [r.name, r.name_hanja], r.summary, r.body_blocks, r.body_md, r.refs);
  }
  const po = await env.DB.prepare(
    `SELECT p.id, p.board, p.category, p.title, p.body_blocks, p.body_md, ${refTitles("post", "p")} AS refs
       FROM posts p
      WHERE p.status='published' AND p.board='etc' AND ${where(`p.title || ' ' || COALESCE(p.body_blocks, p.body_md) || ' ' || ${refTitles("post", "p")}`)}
      ORDER BY p.created_at DESC LIMIT ?`
  ).bind(...likes, LIMIT).all();
  for (const r of po.results ?? []) {
    push({ title: r.title, hanja: null, label: `자료실 · ${catLabel.get(r.category) ?? "기타 자료"}`, href: refHref("post", r), rank: 4 }, [r.title], null, r.body_blocks, r.body_md, r.refs);
  }
  hits.sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || a.rank - b.rank);
  return json({
    items: hits.slice(0, LIMIT).map((h) => ({ title: h.title, hanja: h.hanja, label: h.label, href: h.href, excerpt: findExcerpt(h.text, terms) }))
  });
}
function blocksPlain(json5) {
  const blocks = parseStoredBlocks(json5);
  if (!blocks) return "";
  return blocks.flatMap((b) => [
    b.type === "heading" || b.type === "text" || b.type === "quote" ? b.text : null,
    b.type === "quote" ? b.source : null,
    b.caption,
    b.type === "image" ? imageItems(b).map((i) => i.caption).join(" ") : null,
    b.type === "link" ? b.label : null
  ]).filter((x) => !!x && !!x.trim()).join("\n");
}
function findExcerpt(text, terms) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const low = flat.toLowerCase();
  const at = terms.map((t) => low.indexOf(t.toLowerCase())).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 30);
  const end = Math.min(flat.length, start + 90);
  const cut = (start > 0 ? "… " : "") + flat.slice(start, end) + (end < flat.length ? " …" : "");
  const esc2 = cut.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const re = new RegExp(terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")).join("|"), "gi");
  return esc2.replace(re, (m) => `<mark>${m}</mark>`);
}
async function publicBacklinks(req, env) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "";
  const id = url.searchParams.get("id") ?? "";
  if (!["article", "place", "post", "point"].includes(kind) || !id) return json({ error: "invalid" }, 400);
  const rs = await env.DB.prepare(
    `SELECT r.from_type, r.from_id, r.block_id,
            a.section AS a_section, a.kind AS a_kind, a.slug AS a_slug, a.title AS a_title, a.status AS a_status,
            p.kind AS p_kind, p.slug AS p_slug, p.name AS p_name, p.status AS p_status,
            po.board AS po_board, po.category AS po_category, po.title AS po_title, po.status AS po_status
       FROM content_refs r
       LEFT JOIN articles a ON r.from_type='article' AND a.id=r.from_id
       LEFT JOIN places p ON r.from_type='place' AND p.id=r.from_id
       LEFT JOIN posts po ON r.from_type='post' AND po.id=r.from_id
      WHERE r.to_type=? AND r.to_id=?
      LIMIT 200`
  ).bind(kind, id).all();
  const seen = new Set();
  const items = [];
  for (const r of rs.results ?? []) {
    const k = `${r.from_type}:${r.from_id}`;
    if (seen.has(k)) continue;
    if (r.from_type === "article" && r.a_status === "published") {
      items.push({ kind: "article", id: r.from_id, title: r.a_title, block_id: r.block_id, href: refHref("article", { section: r.a_section, kind: r.a_kind, slug: r.a_slug }) });
    } else if (r.from_type === "place" && r.p_status === "published") {
      items.push({ kind: "place", id: r.from_id, title: r.p_name, block_id: r.block_id, href: refHref("place", { kind: r.p_kind, slug: r.p_slug }) });
    } else if (r.from_type === "post" && r.po_status === "published") {
      items.push({ kind: "post", id: r.from_id, title: r.po_title, block_id: r.block_id, href: refHref("post", { board: r.po_board, category: r.po_category, id: r.from_id }) });
    } else continue;
    seen.add(k);
  }
  return json({ items });
}
async function publicCard(req, env, ctx) {
  const url = new URL(req.url);
  const vis = await viewerVis(req, ctx);
  const kind = url.searchParams.get("kind") ?? "";
  const id = url.searchParams.get("id") ?? "";
  if (!id || id.length > 64) return json({ error: "invalid" }, 400);
  if (kind === "article") {
    const r = await env.DB.prepare(`SELECT * FROM articles WHERE id=? AND ${visSql(vis)}`).bind(id).first();
    if (!r) return json({ error: "not found" }, 404);
    const media = await loadMediaMap(env, imgIds(r), true);
    const { html } = await renderRowBlocks(env, blocksOfRow(r));
    return json({
      card: {
        kind,
        id,
        title: r.title,
        title_hanja: r.title_hanja,
        summary: r.summary,
        label: r.section === "library" ? "자료실" : "소개",
        hero: pick(media, r.thumb_media_id),
        // 서랍 카드 사진 = 썸네일
        href: refHref("article", r),
        body_html: html
      }
    });
  }
  if (kind === "place") {
    const r = await env.DB.prepare(`SELECT * FROM places WHERE id=? AND ${visSql(vis)}`).bind(id).first();
    if (!r) return json({ error: "not found" }, 404);
    const media = await loadMediaMap(env, imgIds(r), true);
    const { html } = await renderRowBlocks(env, blocksOfRow(r));
    return json({
      card: {
        kind,
        id,
        title: r.name,
        title_hanja: r.name_hanja,
        summary: r.summary,
        label: r.kind === "jeongak" ? "전각" : "장소",
        hero: pick(media, r.thumb_media_id),
        // 서랍 카드 사진 = 썸네일
        href: refHref("place", r),
        body_html: html
      }
    });
  }
  if (kind === "point") {
    const r = await env.DB.prepare(`${POINT_SELECT} WHERE mp.id=? AND mp.status='published'`).bind(id).first();
    if (!r) return json({ error: "not found" }, 404);
    const pt = shapePoint(r);
    let hero = null;
    let html = "";
    let href = null;
    let summary = r.summary ?? null;
    if (pt.place) {
      const pr = await env.DB.prepare("SELECT * FROM places WHERE id=? AND status='published'").bind(pt.place.id).first();
      if (pr) {
        const media = await loadMediaMap(env, imgIds(pr), true);
        hero = pick(media, pr.thumb_media_id);
        html = (await renderRowBlocks(env, blocksOfRow(pr))).html;
        href = pt.place.href;
        summary = summary ?? pr.summary;
      }
    }
    return json({
      card: {
        kind,
        id,
        title: r.name,
        title_hanja: r.name_hanja,
        summary,
        label: MAP_KIND_LABEL[r.kind] ?? "장소",
        hero,
        href,
        body_html: html
      }
    });
  }
  if (kind === "post") {
    const r = await env.DB.prepare(
      `SELECT p.id, p.board, p.category, p.title, p.body_html, p.body_blocks, p.created_at, u.display_name AS author
         FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id=? AND p.status='published' AND p.board NOT IN (${PRIVATE_BOARDS_SQL})`
    ).bind(id).first();
    if (!r) return json({ error: "not found" }, 404);
    const stored = parseStoredBlocks(r.body_blocks);
    const html = stored ? (await renderRowBlocks(env, stored)).html : r.body_html;
    return json({
      card: {
        kind,
        id,
        title: r.title,
        title_hanja: null,
        summary: r.author ? `${r.author} · ${String(r.created_at).slice(0, 10)}` : null,
        label: BOARD_LABELS[r.board] ?? "게시글",
        hero: null,
        href: refHref("post", r),
        body_html: html
      }
    });
  }
  return json({ error: "invalid" }, 400);
}
async function publicImageBlocks(req, env) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "";
  const id = url.searchParams.get("id") ?? "";
  if (kind !== "article" && kind !== "place") return json({ error: "이미지 참조는 소개·자료실·전각만 가능합니다" }, 400);
  const t = await loadTargetBlocks(env.DB, kind, id);
  if (!t || t.row.status !== "published") return json({ error: "not found" }, 404);
  const imgs = t.blocks.filter((b) => b.type === "image");
  const { rctx } = await renderRowBlocks(env, imgs);
  return json({
    blocks: imgs.map((b) => ({
      block_id: b.id,
      caption: b.caption ?? null,
      thumbs: imageItems(b).map((it) => it.media_id ? rctx.media.get(it.media_id)?.url : it.key ? rctx.keys.get(it.key)?.url : void 0).filter(Boolean)
    }))
  });
}

