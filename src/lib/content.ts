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

/** 지부·분원 공개 목록 (2026-11-06) — 소개 > 지부·분원 페이지 */
export const listBranches = async (request: Request): Promise<any[]> =>
  (await contentGet("/api/content/branches", request))?.items ?? [];

/** 옛 홈페이지 보관함 (2026-11-12) — 읽기 전용 */
export const legacyCategories = async (request: Request): Promise<any[]> =>
  (await contentGet("/api/legacy/categories", request))?.items ?? [];

export const listLegacy = async (
  request: Request,
  p: { board?: string; category?: string; q?: string; page?: number },
): Promise<{ items: any[]; total: number; page: number; pages: number }> => {
  const sp = new URLSearchParams();
  if (p.board) sp.set("board", p.board);
  if (p.category) sp.set("category", p.category);
  if (p.q) sp.set("q", p.q);
  if (p.page && p.page > 1) sp.set("page", String(p.page));
  return (await contentGet(`/api/legacy/posts?${sp}`, request)) ?? { items: [], total: 0, page: 1, pages: 1 };
};

/** 글 + 댓글 + 아래 목록. cat: 글을 연 목록의 분류(없으면 게시판 전체 목록) */
export const getLegacy = async (request: Request, board: string, cid: string, lp?: number, cat?: string) => {
  const sp = new URLSearchParams();
  if (lp) sp.set("lp", String(lp));
  if (cat) sp.set("cat", cat);
  const qs = sp.toString();
  return await contentGet(`/api/legacy/posts/${encodeURIComponent(board)}/${encodeURIComponent(cid)}${qs ? `?${qs}` : ""}`, request);
};

/** 보관함 글 주소. cat: 분류 탭에서 열었으면 그 분류 — 글 보기의 분류 탭·아래 목록이 그 범위를 이어받는다(없으면 게시판 전체) */
export const legacyHref = (board: string, cid: number | string, cat?: string | null) =>
  `/legacy/${board}/${cid}/${cat ? `?cat=${encodeURIComponent(cat)}` : ""}`;

/** 보관함 게시판 — 옛 사이트의 게시판 이름과 분류 순서 그대로 (사용자 결정 2026-11-12: 오리알터(미디어방 제외)·시루학당)
 *  게시판 순서는 시루학당 → 오리알터 (사용자 지시 2026-11-14). 사이드바·서랍이 이 순서를 따른다. */
export const LEGACY_BOARDS: { board: string; name: string; cats: string[] }[] = [
  { board: "study", name: "시루학당", cats: ["주문과 수행", "경전 및 도서", "의식과 예법", "기타 자료실"] },
  { board: "ort", name: "오리알터", cats: ["법종교소식", "법종교앨범", "오리알터풍경", "도생광장", "열린마당"] },
];

export const legacyBoardName = (board: string) => LEGACY_BOARDS.find((b) => b.board === board)?.name ?? board;

export type LegacyGroup = { board: string; name: string; n: number; cats: { category: string; n: number }[] };

/** /api/legacy/categories 결과([{board, category, n}])를 게시판별로 묶는다. 정해 둔 순서를 따르고, 모르는 것은 뒤에 붙인다. */
export const legacyGroups = (rows: { board: string; category: string | null; n: number }[]): LegacyGroup[] => {
  const order = [...LEGACY_BOARDS.map((b) => b.board), ...rows.map((r) => r.board)].filter((b, i, a) => a.indexOf(b) === i);
  return order
    .map((board) => {
      const known = LEGACY_BOARDS.find((b) => b.board === board)?.cats ?? [];
      const mine = rows.filter((r) => r.board === board);
      const rank = (c: string) => (known.indexOf(c) < 0 ? 999 : known.indexOf(c));
      const cats = mine
        .map((r) => ({ category: r.category ?? "기타", n: Number(r.n) || 0 }))
        .sort((a, b) => rank(a.category) - rank(b.category));
      return { board, name: legacyBoardName(board), n: cats.reduce((s, c) => s + c.n, 0), cats };
    })
    .filter((g) => g.cats.length > 0);
};

/** 보관함 목록 주소 (게시판·분류·검색어·쪽) */
export const legacyListHref = (o: { board?: string; category?: string; q?: string; page?: number }) => {
  const p = new URLSearchParams();
  if (o.board) p.set("board", o.board);
  if (o.category) p.set("category", o.category);
  if (o.q) p.set("q", o.q);
  if (o.page && o.page > 1) p.set("page", String(o.page));
  const s = p.toString();
  return "/legacy/" + (s ? `?${s}` : "");
};
