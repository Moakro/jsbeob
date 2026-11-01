// 미디어(유튜브 영상) API (/api/media/*)
// 복원: 2026-11-01 배포본(jsbeob-api-preview) 번들에서 복원. 원본 TS 타입 정보는 번들에서 사라져
// 대부분 생략되었다(tsconfig strict:false). 동작은 배포본과 같다.
import { s } from "./blocks";

async function loadSettings(env) {
  const rs = await env.DB.prepare("SELECT video_id, featured, hidden FROM media_videos").all();
  return new Map((rs.results ?? []).map((r) => [r.video_id, r]));
}
const ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const TTL = 1800;
function json(body, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store"
    }
  });
}
function uploadsPlaylist(cid, type) {
  return (type === "all" ? "UU" : type === "shorts" ? "UUSH" : "UULF") + cid.slice(2);
}
async function loadVideos(env, cid, type) {
  const key = env.YOUTUBE_API_KEY?.trim();
  if (key) {
    try {
      return await loadFromApi(key, uploadsPlaylist(cid, type));
    } catch (e) {
      console.warn("YouTube Data API 실패 — RSS로 대신함:", e instanceof Error ? e.message : e);
    }
  }
  return loadFeed(feedUrl(cid, type));
}
function feedUrl(cid, type) {
  const q = type === "all" ? `channel_id=${cid}` : type === "shorts" ? `playlist_id=UUSH${cid.slice(2)}` : `playlist_id=UULF${cid.slice(2)}`;
  return `https://www.youtube.com/feeds/videos.xml?${q}`;
}
export async function handleMedia(req, env, path, ctx) {
  const m = req.method;
  if (path === "/api/media/videos" && m === "GET") return publicVideos(req, env);
  if (path === "/api/admin/media-videos" || path.startsWith("/api/admin/media-videos/")) {
    const admin = await ctx.adminUser(req);
    if (!admin) return json({ error: "운영자만 사용할 수 있습니다" }, 403);
    if (path === "/api/admin/media-videos" && m === "GET") return adminVideos(env);
    const r = path.match(/^\/api\/admin\/media-videos\/([\w-]{11})$/);
    if (r && m === "PUT") return adminSaveVideo(req, env, r[1], admin.id);
    return json({ error: "not found" }, 404);
  }
  return null;
}
async function publicVideos(req, env) {
  const cid = env.YOUTUBE_CHANNEL_ID ?? "";
  if (!ID_RE.test(cid)) return json({ error: "유튜브 채널이 설정되지 않았습니다" }, 503);
  const type = new URL(req.url).searchParams.get("type") ?? "long";
  try {
    const [all, settings] = await Promise.all([loadVideos(env, cid, type), loadSettings(env)]);
    const hiddenIds = all.filter((v) => settings.get(v.id)?.hidden).map((v) => v.id);
    const shown = all.filter((v) => !settings.get(v.id)?.hidden).map((v) => ({ ...v, featured: !!settings.get(v.id)?.featured }));
    const fi = shown.findIndex((v) => v.featured);
    if (fi > 0) shown.unshift(...shown.splice(fi, 1));
    return json({ channel: { id: cid, url: `https://www.youtube.com/channel/${cid}` }, videos: shown, hidden_ids: hiddenIds }, 200, 60);
  } catch (e) {
    return json({ error: "유튜브 영상 목록을 불러오지 못했습니다", detail: e instanceof Error ? e.message : String(e) }, 502);
  }
}
async function adminVideos(env) {
  const cid = env.YOUTUBE_CHANNEL_ID ?? "";
  if (!ID_RE.test(cid)) return json({ error: "유튜브 채널이 설정되지 않았습니다" }, 503);
  try {
    const [all, settings] = await Promise.all([loadVideos(env, cid, "long"), loadSettings(env)]);
    return json({
      channel: { id: cid, url: `https://www.youtube.com/channel/${cid}` },
      videos: all.map((v) => ({ ...v, featured: !!settings.get(v.id)?.featured, hidden: !!settings.get(v.id)?.hidden }))
    });
  } catch (e) {
    return json({ error: "유튜브 영상 목록을 불러오지 못했습니다", detail: e instanceof Error ? e.message : String(e) }, 502);
  }
}
async function adminSaveVideo(req, env, id, uid) {
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") return json({ error: "잘못된 요청입니다" }, 400);
  const cur = (await loadSettings(env)).get(id);
  const featured = raw.featured === void 0 ? !!cur?.featured : !!raw.featured;
  const hidden = raw.hidden === void 0 ? !!cur?.hidden : !!raw.hidden;
  if (featured && hidden) return json({ error: "숨긴 영상은 대표 영상이 될 수 없습니다" }, 400);
  const stmts = [];
  if (featured) stmts.push(env.DB.prepare("UPDATE media_videos SET featured=0, updated_at=datetime('now') WHERE featured=1 AND video_id<>?").bind(id));
  stmts.push(
    env.DB.prepare(
      `INSERT INTO media_videos (video_id, featured, hidden, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET featured=excluded.featured, hidden=excluded.hidden, updated_by=excluded.updated_by, updated_at=datetime('now')`
    ).bind(id, featured ? 1 : 0, hidden ? 1 : 0, uid)
  );
  await env.DB.batch(stmts);
  return json({ ok: true, video: { id, featured, hidden } });
}
const API = "https://www.googleapis.com/youtube/v3";
const MAX_PAGES = 20;
async function loadFromApi(apiKey, playlistId) {
  const cache = globalThis.caches?.default;
  const base = `https://jsbeob-cache.invalid/yt-api/${playlistId}`;
  const key = new Request(base);
  const fresh = new Request(`${base}?fresh=1`);
  const hit = await cache?.match(fresh).catch(() => void 0);
  if (hit) return await hit.json();
  try {
    const videos = await fetchPlaylist(apiKey, playlistId);
    if (cache) {
      const body = JSON.stringify(videos);
      const put = (k, age) => cache.put(k, new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${age}` } }));
      await Promise.all([put(fresh, TTL), put(key, 7 * 24 * 3600)]).catch(() => {
      });
    }
    return videos;
  } catch (e) {
    const stale = await cache?.match(key).catch(() => void 0);
    if (stale) return await stale.json();
    throw e;
  }
}
async function ytGet(path, params, apiKey) {
  const q = new URLSearchParams({ ...params, key: apiKey });
  const res = await fetch(`${API}/${path}?${q}`);
  if (!res.ok) {
    const reason = (await res.json().catch(() => null))?.error?.errors?.[0]?.reason ?? "";
    throw new Error(`YouTube API ${path} ${res.status} ${reason}`.trim());
  }
  return res.json();
}
async function fetchPlaylist(apiKey, playlistId) {
  const items = [];
  let pageToken = "";
  for (let i = 0; i < MAX_PAGES; i++) {
    const d = await ytGet(
      "playlistItems",
      { part: "snippet,contentDetails,status", maxResults: "50", playlistId, ...pageToken ? { pageToken } : {} },
      apiKey
    );
    for (const it of d.items ?? []) {
      const id = it.contentDetails?.videoId ?? it.snippet?.resourceId?.videoId;
      if (!/^[\w-]{11}$/.test(id ?? "") || it.status?.privacyStatus !== "public") continue;
      items.push({
        id,
        title: it.snippet?.title ?? "",
        published: it.contentDetails?.videoPublishedAt ?? it.snippet?.publishedAt ?? "",
        description: it.snippet?.description ?? "",
        hd: !!it.snippet?.thumbnails?.maxres
      });
    }
    pageToken = d.nextPageToken ?? "";
    if (!pageToken) break;
  }
  const views = new Map();
  for (let i = 0; i < items.length; i += 50) {
    const ids = items.slice(i, i + 50).map((v) => v.id).join(",");
    const d = await ytGet("videos", { part: "statistics", id: ids, maxResults: "50" }, apiKey);
    for (const v of d.items ?? []) if (v.statistics?.viewCount != null) views.set(v.id, Number(v.statistics.viewCount));
  }
  items.sort((a, b) => b.published.localeCompare(a.published));
  return items.map((v) => ({
    id: v.id,
    title: v.title,
    published: v.published,
    description: v.description,
    views: views.get(v.id) ?? null,
    url: `https://www.youtube.com/watch?v=${v.id}`,
    thumb: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
    // hq720 은 HD 영상에만 있다 — 옛 SD 영상은 hqdefault(4:3, 화면에서 cover 로 잘림)
    thumb_lg: v.hd ? `https://i.ytimg.com/vi/${v.id}/hq720.jpg` : `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`
  }));
}
async function loadFeed(feedUrl2) {
  const cache = globalThis.caches?.default;
  const key = new Request(feedUrl2);
  const fresh = new Request(`${feedUrl2}&_fresh=1`);
  const hit = await cache?.match(fresh).catch(() => void 0);
  if (hit) return parseFeed(await hit.text());
  try {
    const res = await fetch(feedUrl2, { headers: { "User-Agent": "Mozilla/5.0 (jsbeob.com media)" } });
    if (!res.ok) throw new Error(`YouTube ${res.status}`);
    const xml = await res.text();
    const videos = parseFeed(xml);
    if (cache) {
      const put = (k, age) => cache.put(k, new Response(xml, { headers: { "Content-Type": "application/xml", "Cache-Control": `public, max-age=${age}` } }));
      await Promise.all([put(fresh, TTL), put(key, 7 * 24 * 3600)]).catch(() => {
      });
    }
    return videos;
  } catch (e) {
    const stale = await cache?.match(key).catch(() => void 0);
    if (stale) return parseFeed(await stale.text());
    throw e;
  }
}
function decode(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
}
function parseFeed(xml) {
  const out = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const tag = (t) => decode((e.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) ?? [])[1] ?? "").trim();
    const id = tag("yt:videoId");
    if (!/^[\w-]{11}$/.test(id)) continue;
    const views = e.match(/<media:statistics[^>]*views="(\d+)"/);
    out.push({
      id,
      title: tag("title"),
      published: tag("published"),
      description: tag("media:description"),
      views: views ? Number(views[1]) : null,
      url: `https://www.youtube.com/watch?v=${id}`,
      thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      thumb_lg: `https://i.ytimg.com/vi/${id}/hq720.jpg`
    });
  }
  return out;
}

