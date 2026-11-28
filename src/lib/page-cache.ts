// 비회원 페이지 캐시 (2026-11-21) — 로그인하지 않은 방문자의 공개 페이지를 Cloudflare 에지 캐시(caches.default)에
// TTL 초 동안 저장해 두고 바로 내보낸다. 한국 접속이 LAX 로 붙어 페이지마다 API·D1 왕복이 길어서다.
// - 로그인(jb_session 쿠키)한 사람은 언제나 새로 그린다(작성 중 글·관리 버튼 등이 사람마다 다르므로).
// - 관리·계정·로그인·API·글쓰기/수정·미리보기(?preview=1) 주소는 캐시하지 않는다.
// - 200 HTML/XML 이고 Set-Cookie 가 없는 응답만 저장한다.
// 글을 공개·비공개·저장·삭제하면 바로 비회원에게도 반영된다(2026-11-28): 캐시 키에 '콘텐츠 버전'을 넣고,
// 내용을 바꾸는 API 요청이 성공하면 사이트 Worker(/api 프록시)가 버전을 올린다. 예전 키는 아무도 찾지 않아 TTL 뒤 사라진다.
// 버전은 KV(SESSION 바인딩, @astrojs/cloudflare 가 자동으로 붙임)에 둔다 — caches.default.delete 는 그 에지 위치(POP)만
// 지우지만 KV 값은 전 세계가 같은 값을 읽는다(쓴 위치는 곧바로, 다른 위치는 KV 캐시가 풀리는 최대 약 60초 안).
// 응답 헤더 X-Page-Cache: HIT | MISS 로 확인할 수 있다.

export const PAGE_CACHE_TTL = 300; // 5분
/** 옛 글 보관함은 바뀌지 않는 데이터라 하루 (크롤러가 글마다 들어와도 하루 한 번만 그린다) */
export const LEGACY_CACHE_TTL = 86400;
export const ttlFor = (url: URL) => (url.pathname.startsWith("/legacy/") ? LEGACY_CACHE_TTL : PAGE_CACHE_TTL);

const SESSION_COOKIE = "jb_session";
const SKIP_PREFIX = ["/admin", "/account", "/login", "/api/", "/_astro/", "/_image", "/_server-islands/"];

export function isCacheable(req: Request, url: URL): boolean {
  if (req.method !== "GET") return false;
  if (new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=`).test(req.headers.get("cookie") ?? "")) return false;
  const p = url.pathname;
  if (SKIP_PREFIX.some((s) => p === s || p.startsWith(s))) return false;
  if (/\/(write|edit)\/?$/.test(p)) return false;
  if (url.searchParams.has("preview")) return false;
  return true;
}

/** 캐시에 넣어도 되는 응답인가 */
export function isStorable(res: Response): boolean {
  if (res.status !== 200 || res.headers.has("set-cookie")) return false;
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("text/html") || ct.includes("xml");
}

/** 브라우저에는 저장하지 말고 매번 묻게(로그인 직후 예전 비회원 화면이 남지 않게) */
export function withCacheHeaders(res: Response, state: "HIT" | "MISS"): Response {
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "private, no-cache");
  out.headers.set("X-Page-Cache", state);
  return out;
}

// ── 콘텐츠 버전 ──
const VERSION_KEY = "page-cache:version";

/** 지금 콘텐츠 버전. 못 읽으면 null(그때는 캐시를 쓰지 않고 새로 그린다) */
export async function contentVersion(kv: KVNamespace | undefined): Promise<string | null> {
  if (!kv) return null;
  try {
    return (await kv.get(VERSION_KEY)) ?? "0";
  } catch {
    return null;
  }
}

/** 공개 화면과 상관없는 쓰기(로그인·방문·댓글·사진 올리기·올림함 접수) — 버전을 올리지 않는다.
 *  댓글은 화면이 /api 로 따로 불러오므로 페이지 캐시에 들어 있지 않다. */
const NO_BUMP = /^\/api\/(?:auth|me|visits|comments|upload|intake)(?:\/|$)/;

/** 이 /api 요청이 성공했으면 공개 페이지 내용이 바뀌었을 수 있는가 */
export function changesContent(req: Request, res: Response): boolean {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return false;
  if (!res.ok) return false;
  return !NO_BUMP.test(new URL(req.url).pathname);
}

/** 버전을 올린다 — 이후 모든 비회원 페이지는 새 키로 찾으니 한 번씩 새로 그려진다 */
export async function bumpContentVersion(kv: KVNamespace | undefined): Promise<void> {
  if (!kv) return;
  try {
    await kv.put(VERSION_KEY, Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  } catch {
    /* 못 올리면 예전처럼 TTL 뒤 반영 */
  }
}
