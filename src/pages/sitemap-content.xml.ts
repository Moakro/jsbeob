// API 에서 만드는 자료(소개 글·자료실 글·장소)의 사이트맵. 정적 페이지는 @astrojs/sitemap 의 sitemap-index.xml.
// 복원(2026-11-05): 배포본 서버 청크(sitemap-content_*.mjs) 그대로.
import type { APIRoute } from "astro";
import { listArticles, listPlaces } from "../lib/content";

export const prerender = false;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const GET: APIRoute = async ({ request, site }) => {
  const base = (site?.toString() ?? new URL(request.url).origin + "/").replace(/\/$/, "");
  const [about, library, places] = await Promise.all([
    // 방문자 기준(작성 중 제외) — 운영자가 열어도 같은 결과
    listArticles(request, "about", undefined, { anon: true }),
    listArticles(request, "library", undefined, { anon: true }),
    listPlaces(request, undefined, { anon: true }),
  ]);
  const urls = [
    ...about.map((a: any) => ({ loc: `/about/${a.slug}/`, lastmod: a.updated_at })),
    // 자료실 정형 자료 /archive/<분류>/<slug>/ — 아래에서 encodeURI 하므로 여기서는 인코딩하지 않는다
    ...library.map((a: any) => ({ loc: `/archive/${a.kind}/${a.slug}/`, lastmod: a.updated_at })),
    ...places.map((p: any) => ({
      loc: p.kind === "jeongak" ? `/jeongak/${p.slug}/` : `/archive/places/${p.slug}/`,
      lastmod: p.updated_at,
    })),
  ];
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
` +
    urls
      .map((u) => {
        const loc = esc(base + encodeURI(u.loc));
        const lm = u.lastmod ? `<lastmod>${u.lastmod.slice(0, 10)}</lastmod>` : "";
        return `  <url><loc>${loc}</loc>${lm}</url>`;
      })
      .join("\n") +
    `
</urlset>
`;
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
};
