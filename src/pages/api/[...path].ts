// /api/* 를 그대로 API Worker(jsbeob-api-preview, service binding "API")로 넘긴다.
// 브라우저는 같은 출처의 /api/... 를 부르고, 사이트 Worker 가 이 경로로 API 에 전달한다.
// (로컬 dev 에서는 astro.config 의 vite proxy 가 먼저 받아 8788 로 보낸다.)
// 복원(2026-11-05): 배포본 서버 청크(_.._*.mjs) 그대로.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { bumpContentVersion, changesContent } from "../../lib/page-cache";

export const prerender = false;

export const ALL: APIRoute = async ({ request }) => {
  const api = (env as any).API as Fetcher | undefined;
  if (!api) {
    return new Response(JSON.stringify({ error: "api binding missing" }), {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  const res = await api.fetch(request);
  // 글 공개·비공개·저장·삭제 등이 성공하면 비회원 페이지 캐시 버전을 올린다(응답 전에 끝내 바로 다음 화면부터 새 내용)
  if (changesContent(request, res)) await bumpContentVersion((env as any).SESSION);
  return res;
};
