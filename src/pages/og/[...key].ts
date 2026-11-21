// 공유 미리보기(OG)용 사진 — 업로드 사진(WebP)을 1200px JPG 로 바꿔 내보낸다 (2026-11-21)
// 밴드 등 일부 서비스가 WebP 미리보기를 쓰지 않아서. 예: /og/comments/2026/11/21/07/<uid>/<id>.jpg
//   → API 의 /api/files/comments/…/<id>.webp 를 읽어 Cloudflare Images(IMAGES 바인딩)로 변환.
// 변환 결과는 에지 캐시에 오래 둔다(파일 이름이 바뀌지 않는 업로드 사진이라).
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

export const prerender = false;

const KEY_RE = /^(comments|media)\/[A-Za-z0-9/_-]+\.jpg$/;

export const GET: APIRoute = async ({ params, request, locals }) => {
  const key = params.key ?? "";
  if (!KEY_RE.test(key) || key.includes("..")) return new Response("not found", { status: 404 });
  const edge = (globalThis as any).caches?.default as Cache | undefined;
  const cacheKey = new Request(new URL(`/og/${key}`, request.url).toString());
  const hit = await edge?.match(cacheKey).catch(() => undefined);
  if (hit) return hit;

  const api = (env as any).API as Fetcher | undefined;
  const images = (env as any).IMAGES as ImagesBinding | undefined;
  if (!api) return new Response("api binding missing", { status: 502 });
  const srcKey = key.replace(/\.jpg$/, ".webp");
  const src = await api.fetch(new Request(new URL(`/api/files/${srcKey}`, request.url)));
  if (!src.ok || !src.body) return new Response("not found", { status: 404 });
  // 변환 기능이 없으면(로컬 등) 원본을 그대로
  if (!images) return new Response(src.body, { headers: { "Content-Type": src.headers.get("Content-Type") ?? "image/webp" } });

  const out = await images
    .input(src.body)
    // 공유 미리보기 표준 비율 1200×630 으로 가운데를 잘라 채운다(세로 사진도 칸에 꽉 차게)
    .transform({ width: 1200, height: 630, fit: "cover" })
    .output({ format: "image/jpeg", quality: 82 });
  const res = new Response(out.image(), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" },
  });
  const put = edge?.put(cacheKey, res.clone()).catch(() => {});
  const wait = (locals as any).cfContext?.waitUntil;
  if (put && wait) wait.call((locals as any).cfContext, put);
  return res;
};
