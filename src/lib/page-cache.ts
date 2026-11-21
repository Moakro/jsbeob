// 비회원 페이지 캐시 (2026-11-21) — 로그인하지 않은 방문자의 공개 페이지를 Cloudflare 에지 캐시(caches.default)에
// TTL 초 동안 저장해 두고 바로 내보낸다. 한국 접속이 LAX 로 붙어 페이지마다 API·D1 왕복이 길어서다.
// - 로그인(jb_session 쿠키)한 사람은 언제나 새로 그린다(작성 중 글·관리 버튼 등이 사람마다 다르므로).
// - 관리·계정·로그인·API·글쓰기/수정·미리보기(?preview=1) 주소는 캐시하지 않는다.
// - 200 HTML/XML 이고 Set-Cookie 가 없는 응답만 저장한다.
// 글을 고치면 비회원에게는 최대 TTL 동안 예전 내용이 보일 수 있다(관리자는 로그인 상태라 바로 새 내용).
// 응답 헤더 X-Page-Cache: HIT | MISS 로 확인할 수 있다.

export const PAGE_CACHE_TTL = 300; // 5분

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
