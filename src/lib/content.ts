// SSR 데이터 조회 — 자료·장소·지도·홈·소식 등을 jsbeob-api(env.API service binding)에서 읽는다.
// 복원(2026-11-01): 배포본 서버 청크(content_*.mjs) 기준.
import { env } from "cloudflare:workers";
import { DEFAULT_LIBRARY_CATEGORIES } from "./library";

type Opts = { preview?: boolean; viewer?: boolean };

/**
 * API GET. preview/viewer 요청이면 쿠키를 넘겨 로그인 사용자 기준(초안 보기 등)으로 받는다.
 * env.API(service binding)가 있으면 그것으로, 없으면(dev) 같은 출처 fetch.
 */
async function contentGet(path: string, request: Request, opts: Opts = {}): Promise<any> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.preview || opts.viewer) {
    const cookie = request.headers.get("cookie");
    if (cookie) headers.Cookie = cookie;
  }
  const target = new URL(path, request.url).toString();
  const api = (env as any).API as Fetcher | undefined;
  const res = api ? await api.fetch(new Request(target, { headers })) : await fetch(target, { headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`자료 API 오류 ${res.status} (${path}) ${detail}`);
  }
  return await res.json();
}

export const listArticles = async (request: Request, section: string, kind?: string, opts: { anon?: boolean } = {}) =>
  (
    await contentGet(`/api/content/articles?section=${section}${kind ? `&kind=${kind}` : ""}`, request, {
      viewer: !opts.anon,
    })
  )?.articles ?? [];

export const getArticle = async (request: Request, section: string, slug: string, preview = false) =>
  (
    await contentGet(
      `/api/content/articles/${section}/${encodeURIComponent(slug)}${preview ? "?preview=1" : ""}`,
      request,
      { preview, viewer: true },
    )
  )?.article ?? null;

export const listPlaces = async (request: Request, kind?: string, opts: { anon?: boolean } = {}) =>
  (await contentGet(`/api/content/places${kind ? `?kind=${kind}` : ""}`, request, { viewer: !opts.anon }))?.places ?? [];

export const listMapPoints = async (request: Request) => {
  const r = await contentGet("/api/content/map-points", request);
  return { points: r?.points ?? [], tags: r?.tags ?? [] };
};

export const getPlace = async (request: Request, slug: string, preview = false) =>
  (
    await contentGet(`/api/content/places/${encodeURIComponent(slug)}${preview ? "?preview=1" : ""}`, request, {
      preview,
      viewer: true,
    })
  )?.place ?? null;

export const listVideos = async (request: Request) => {
  try {
    const r = await contentGet("/api/media/videos", request);
    return { videos: r?.videos ?? [], channelUrl: r?.channel?.url ?? null, hiddenIds: r?.hidden_ids ?? [] };
  } catch {
    return { videos: [], channelUrl: null, hiddenIds: [] };
  }
};

export const listHomeTiles = async (request: Request) =>
  (await contentGet("/api/content/home-tiles", request).catch(() => null))?.items ?? [];

export const getHomeHero = async (request: Request) =>
  (await contentGet("/api/content/home-hero", request).catch(() => null))?.mobile ?? null;

export const listRecentPhotos = async (request: Request, limit = 9) => {
  const r = await contentGet(`/api/posts?board=orialter&has_image=1&limit=${limit}`, request).catch(() => null);
  const out: { id: string; url: string }[] = [];
  for (const p of r?.posts ?? []) {
    for (const a of p.attachments) if (a.type === "image" && a.url && out.length < limit) out.push({ id: p.id, url: a.url });
  }
  return out;
};

export const listRecentOrialter = async (request: Request, limit = 5) =>
  (await contentGet(`/api/posts?board=orialter&limit=${limit}`, request).catch(() => null))?.posts ?? [];

export const listRecentNews = async (request: Request, limit = 4) =>
  (await contentGet(`/api/posts?board=news&limit=${limit}`, request).catch(() => null))?.posts ?? [];

export const listLibraryCategories = async (request: Request) =>
  (await contentGet("/api/library/categories", request).catch(() => null))?.categories ?? DEFAULT_LIBRARY_CATEGORIES;

export const listLibraryPosts = async (
  request: Request,
  category: string,
  opts: { limit?: number; before?: string | null } = {},
) =>
  (await contentGet(
    `/api/library/posts?category=${encodeURIComponent(category)}&limit=${opts.limit ?? 20}${
      opts.before ? `&before=${encodeURIComponent(opts.before)}` : ""
    }`,
    request,
  ).catch(() => null)) ?? { items: [], next: null };

export const getLibraryPostMeta = async (request: Request, id: string) =>
  (await contentGet(`/api/library/posts/${encodeURIComponent(id)}/meta`, request))?.post ?? null;

export const getSeriesToc = async (request: Request, id: string) =>
  await contentGet(`/api/library/series/${encodeURIComponent(id)}`, request).catch(() => null);

// 자료실 상수·경로는 library.ts 에 있다(클라이언트도 쓰므로). 배포본 서버 청크처럼 여기서도 내보낸다.
export {
  DEFAULT_LIBRARY_CATEGORIES,
  LIBRARY_BOARD,
  SCRIPTURE_CATEGORY,
  SERIES_ICON_PATH,
  articleHref,
  catHref,
  chapterHref,
  libPostHref,
  scriptureHref,
  sortForCategory,
} from "./library";
