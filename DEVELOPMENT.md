# 로컬 개발

사이트(Astro, `jsbeob`)와 API(`jsbeob-api`, 운영 이름 `jsbeob-api-preview`)는 서로 다른 Cloudflare Worker다.
사이트의 SSR 은 service binding `API` 로 API 를 부르므로, 개발할 때도 **두 개를 같이 띄운다**.
(API 가 없으면 데이터 페이지가 `Worker "jsbeob-api-preview" not found` 500 을 낸다.)

## 처음 한 번

```bash
pnpm install
cp jsbeob-api/.dev.vars.example jsbeob-api/.dev.vars   # AUTH_SECRET 을 32자 이상 랜덤으로
pnpm db:local:init                                       # 로컬 D1 에 스키마(테이블 27개)
cp .env.example .env                                     # 지도: PUBLIC_KAKAO_JS_KEY (선택)
```

## 매번

```bash
pnpm dev:api    # 터미널 1 — API, http://localhost:8788 (로컬 D1·R2)
pnpm dev        # 터미널 2 — 사이트, http://localhost:4321
```

순서는 상관없다. 사이트가 먼저 떠 있으면 API 가 뜨는 순간 연결된다.

## 관리자 화면(/admin/) 로그인

소셜 로그인은 키·리디렉트 등록이 필요하므로, 로컬에서는 다음으로 대신한다.

```bash
pnpm dev:login   # 로컬 D1 에 운영자(level 4) 계정을 만들고 세션 쿠키 한 줄을 출력
```

출력된 `document.cookie = …` 줄을 http://localhost:4321 의 개발자 도구 콘솔에 붙여 넣고 새로고침한다.
`.dev.vars` 의 AUTH_SECRET 으로 서명하므로 운영 사이트에서는 통하지 않는다.

## 데이터

- 로컬 D1·R2 는 `jsbeob-api/.wrangler/` 에 있다(git 제외). 처음엔 비어 있다.
- 운영 데이터 사본으로 채우기(운영은 읽기만):
  1. `npx wrangler d1 export jsbeob-db --remote -c wrangler.toml --no-schema --output <파일>`
  2. 로컬 wrangler 는 긴 INSERT 를 못 받으므로(SQLITE_TOOBIG), API 를 멈춘 뒤
     `jsbeob-api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite` 에 sqlite3 로 직접 넣는다.
  3. 사진은 DB 의 `r2_key`(media·user_uploaded_photos)를 `wrangler r2 object get … --remote` 로 받아 `… put --local`.
  4. 다 넣은 뒤 내보낸 파일은 지운다(회원 개인정보 포함). 그다음 `pnpm dev:login` 을 다시 실행한다.
- 미디어(유튜브) 영상: `jsbeob-api/.dev.vars` 에 `YOUTUBE_CHANNEL_ID="UCZGie9U3cRiqc72GknqESgA"`(공개 값)만 있어도 RSS 로 최근 15편이 나온다.
  `YOUTUBE_API_KEY`(Google Cloud 의 YouTube Data API v3 키)를 넣으면 전체 목록·옛 대표 영상까지 운영과 같아진다. 바꾼 뒤 `pnpm dev:api` 재시작.
- 스키마를 바꾸면 `jsbeob-api/migrations/` 에 SQL 을 추가하고 `schema.sql` 도 맞춘다.

## 배포 — 운영에 바로 반영된다

- 사이트: `pnpm deploy` (= build + `wrangler deploy`)
- API: `cd jsbeob-api && npx wrangler deploy -c wrangler.toml`
- 운영 D1 에 SQL 실행은 `--remote`. 로컬 작업에는 절대 `--remote` 를 붙이지 않는다.
