// 옛 홈페이지 주소(/_ort/?cId=… 등)를 새 주소로 영구 이동(301) — 공식 도메인 이전 (2026-11-21).
// 규칙은 src/lib/old-urls.ts. 새 사이트에는 '/_' 로 시작하는 페이지가 없어 다른 주소와 겹치지 않는다.
import { defineMiddleware } from "astro:middleware";

declare const __BUILD_ID__: string;
import { oldUrlTarget } from "./lib/old-urls";
import { isCacheable, isStorable, ttlFor, withCacheHeaders } from "./lib/page-cache";
import { failedRenders } from "./lib/content";

export const onRequest = defineMiddleware(async (ctx, next) => {
  // www.jsbeob.com → jsbeob.com (주소 하나로 — 검색 중복 방지, 2026-11-21)
  // ctx.url 은 astro.config 의 site 로 맞춰질 수 있어 실제 요청 주소(request.url)·Host 로 본다
  const reqUrl = new URL(ctx.request.url);
  const host = (ctx.request.headers.get("host") ?? reqUrl.host).toLowerCase();
  if (host === "www.jsbeob.com" || reqUrl.hostname === "www.jsbeob.com") {
    const to = new URL(reqUrl.pathname + reqUrl.search, "https://jsbeob.com");
    return new Response(null, { status: 301, headers: { Location: to.toString() } });
  }
  const p = ctx.url.pathname;
  if (p.startsWith("/_") && !p.startsWith("/_astro/") && !p.startsWith("/_image") && !p.startsWith("/_server-islands/")) {
    const to = oldUrlTarget(ctx.url);
    if (to) return new Response(null, { status: 301, headers: { Location: to } });
  } else if (p.startsWith("/bbs/") || p === "/index.php") {
    const to = oldUrlTarget(ctx.url);
    if (to) return new Response(null, { status: 301, headers: { Location: to } });
  }
  // 비회원 페이지 캐시 — src/lib/page-cache.ts
  const edge = (globalThis as any).caches?.default as Cache | undefined;
  // 로컬 개발(astro dev)에서는 캐시하지 않는다 — 고친 화면이 5분 동안 안 보이는 혼란을 막는다
  if (import.meta.env.DEV || !edge || !isCacheable(ctx.request, reqUrl)) return next();
  // 캐시 키에 빌드 번호를 붙인다 — 배포가 바뀌면 예전 저장본(사라진 CSS·JS 를 가리키는 HTML)을 쓰지 않는다
  const keyUrl = new URL(reqUrl);
  keyUrl.searchParams.set("__build", __BUILD_ID__);
  const key = new Request(keyUrl.toString(), { method: "GET" });
  const hit = await edge.match(key).catch(() => undefined);
  if (hit) return withCacheHeaders(hit, "HIT");
  const res = await next();
  // 자료 API 가 실패한 채 그린 화면은 저장하지 않는다
  if (!isStorable(res) || failedRenders.has(ctx.request)) return res;
  const store = new Response(res.clone().body, res);
  const ttl = ttlFor(reqUrl);
  store.headers.set("Cache-Control", `public, s-maxage=${ttl}, max-age=${ttl}`);
  store.headers.delete("X-Page-Cache");
  const put = edge.put(key, store).catch(() => {});
  const wait = (ctx.locals as any).cfContext?.waitUntil;
  if (wait) wait.call((ctx.locals as any).cfContext, put);
  else await put;
  return withCacheHeaders(res, "MISS");
});
