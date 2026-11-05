// /api/* 를 그대로 API Worker(jsbeob-api-preview, service binding "API")로 넘긴다.
// 브라우저는 같은 출처의 /api/... 를 부르고, 사이트 Worker 가 이 경로로 API 에 전달한다.
// (로컬 dev 에서는 astro.config 의 vite proxy 가 먼저 받아 8788 로 보낸다.)
// 복원(2026-11-05): 배포본 서버 청크(_.._*.mjs) 그대로.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

export const prerender = false;

export const ALL: APIRoute = async ({ request }) => {
  const api = (env as any).API as Fetcher | undefined;
  if (!api) {
    return new Response(JSON.stringify({ error: "api binding missing" }), {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  return api.fetch(request);
};
