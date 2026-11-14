// 블록 본문(문서 블록) 정규화·렌더 공용 모듈
// 복원: 2026-11-01 배포본(jsbeob-api-preview) 번들에서 복원. 원본 TS 타입 정보는 번들에서 사라져
// 대부분 생략되었다(tsconfig strict:false). 동작은 배포본과 같다.
import { BOARD_LABEL, PRIVATE_BOARDS_SQL } from "./boards";

export class BlockError extends Error {}
const TYPES = new Set(["heading", "text", "quote", "image", "video", "link", "imageref", "map", "verse"]);
// 경전 절(verse) 블록 — 문장마다 위치 표시(anchor, jsbooks 의 ^1-1-3 형식)를 붙여 문장 단위로 인용·관련링크를 건다 (2026-11-14)
const ANCHOR_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const MAX_VERSE_LINES = 400;
const IMAGEREF_KINDS = new Set(["article", "place"]);
const REF_KINDS = new Set(["article", "place", "post"]);
const ID_RE = /^[A-Za-z0-9_-]{6,22}$/;
export const MEMBER_KEY_RE = /^comments\/\d{4}\/\d{2}\/\d{2}\/\d{2}\/[A-Za-z0-9-]{1,64}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
const MAX_BLOCKS = 200;
const MAX_IMAGES = 30;
export function imageItems(b) {
  if (b.type !== "image") return [];
  if (Array.isArray(b.items)) return b.items;
  return b.media_id || b.key ? [{ media_id: b.media_id, key: b.key }] : [];
}
export const allMediaIds = (blocks) => [...new Set(blocks.flatMap(imageItems).map((i) => i.media_id).filter(Boolean))];
export const allKeys = (blocks) => [...new Set(blocks.flatMap(imageItems).map((i) => i.key).filter(Boolean))];
export const allPointIds = (blocks) => [...new Set(blocks.filter((b) => b.type === "map" && b.point).map((b) => b.point))];
const blockRef = (b) => b.ref ?? b.source_ref;
function parseRef(v) {
  const r = v;
  if (r && typeof r === "object" && REF_KINDS.has(r.kind) && typeof r.id === "string" && r.id.length > 0 && r.id.length <= 64) {
    const anchor = typeof r.anchor === "string" && ANCHOR_RE.test(r.anchor) ? r.anchor : void 0;
    return { kind: r.kind, id: r.id, ...anchor ? { anchor } : {} };
  }
  return void 0;
}
/** 절 블록 편집 문장 줄 "문장 ^1-1-3" → { a, t } */
function verseLinesFromText(text) {
  return text.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/\s*\^([^\s^]+)\s*$/);
    return m ? { a: m[1], t: l.slice(0, m.index) } : { a: "", t: l };
  });
}
/** 위치 표시가 없는 문장에 같은 글의 표시 규칙(가장 많이 쓰인 "앞부분+번호")을 이어 붙인다 */
function fillVerseAnchors(blocks) {
  const verses = blocks.filter((b) => b.type === "verse");
  if (!verses.length) return;
  const used = new Set();
  for (const v of verses) {
    for (const l of v.lines) {
      if (!l.a) continue;
      if (used.has(l.a)) throw new BlockError(`문장 위치 표시 ^${l.a} 가 두 번 나옵니다`);
      used.add(l.a);
    }
  }
  const missing = verses.flatMap((v) => v.lines.filter((l) => !l.a));
  if (!missing.length) return;
  const count = new Map();
  const max = new Map();
  for (const a of used) {
    const m = a.match(/^(.*?)(\d+)$/);
    if (!m) continue;
    count.set(m[1], (count.get(m[1]) ?? 0) + 1);
    max.set(m[1], Math.max(max.get(m[1]) ?? 0, Number(m[2])));
  }
  let prefix = "s-";
  let best = 0;
  for (const [k, n] of count) if (n > best) [prefix, best] = [k, n];
  let n = max.get(prefix) ?? 0;
  for (const l of missing) {
    let cand;
    do cand = `${prefix}${++n}`;
    while (used.has(cand));
    l.a = cand;
    used.add(cand);
  }
}
export function s(v, max, label, trim = true) {
  if (v === void 0 || v === null) return void 0;
  if (typeof v !== "string") throw new BlockError(`${label} 형식이 잘못되었습니다`);
  const t = trim ? v.trim() : v.replace(/\s+$/, "");
  if (t.length > max) throw new BlockError(`${label}은(는) ${max}자까지 쓸 수 있습니다`);
  return t === "" ? void 0 : t;
}
function newId() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return [...a].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("") + "b";
}
function parseYouTube(input) {
  const v = input.trim();
  if (/^[\w-]{11}$/.test(v)) return v;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      const q = u.searchParams.get("v");
      if (q && /^[\w-]{11}$/.test(q)) return q;
      const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{11})/);
      if (m) return m[2];
    }
  } catch {
  }
  return null;
}
export function normalizeBlocks(raw, opts) {
  if (!Array.isArray(raw)) throw new BlockError("본문 형식이 잘못되었습니다");
  if (raw.length > MAX_BLOCKS) throw new BlockError(`블록은 ${MAX_BLOCKS}개까지 넣을 수 있습니다`);
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    if (!r || typeof r !== "object" || !TYPES.has(r.type)) throw new BlockError("알 수 없는 블록이 있습니다");
    const b = r;
    let id = typeof b.id === "string" && ID_RE.test(b.id) && !seen.has(b.id) ? b.id : "";
    const type = b.type;
    let block = null;
    if (type === "heading") {
      const text = s(typeof b.text === "string" ? b.text.replace(/\s*\n\s*/g, " ") : b.text, 200, "소제목");
      if (text) block = { id, type, text };
    } else if (type === "text") {
      const text = s(b.text, 2e4, "문단", false);
      if (text?.trim()) block = { id, type, text };
    } else if (type === "quote") {
      const text = s(b.text, 5e3, "인용문", false);
      const source = s(b.source, 300, "출처");
      const source_ref = parseRef(b.source_ref);
      if (text?.trim()) block = { id, type, text, ...source ? { source } : {}, ...source_ref ? { source_ref } : {} };
      else if (source || source_ref) throw new BlockError("인용문을 입력해 주세요");
    } else if (type === "image") {
      const caption = s(b.caption, 500, "이미지 설명");
      const raw2 = Array.isArray(b.items) ? b.items : b.media_id || b.key ? [{ media_id: b.media_id, key: b.key }] : [];
      if (raw2.length > MAX_IMAGES) throw new BlockError(`이미지는 한 블록에 ${MAX_IMAGES}장까지 넣을 수 있습니다`);
      const items = [];
      for (const it of raw2) {
        if (!it || typeof it !== "object") throw new BlockError("이미지 형식이 잘못되었습니다");
        const media_id = s(it.media_id, 64, "이미지");
        const key = s(it.key, 200, "이미지");
        const cap = s(it.caption, 300, "이미지 설명");
        if (media_id) {
          if (!opts.allowMedia) throw new BlockError("사용할 수 없는 이미지입니다");
          items.push({ media_id, ...cap ? { caption: cap } : {} });
        } else if (key) {
          if (!opts.allowKey || !MEMBER_KEY_RE.test(key)) throw new BlockError("사용할 수 없는 이미지입니다");
          items.push({ key, ...cap ? { caption: cap } : {} });
        }
      }
      if (items.length) block = { id, type, items, ...caption ? { caption } : {} };
      else if (caption) throw new BlockError("이미지 블록에 이미지가 없습니다");
    } else if (type === "video") {
      const caption = s(b.caption, 500, "영상 설명");
      const input = s(b.video_id ?? b.url, 500, "영상 주소");
      if (input) {
        const vid = parseYouTube(input);
        if (!vid) throw new BlockError("영상 주소를 알아보지 못했습니다. YouTube 주소인지 확인해 주세요");
        block = { id, type, video_id: vid, ...caption ? { caption } : {} };
      } else if (caption) {
        throw new BlockError("영상 블록에 주소가 없습니다");
      }
    } else if (type === "imageref") {
      const ref = parseRef(b.ref);
      const target = typeof b.block === "string" && ID_RE.test(b.block) ? b.block : "";
      const caption = s(b.caption, 500, "이미지 설명");
      if (ref || target) {
        if (!ref || !target || !IMAGEREF_KINDS.has(ref.kind)) throw new BlockError("참조할 이미지 블록을 골라 주세요");
        block = { id, type, ref, block: target, ...caption ? { caption } : {} };
      }
    } else if (type === "map") {
      const point = s(b.point, 64, "지도 장소");
      const caption = s(b.caption, 500, "지도 설명");
      if (point) block = { id, type, point, ...caption ? { caption } : {} };
      else if (caption) throw new BlockError("지도 블록의 장소를 골라 주세요");
    } else if (type === "verse") {
      if (!opts.allowMedia) throw new BlockError("사용할 수 없는 블록입니다");
      const label = s(typeof b.label === "string" ? b.label.replace(/\s*\n\s*/g, " ") : b.label, 40, "절 이름");
      const raw2 = Array.isArray(b.lines) ? b.lines : typeof b.text === "string" ? verseLinesFromText(b.text) : [];
      if (raw2.length > MAX_VERSE_LINES) throw new BlockError(`절 블록 하나에는 문장을 ${MAX_VERSE_LINES}개까지 넣을 수 있습니다`);
      const lines = [];
      for (const it of raw2) {
        if (!it || typeof it !== "object") throw new BlockError("절 블록 형식이 잘못되었습니다");
        const t = s(it.t, 5e3, "문장");
        const a = it.a === void 0 || it.a === null || it.a === "" ? "" : String(it.a);
        if (a && !ANCHOR_RE.test(a)) throw new BlockError(`문장 위치 표시 ^${a} 가 잘못되었습니다 (영문·숫자·-·_ 40자 이내)`);
        if (t) lines.push({ a, t });
      }
      if (lines.length) block = { id, type, ...label ? { label } : {}, lines };
      else if (label) throw new BlockError("절 블록에 문장이 없습니다");
    } else if (type === "link") {
      const ref = b.ref;
      if (ref && typeof ref === "object" && REF_KINDS.has(ref.kind) && typeof ref.id === "string" && ref.id.length <= 64) {
        block = { id, type, ref: { kind: ref.kind, id: ref.id } };
      } else {
        const url = s(b.url, 2e3, "링크 주소");
        const label = s(b.label, 200, "링크 문구");
        if (url) block = { id, type, url, ...label ? { label } : {} };
        else if (label) throw new BlockError("링크 주소를 입력해 주세요");
      }
    }
    if (!block) continue;
    if (!block.id) block.id = newId();
    while (seen.has(block.id)) block.id = newId();
    seen.add(block.id);
    out.push(block);
  }
  fillVerseAnchors(out);
  return out;
}
function parseSitePath(url, siteHosts2) {
  let path;
  if (url.startsWith("/") && !url.startsWith("//")) path = url;
  else {
    try {
      const u = new URL(url);
      if (!siteHosts2.has(u.host.toLowerCase())) return null;
      path = u.pathname;
    } catch {
      return null;
    }
  }
  path = path.split(/[?#]/)[0];
  let seg;
  try {
    seg = path.split("/").filter(Boolean).map((x) => decodeURIComponent(x));
  } catch {
    return "site";
  }
  if (seg[0] === "about" && seg.length === 2) return { kind: "article", section: "about", slug: seg[1] };
  if (seg[0] === "archive" && seg.length === 3 && seg[1] !== "places" && seg[1] !== "library") {
    if (/^[0-9a-f-]{36}$/.test(seg[2])) return { kind: "post", id: seg[2] };
    return { kind: "article", section: "library", slug: seg[2], soft: true };
  }
  if (seg[0] === "archive" && seg.length === 2 && seg[1] !== "places" && seg[1] !== "library") {
    return { kind: "article", section: "library", slug: seg[1], soft: true };
  }
  if (seg[0] === "archive" && seg[1] === "library" && seg.length === 4) return { kind: "article", section: "library", slug: seg[3] };
  if (seg[0] === "jeongak" && seg.length === 2) return { kind: "place", slug: seg[1] };
  if (seg[0] === "archive" && seg[1] === "places" && seg.length === 3) return { kind: "place", slug: seg[2] };
  if (seg[0] === "community" && seg.length === 3 && /^[0-9a-f-]{36}$/.test(seg[2])) return { kind: "post", id: seg[2] };
  if (seg[0] === "archive" && seg[1] === "p" && seg.length === 3 && /^[0-9a-f-]{36}$/.test(seg[2])) return { kind: "post", id: seg[2] };
  return "site";
}
export async function loadTargetBlocks(db, kind, id) {
  if (!IMAGEREF_KINDS.has(kind)) return null;
  const table = kind === "article" ? "articles" : "places";
  const r = await db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first();
  if (!r) return null;
  return { row: r, blocks: parseStoredBlocks(r.body_blocks) ?? [] };
}
export async function resolveBlocks(db, blocks, siteHosts2, keyPolicy, pointPolicy) {
  const out = [];
  for (const b of blocks) {
    if (b.type === "link" && b.url) {
      const p = parseSitePath(b.url, siteHosts2);
      if (p && p !== "site") {
        let row = null;
        if (p.kind === "article") {
          row = await db.prepare("SELECT id FROM articles WHERE section=? AND slug=?").bind(p.section, p.slug).first();
        } else if (p.kind === "place") {
          row = await db.prepare("SELECT id FROM places WHERE slug=?").bind(p.slug).first();
        } else {
          row = await db.prepare(`SELECT id FROM posts WHERE id=? AND status<>'deleted' AND board NOT IN (${PRIVATE_BOARDS_SQL})`).bind(p.id).first();
        }
        if (!row && !p.soft) throw new BlockError("연결할 사이트 자료를 찾지 못했습니다. 주소를 확인해 주세요");
        if (row) {
          out.push({ id: b.id, type: "link", ref: { kind: p.kind, id: row.id } });
          continue;
        }
      }
      const isSitePath = b.url.startsWith("/") && !b.url.startsWith("//");
      if (!isSitePath && !/^https?:\/\//i.test(b.url)) {
        throw new BlockError("링크 주소를 알아보지 못했습니다. http(s) 주소인지 확인해 주세요");
      }
      if (!b.label) throw new BlockError("링크에 표시할 문구가 필요합니다");
      out.push(b);
      continue;
    }
    out.push(b);
  }
  const refs = out.map(blockRef).filter(Boolean);
  for (const kind of ["article", "place", "post"]) {
    const ids = [...new Set(refs.filter((r) => r.kind === kind).map((r) => r.id))];
    if (!ids.length) continue;
    const table = kind === "article" ? "articles" : kind === "place" ? "places" : "posts";
    const extra = kind === "post" ? " AND status<>'deleted'" : "";
    const rs = await db.prepare(`SELECT id FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")})${extra}`).bind(...ids).all();
    if ((rs.results ?? []).length !== ids.length) throw new BlockError("연결한 사이트 자료 중 없는 것이 있습니다");
  }
  const pids = allPointIds(out);
  if (pids.length) {
    const rs = await db.prepare(`SELECT id, status FROM map_points WHERE id IN (${pids.map(() => "?").join(",")})`).bind(...pids).all();
    const found = new Map((rs.results ?? []).map((r) => [r.id, r.status]));
    for (const id of pids) {
      const st = found.get(id);
      if (!st) throw new BlockError("지도 블록의 장소를 찾지 못했습니다. 다시 골라 주세요");
      if (pointPolicy && st !== "published" && !pointPolicy.keep.has(id)) {
        throw new BlockError("지도 블록에는 사이트에 공개된 장소만 넣을 수 있습니다");
      }
    }
  }
  for (const b of out.filter((x) => x.type === "imageref")) {
    const row = await loadTargetBlocks(db, b.ref.kind, b.ref.id);
    const hit = row?.blocks.find((x) => x.id === b.block && x.type === "image");
    if (!hit) throw new BlockError("참조한 이미지 블록을 찾지 못했습니다. 다시 골라 주세요");
  }
  const mediaIds = allMediaIds(out);
  if (mediaIds.length) {
    const rs = await db.prepare(`SELECT id FROM media WHERE status='active' AND id IN (${mediaIds.map(() => "?").join(",")})`).bind(...mediaIds).all();
    if ((rs.results ?? []).length !== mediaIds.length) throw new BlockError("없거나 삭제된 사진이 있습니다");
  }
  const keys = allKeys(out);
  const check = keyPolicy ? keys.filter((k) => !keyPolicy.keep.has(k)) : keys;
  if (check.length) {
    const ph = check.map(() => "?").join(",");
    const rs = keyPolicy ? await db.prepare(`SELECT DISTINCT r2_key FROM user_uploaded_photos WHERE user_id=? AND r2_key IN (${ph})`).bind(keyPolicy.owner, ...check).all() : await db.prepare(`SELECT DISTINCT r2_key FROM user_uploaded_photos WHERE r2_key IN (${ph})`).bind(...check).all();
    if ((rs.results ?? []).length !== check.length) {
      throw new BlockError("직접 올리지 않은 사진이 있습니다. 사진을 다시 올려 주세요");
    }
  }
  return out;
}
export const DOC_MARKER = { color: "#FFFFFF", icon: "doc" };
export async function pointStyles(db, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rs = await db.prepare(
    `SELECT tl.owner_id AS pid, t.id, t.color, t.icon FROM tag_links tl JOIN tags t ON t.id = tl.tag_id
        WHERE tl.owner_type='point' AND t.on_map=1 AND t.status='active' AND tl.owner_id IN (${ids.map(() => "?").join(",")})
        ORDER BY t.sort_order, t.name`
  ).bind(...ids).all();
  for (const r of rs.results ?? []) {
    const cur = out.get(r.pid);
    if (cur) cur.tags.push(r.id);
    else out.set(r.pid, { color: r.color, icon: r.icon, tags: [r.id] });
  }
  return out;
}
const PLACE_LABEL = { jeongak: "전각", landmark: "성지·유적", branch: "지부·분원", etc: "장소" };
/** 책의 장 주소 — 장 slug 가 "책slug-" 로 시작하면 그 뒤만 쓴다 (예: hwaeundang-silgi-1 → /archive/book/hwaeundang-silgi/1/) */
export function chapterPath(kind, bookSlug, chapSlug) {
  const short = chapSlug.startsWith(`${bookSlug}-`) && chapSlug.length > bookSlug.length + 1 ? chapSlug.slice(bookSlug.length + 1) : chapSlug;
  return `/archive/${encodeURIComponent(kind)}/${encodeURIComponent(bookSlug)}/${encodeURIComponent(short)}/`;
}
export function refHref(kind, r) {
  if (kind === "article") {
    if (r.section === "library" && r.book_slug) return chapterPath(r.kind, r.book_slug, r.slug);
    return r.section === "library" ? `/archive/${encodeURIComponent(r.kind)}/${encodeURIComponent(r.slug)}/` : `/about/${encodeURIComponent(r.slug)}/`;
  }
  if (kind === "place") {
    return r.kind === "jeongak" ? `/jeongak/${encodeURIComponent(r.slug)}/` : `/archive/places/${encodeURIComponent(r.slug)}/`;
  }
  if (r.board === "etc") return `/archive/${encodeURIComponent(r.category || "etc")}/${r.id}/`;
  return `/community/${r.board}/${r.id}/`;
}
export async function loadRenderCtx(db, blocks, urlFor) {
  const ctx = { media: new Map(), keys: new Map(), refs: new Map(), imgrefs: new Map(), points: new Map() };
  const extra = [];
  for (const b of blocks.filter((x) => x.type === "imageref" && x.ref && x.block)) {
    const t = await loadTargetBlocks(db, b.ref.kind, b.ref.id);
    const hit = t?.blocks.find((x) => x.id === b.block && x.type === "image");
    if (hit) {
      ctx.imgrefs.set(`${b.ref.kind}:${b.ref.id}:${b.block}`, imageItems(hit));
      extra.push(hit);
    }
  }
  const all = [...blocks, ...extra];
  const mediaIds = allMediaIds(all);
  if (mediaIds.length) {
    const rs = await db.prepare(`SELECT id, r2_key, width, height, alt, caption FROM media WHERE status='active' AND id IN (${mediaIds.map(() => "?").join(",")})`).bind(...mediaIds).all();
    for (const r of rs.results ?? []) ctx.media.set(r.id, { url: urlFor(r.r2_key), width: r.width, height: r.height, alt: r.alt, caption: r.caption });
  }
  const keys = allKeys(all);
  if (keys.length) {
    const rs = await db.prepare(`SELECT r2_key, MAX(width) AS width, MAX(height) AS height FROM user_uploaded_photos WHERE r2_key IN (${keys.map(() => "?").join(",")}) GROUP BY r2_key`).bind(...keys).all();
    const found = new Map((rs.results ?? []).map((r) => [r.r2_key, r]));
    for (const k of keys) {
      const r = found.get(k);
      ctx.keys.set(k, { url: urlFor(k), width: r?.width ?? 0, height: r?.height ?? 0 });
    }
  }
  const refs = blocks.map(blockRef).filter(Boolean);
  const byKind = (k) => [...new Set(refs.filter((r) => r.kind === k).map((r) => r.id))];
  const art = byKind("article");
  if (art.length) {
    const rs = await db.prepare(
      `SELECT a.id, a.section, a.kind, a.slug, a.title, a.status, b.slug AS book_slug, b.title AS book_title
         FROM articles a LEFT JOIN articles b ON b.id = a.parent_id WHERE a.id IN (${art.map(() => "?").join(",")})`
    ).bind(...art).all();
    for (const r of rs.results ?? []) {
      ctx.refs.set(`article:${r.id}`, {
        title: r.book_title ? `${r.book_title} ${r.title}` : r.title,
        href: refHref("article", r),
        kindLabel: r.section === "library" ? r.book_title ?? "자료실" : "소개",
        visible: r.status === "published"
      });
    }
  }
  const pl = byKind("place");
  if (pl.length) {
    const rs = await db.prepare(`SELECT id, kind, slug, name, status FROM places WHERE id IN (${pl.map(() => "?").join(",")})`).bind(...pl).all();
    for (const r of rs.results ?? []) {
      ctx.refs.set(`place:${r.id}`, { title: r.name, href: refHref("place", r), kindLabel: PLACE_LABEL[r.kind] ?? "장소", visible: r.status === "published" });
    }
  }
  const pids = allPointIds(blocks);
  if (pids.length) {
    const rs = await db.prepare(`SELECT id, name, name_hanja, lat, lng, status FROM map_points WHERE id IN (${pids.map(() => "?").join(",")})`).bind(...pids).all();
    const styles = await pointStyles(db, pids);
    for (const r of rs.results ?? []) {
      const st = styles.get(r.id) ?? DOC_MARKER;
      ctx.points.set(r.id, {
        id: r.id,
        name: r.name,
        name_hanja: r.name_hanja,
        lat: r.lat,
        lng: r.lng,
        visible: r.status === "published",
        color: st.color,
        icon: st.icon
      });
    }
  }
  const po = byKind("post");
  if (po.length) {
    const rs = await db.prepare(`SELECT id, board, category, title, status FROM posts WHERE id IN (${po.map(() => "?").join(",")}) AND board NOT IN (${PRIVATE_BOARDS_SQL})`).bind(...po).all();
    for (const r of rs.results ?? []) {
      ctx.refs.set(`post:${r.id}`, { title: r.title, href: refHref("post", r), kindLabel: BOARD_LABEL[r.board] ?? "게시글", visible: r.status === "published" });
    }
  }
  return ctx;
}
function esc(t) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
/** 경전 문장의 [[대상]] / [[대상|별칭]] 표시 — 지금은 별칭 글자로만(관련링크 단계에서 승격) */
function wikiText(t) {
  return esc(t).replace(/\[\[([^\]]+)\]\]/g, (_, inner) => {
    const alias = inner.includes("|") ? inner.split("|").pop() : inner;
    return `<span class="wikiref">${alias.trim()}</span>`;
  });
}
export const stripWiki = (t) => (t ?? "").replace(/\[\[([^\]]+)\]\]/g, (_, inner) => (inner.includes("|") ? inner.split("|").pop() : inner).trim());
function paras(t) {
  return t.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.replace(/^\n+|\n+$/g, "")).filter((p) => p.trim()).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}
export function renderBlocks(blocks, ctx) {
  return blocks.map((b) => {
    const idAttr = ` id="b-${esc(b.id)}"`;
    if (b.type === "heading") {
      return `<h3 class="blk blk-heading"${idAttr}>${esc(b.text ?? "")}</h3>`;
    }
    if (b.type === "text") {
      return `<section class="blk blk-text"${idAttr}>${b.text ? paras(b.text) : ""}</section>`;
    }
    if (b.type === "verse") {
      const label = b.label ? `<h3 class="vlabel">${esc(b.label)}</h3>` : "";
      const ps = (b.lines ?? []).map((l) => `<p class="vs"${l.a ? ` id="${esc(l.a)}"` : ""}>${wikiText(l.t ?? "")}</p>`).join("");
      return `<section class="blk blk-verse"${idAttr}>${label}${ps}</section>`;
    }
    if (b.type === "quote") {
      let src = b.source ? esc(b.source) : "";
      if (b.source_ref) {
        const r = ctx.refs.get(`${b.source_ref.kind}:${b.source_ref.id}`);
        if (r && r.visible) {
          const an = b.source_ref.anchor;
          src = `<a class="ref-drawer" href="${esc(r.href)}${an ? `#${esc(encodeURIComponent(an))}` : ""}" data-drawer-kind="${b.source_ref.kind}" data-drawer-id="${esc(
            b.source_ref.id
          )}"${an ? ` data-drawer-anchor="${esc(an)}"` : ""} data-ref-title="${esc(r.title)}" data-ref-label="${esc(r.kindLabel)}">${b.source ? esc(b.source) : esc(r.title)}</a>`;
        }
      }
      return `<figure class="blk blk-quote"${idAttr}><blockquote>${paras(b.text ?? "")}</blockquote>${src ? `<figcaption>— ${src}</figcaption>` : ""}</figure>`;
    }
    if (b.type === "image") {
      const shown = imageItems(b).map((it) => {
        const m = it.media_id ? ctx.media.get(it.media_id) : it.key ? ctx.keys.get(it.key) : void 0;
        return m ? { m, cap: it.caption ?? m.caption ?? "" } : null;
      }).filter(Boolean);
      if (!shown.length) return "";
      const img = (x, alt) => `<img src="${esc(x.m.url)}" alt="${esc(x.m.alt ?? alt)}"${x.m.width && x.m.height ? ` width="${x.m.width}" height="${x.m.height}"` : ""} loading="lazy">`;
      if (shown.length === 1) {
        const cap = b.caption ?? shown[0].cap;
        return `<figure class="blk blk-image"${idAttr}>${img(shown[0], cap)}${cap ? `<figcaption>${esc(cap)}</figcaption>` : ""}</figure>`;
      }
      const cells = shown.map(
        (x) => `<figure class="g-item"><a href="${esc(x.m.url)}" target="_blank" rel="noopener">${img(x, x.cap)}</a>${x.cap ? `<figcaption>${esc(x.cap)}</figcaption>` : ""}</figure>`
      ).join("");
      return `<figure class="blk blk-image blk-gallery"${idAttr}><div class="blk-grid">${cells}</div>${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`;
    }
    if (b.type === "imageref") {
      const r = b.ref ? ctx.refs.get(`${b.ref.kind}:${b.ref.id}`) : void 0;
      const items = b.ref ? ctx.imgrefs.get(`${b.ref.kind}:${b.ref.id}:${b.block}`) : void 0;
      const shown = (items ?? []).map((it) => {
        const m = it.media_id ? ctx.media.get(it.media_id) : it.key ? ctx.keys.get(it.key) : void 0;
        return m ? { url: m.url, width: m.width || 0, height: m.height || 0, caption: it.caption ?? m.caption ?? "" } : null;
      }).filter(Boolean);
      if (!r || !r.visible || !shown.length) {
        return `<p class="blk blk-imgref"${idAttr}><span class="ref-missing">참조한 이미지가 삭제되었거나 공개되지 않았습니다</span></p>`;
      }
      const data = JSON.stringify({
        images: shown,
        caption: b.caption ?? "",
        source: { title: r.title, href: `${r.href}#b-${b.block}`, label: r.kindLabel }
      });
      const thumbs = shown.slice(0, 6).map(
        (x, i) => `<button type="button" class="imgref-thumb" data-viewer-index="${i}" aria-label="이미지 크게 보기"><img src="${esc(x.url)}" alt="${esc(
          x.caption
        )}" loading="lazy"></button>`
      ).join("");
      const more = shown.length > 6 ? `<span class="imgref-more">+${shown.length - 6}</span>` : "";
      return `<figure class="blk blk-imgref"${idAttr} data-viewer="${esc(data)}"><div class="imgref-thumbs">${thumbs}${more}</div><figcaption>${b.caption ? `${esc(b.caption)} · ` : ""}<span class="imgref-src">${esc(r.kindLabel)} · ${esc(r.title)}</span></figcaption></figure>`;
    }
    if (b.type === "map") {
      const p = b.point ? ctx.points.get(b.point) : void 0;
      if (!p || !p.visible) {
        return `<p class="blk blk-map is-missing"${idAttr}><span class="ref-missing">삭제되었거나 공개되지 않은 장소입니다</span></p>`;
      }
      return `<figure class="blk blk-map"${idAttr} data-map-point="${esc(p.id)}" data-name="${esc(p.name)}"${p.name_hanja ? ` data-hanja="${esc(p.name_hanja)}"` : ""} data-lat="${p.lat}" data-lng="${p.lng}" data-color="${esc(p.color)}" data-icon="${esc(p.icon)}"><button type="button" class="map-thumb" aria-label="${esc(
        `지도에서 보기: ${p.name}`
      )}"><span class="map-thumb-img" aria-hidden="true"></span><span class="map-thumb-mk" aria-hidden="true"></span></button><figcaption><strong>${esc(p.name)}</strong>${p.name_hanja ? ` <span class="hanja">${esc(p.name_hanja)}</span>` : ""}${b.caption ? ` · ${esc(b.caption)}` : ""}</figcaption></figure>`;
    }
    if (b.type === "video") {
      const title = b.caption ?? "영상";
      return `<figure class="blk blk-video"${idAttr}><div class="blk-video-frame"><iframe src="https://www.youtube.com/embed/${esc(
        b.video_id ?? ""
      )}" title="${esc(title)}" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"></iframe></div>${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`;
    }
    if (b.type === "link") {
      if (b.ref) {
        const r = ctx.refs.get(`${b.ref.kind}:${b.ref.id}`);
        if (!r || !r.visible) {
          return `<p class="blk blk-link"${idAttr}><span class="ref-missing">삭제되었거나 공개되지 않은 자료입니다</span></p>`;
        }
        return `<p class="blk blk-link"${idAttr}><a class="ref-link" href="${esc(r.href)}" data-ref-kind="${b.ref.kind}" data-ref-id="${esc(
          b.ref.id
        )}" data-ref-title="${esc(r.title)}" data-ref-label="${esc(r.kindLabel)}"><span class="ref-kind">${esc(r.kindLabel)}</span>${esc(r.title)}</a></p>`;
      }
      const external = /^https?:\/\//i.test(b.url ?? "");
      return `<p class="blk blk-link"${idAttr}><a class="ext-link" href="${esc(b.url ?? "#")}"${external ? ' target="_blank" rel="noopener nofollow"' : ""}>${esc(b.label ?? b.url ?? "")}${external ? ' <span aria-hidden="true">↗</span>' : ""}</a></p>`;
    }
    return "";
  }).join("\n");
}
export function plainFromBlocks(blocks, ctx) {
  return blocks.map((b) => {
    if (b.type === "heading" || b.type === "text") return b.text ?? "";
    if (b.type === "verse") return [b.label, ...(b.lines ?? []).map((l) => stripWiki(l.t))].filter(Boolean).join("\n");
    if (b.type === "quote") return [b.text, b.source ? `— ${b.source}` : ""].filter(Boolean).join("\n");
    if (b.type === "image") return [b.caption, ...imageItems(b).map((i) => i.caption)].filter(Boolean).join("\n");
    if (b.type === "video" || b.type === "imageref") return b.caption ?? "";
    if (b.type === "link") return b.ref ? ctx?.refs.get(`${b.ref.kind}:${b.ref.id}`)?.title ?? "" : b.label ?? "";
    if (b.type === "map") return [b.point ? ctx?.points.get(b.point)?.name : "", b.caption].filter(Boolean).join(" · ");
    return "";
  }).filter((x) => x && x.trim()).join("\n\n");
}
export function blocksForEditor(blocks, ctx) {
  return blocks.map((b) => {
    if (b.type === "image") {
      const { media_id, key, ...rest } = b;
      return {
        ...rest,
        items: imageItems(b).map((it) => {
          const m = it.media_id ? ctx.media.get(it.media_id) : it.key ? ctx.keys.get(it.key) : void 0;
          return { ...it, view_url: m?.url ?? null };
        })
      };
    }
    if (b.type === "imageref" && b.ref) {
      const r = ctx.refs.get(`${b.ref.kind}:${b.ref.id}`);
      const items = ctx.imgrefs.get(`${b.ref.kind}:${b.ref.id}:${b.block}`) ?? [];
      const thumbs = items.map((it) => it.media_id ? ctx.media.get(it.media_id)?.url : it.key ? ctx.keys.get(it.key)?.url : void 0).filter(Boolean);
      return { ...b, view_title: r?.title ?? null, view_href: r?.href ?? null, view_kind: r?.kindLabel ?? null, view_thumbs: thumbs };
    }
    if (b.type === "quote" && b.source_ref) {
      const r = ctx.refs.get(`${b.source_ref.kind}:${b.source_ref.id}`);
      return { ...b, view_title: r?.title ?? null, view_href: r?.href ?? null, view_kind: r?.kindLabel ?? null };
    }
    if (b.type === "link" && b.ref) {
      const r = ctx.refs.get(`${b.ref.kind}:${b.ref.id}`);
      return { ...b, view_title: r?.title ?? null, view_href: r?.href ?? null, view_kind: r?.kindLabel ?? null };
    }
    if (b.type === "map" && b.point) {
      const p = ctx.points.get(b.point);
      return {
        ...b,
        view_title: p?.name ?? null,
        view_kind: p ? p.visible ? "지도 장소" : "비공개 장소" : null,
        view_point: p ? { lat: p.lat, lng: p.lng, color: p.color, icon: p.icon, name_hanja: p.name_hanja, visible: p.visible } : null
      };
    }
    return b;
  });
}
export function blocksFromLegacy(bodyMd) {
  let t = (bodyMd ?? "").replace(/\r\n/g, "\n");
  t = t.replace(/^\s*#\s+[^\n]*\n?/, "");
  t = t.split("\n").map((l) => l.replace(/^>\s?/, "")).join("\n").trim();
  return t ? [{ id: newId(), type: "text", text: t }] : [];
}
export function parseStoredBlocks(raw) {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
export function refsOf(blocks) {
  return blocks.flatMap((b) => {
    if (b.type === "map") return b.point ? [{ block_id: b.id, kind: "point", id: b.point }] : [];
    const r = blockRef(b);
    return r ? [{ block_id: b.id, kind: r.kind, id: r.id }] : [];
  });
}

