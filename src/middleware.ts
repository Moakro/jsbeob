// 옛 홈페이지 주소(/_ort/?cId=… 등)를 새 주소로 영구 이동(301) — 공식 도메인 이전 (2026-11-21).
// 규칙은 src/lib/old-urls.ts. 새 사이트에는 '/_' 로 시작하는 페이지가 없어 다른 주소와 겹치지 않는다.
import { defineMiddleware } from "astro:middleware";
import { oldUrlTarget } from "./lib/old-urls";

export const onRequest = defineMiddleware((ctx, next) => {
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
  return next();
});
