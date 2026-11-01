// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // 운영 도메인 — sitemap·RSS 절대 URL 생성에 사용. 도메인 변경 시 여기 한 곳만 수정.
  site: 'https://jsbeob.com',

  // 옛 커뮤니티 게시판 주소 → 자료실로 이전 (복원 근거: 배포본 config digest의 redirects)
  redirects: {
    '/community/book': '/archive/book/',
    '/community/mantra': '/archive/mantra/',
    '/community/ritual': '/archive/',
    '/community/etc': '/archive/etc/',
    '/community/orialter': '/community/',
    '/community/news': '/community/#news',
  },

  integrations: [
    svelte(),
    sitemap({
      filter: (page) => !page.includes('/admin/'),
    }),
  ],

  vite: {
    server: {
      // Tailscale magic-DNS + localhost 허용 — 홈 서버(azgianlab)에서 돌리는
      // dev 빌드를 Tailnet 내 어느 기기에서나 미리보기. production(CF Pages)엔 무영향.
      allowedHosts: ['azgianlab', 'localhost', '127.0.0.1', '.ts.net'],
      // dev에서 /api/* → 로컬 jsbeob-api worker(wrangler dev :8788)로 프록시.
      // production(CF Pages)에서는 worker가 jsbeob.com/api/* 라우트로 직접 처리.
      proxy: {
        '/api': {
          target: 'http://localhost:8788',
          changeOrigin: true,
        },
      },
    },
  },

  // dev 모드에서 workerd 런타임 emulation 비활성 — node SSR로 단순화.
  // production 빌드(Pages)는 영향 없음.
  adapter: cloudflare({
    platformProxy: { enabled: false },
  }),
});
