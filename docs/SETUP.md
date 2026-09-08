# jsbeob 셋업 가이드

증산법종교 홈페이지. **Astro 6 + Svelte 5 (프론트, Cloudflare Pages)** + **jsbeob-api (게시판/인증 worker, Cloudflare Workers + D1 + R2)**.

## 로컬 개발

### 1. 프론트 (Astro)
```bash
nvm use            # Node 22
pnpm install
pnpm dev --host    # http://localhost:4321 (azgianlab:4321)
```
`/api/*` 요청은 vite 프록시로 로컬 worker(:8788)에 전달된다(astro.config.mjs).

### 2. 게시판 worker (jsbeob-api)
```bash
cd jsbeob-api
cp .dev.vars.example .dev.vars      # 시크릿 채우기 (아래 OAuth 참고)
# 로컬 D1 스키마 적용
npx wrangler d1 execute jsbeob-db --local --config=wrangler.toml --file=schema.sql
# worker 기동
npx wrangler dev --config=wrangler.toml --local --port 8788
```
프론트(4321)와 worker(8788)를 동시에 띄우면 로그인·게시판이 로컬에서 동작한다.
(OAuth 콜백은 실제 카카오/구글 앱이 있어야 완전 동작. 미설정 시 글 조회까지는 가능.)

---

## 운영 배포 (Cloudflare) — 최초 1회 프로비저닝

> 아래는 Cloudflare 계정 로그인(`npx wrangler login`)이 된 상태에서 진행.

### A. DNS / 도메인
- `jsbeob.com` 을 Cloudflare 에 추가하고 네임서버를 CF로 변경 (SSL·CDN·만료 인증서 자동 해결).
- `img.jsbeob.com` 을 R2 공개 커스텀 도메인으로 연결(아래 D 참고).

### B. Pages (프론트)
- GitHub 저장소 연결 → 빌드 명령 `pnpm build`, 출력 `dist`.
- 빌드 환경변수: `PUBLIC_KAKAO_JS_KEY`(지도용, 선택).

### C. D1 (게시판 DB)
```bash
cd jsbeob-api
npx wrangler d1 create jsbeob-db
# 출력된 database_id 를 wrangler.toml 의 PLACEHOLDER... 자리에 붙여넣기
npx wrangler d1 execute jsbeob-db --remote --config=wrangler.toml --file=schema.sql
```

### D. R2 (사진 업로드)
```bash
npx wrangler r2 bucket create jsbeob-uploads
# CF 대시보드 → R2 → jsbeob-uploads → Settings → 공개 도메인 img.jsbeob.com 연결
```

### E. 시크릿 (worker)
```bash
cd jsbeob-api
npx wrangler secret put AUTH_SECRET            # 32자+ 랜덤
npx wrangler secret put KAKAO_REST_API_KEY
npx wrangler secret put KAKAO_CLIENT_SECRET    # (선택)
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

### F. worker 배포
```bash
cd jsbeob-api
npx wrangler deploy --config=wrangler.toml
```
→ `jsbeob.com/api/*` 라우트가 worker로 연결된다.

---

## OAuth 앱 등록

### 카카오 (메인) — https://developers.kakao.com
1. 애플리케이션 추가 → REST API 키 = `KAKAO_REST_API_KEY`.
2. 카카오 로그인 활성화 ON.
3. Redirect URI 등록:
   - `https://jsbeob.com/api/auth/callback/kakao`
   - `http://localhost:4321/api/auth/callback/kakao` (로컬, SITE_ORIGIN 맞춰)
4. 동의항목: 닉네임(profile_nickname), 프로필 사진(profile_image) 필수 동의.
5. (선택) 보안 → Client Secret 발급 시 `KAKAO_CLIENT_SECRET`.

### 구글 (보조) — https://console.cloud.google.com
1. OAuth 2.0 클라이언트 ID 생성 → `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
2. 승인된 리디렉션 URI:
   - `https://jsbeob.com/api/auth/callback/google`

> 로컬에서 OAuth를 테스트하려면 worker의 `SITE_ORIGIN`을 `http://localhost:4321`로 두고
> 각 콜백 URL을 OAuth 앱에 추가. 운영은 `https://jsbeob.com`.

---

## 권한 레벨
`0=대기 · 1=일반(닉네임 설정 시 자동) · 2=검증 · 3=큐레이터 · 4=운영자`
- 글 작성: level≥1 / 공지·법종교소식 작성: level≥4 / 게시글·회원 관리: level≥4.
- 운영자 지정: D1에서 `UPDATE users SET level=4 WHERE id='...'`.
