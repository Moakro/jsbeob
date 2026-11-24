# jsbeob — 작업 안내 (Claude·사람 공용)

자세한 로컬 개발 설명은 `DEVELOPMENT.md`. 여기에는 매번 필요한 규칙만 적는다.

## 구조
- **사이트** (저장소 최상위): Astro 6 + Svelte 5, Cloudflare Worker `jsbeob` (`wrangler.jsonc`). 화면은 `src/`.
- **API** (`jsbeob-api/`): Cloudflare Worker, 운영 이름 `jsbeob-api-preview` (`jsbeob-api/wrangler.toml`), D1 `jsbeob-db`, R2 `jsbeob-uploads`.
- 사이트 SSR 은 service binding `API` 로 API 를 **이름으로** 부른다. 브라우저의 `/api/*` 는 dev 에서 vite proxy 가 API 포트로 넘긴다.
- 패키지 관리자: pnpm (Node ≥ 22.12).

## 설치
```bash
pnpm install
```
새 worktree 라면 아래 "worktree 규칙"의 준비 스크립트가 설치까지 한다.

## dev 실행 — 포트 규칙
```bash
pnpm dev        # API + 사이트 함께. Ctrl+C 한 번에 둘 다 멈춤
pnpm dev:api    # API 만
pnpm dev:site   # 사이트만
pnpm dev:login  # 로컬 운영자 로그인 쿠키 한 줄 출력 (해당 사이트 포트 주소를 알려 줌)
```
- 포트 결정 (`scripts/dev-ports.mjs`): 환경변수 `SITE_PORT`/`API_PORT` > 최상위 `.dev-ports`(git 제외) > 기본 **4321 / 8788**.
- **main(원래 폴더)은 `.dev-ports` 가 없어 4321 / 8788 그대로.** worktree 는 준비 스크립트가 4322/8789, 4323/8790 … 처럼 비어 있는 쌍을 골라 `.dev-ports` 에 적는다.
- `scripts/dev.mjs`, `dev:api`, `dev:site`, `astro.config.mjs`(사이트 포트·`/api` proxy), `dev:login`, `scripts/import-scripture.mjs` 가 모두 이 값을 따른다.
- `.dev-ports` 가 있으면 wrangler 개발 레지스트리를 `.wrangler/dev-registry/`(이 폴더)에 따로 둔다. 안 그러면 사이트가 다른 worktree 의 `jsbeob-api-preview` 에 붙는다. API 디버거 포트도 `API_PORT+1000` 으로 고정.
- worktree 에서 사이트 포트가 4321 이 아니면 API 의 `SITE_ORIGIN` 을 `http://localhost:<사이트 포트>` 로 덮어 띄운다. 소셜 로그인 리디렉트는 4321 만 등록돼 있으므로 worktree 에서는 `pnpm dev:login` 쿠키로 로그인한다.
- dev 서버를 내린 뒤에는 그 worktree 포트(예: `ss -ltn | grep -E ':(4322|8789)\b'`)가 비었는지 확인한다. 다른 worktree·main 의 서버를 이름(`pkill -f dev.mjs`)으로 끄지 않는다 — 다 같이 꺼진다.
- `astro.config.mjs` 를 고치면 dev 서버를 재시작한다.

## 빌드·테스트·lint
```bash
pnpm build      # astro build — 지금 유일한 자동 검사(테스트·lint 스크립트는 없음)
```

## 로컬 D1
- 로컬 D1·R2 는 `jsbeob-api/.wrangler/state/` 에 있고 **worktree 마다 따로**다(확인함: 한 worktree 에 만든 표가 다른 worktree·main 에는 없음).
- 명령은 `jsbeob-api/` 에서 `-c wrangler.toml` 을 꼭 붙인다 (없으면 `Couldn't find a D1 DB … wrangler.jsonc` 오류):
  ```bash
  cd jsbeob-api
  npx wrangler d1 execute jsbeob-db -c wrangler.toml --local --command "SELECT COUNT(*) FROM sqlite_master"
  npx wrangler d1 execute jsbeob-db -c wrangler.toml --local --file=migrations/<파일>.sql   # 마이그레이션 적용
  ```
- 스키마를 바꾸면 `jsbeob-api/migrations/` 에 SQL 을 추가하고 `schema.sql` 도 맞춘다.
- 시험: `pnpm dev:api` 를 띄워 `curl http://localhost:<API 포트>/api/...`, 끝나면 내리고 포트가 비었는지 확인.

## 운영 반영 — 사용자 승인 후에만
- 운영 D1 SQL(`--remote`), API 배포(`cd jsbeob-api && npx wrangler deploy -c wrangler.toml`), 사이트 배포(`pnpm run deploy`)는 **사용자가 승인한 뒤에만** 한다. 에이전트는 실행하지 않는다.
- 로컬 작업에는 절대 `--remote` 를 붙이지 않는다.
- 순서(여러 개가 바뀐 경우): 커밋·푸시 → API 배포 → 운영 D1 SQL → 사이트 배포.
- main 에 직접 push 하지 않는다. feature 브랜치 → PR → 사용자가 GitHub 에서 머지.

## worktree 규칙
- main(원래 폴더 `~/Dev/svelte/jsbeob`)에서는 작업하지 않는다. 작업마다 Orca worktree 를 새로 만들고, 머지 후 지운다.
- 새 worktree 준비는 `orca.yaml` 의 `scripts.setup` 이 자동으로 한다 (첫 실행 때 Orca 가 승인을 묻는다):
  `pnpm install --frozen-lockfile` → `scripts/worktree-setup.sh`
  - 본 저장소에서 `.env`, `jsbeob-api/.dev.vars` 를 없을 때만 복사
  - 로컬 D1·R2(`jsbeob-api/.wrangler/state`)를 비어 있을 때만 복사 (덮어쓰기: `pnpm setup:worktree --force`)
  - `.dev-ports` 에 이 worktree 전용 포트 쌍 기록 (없을 때만)
- 수동 실행: `pnpm setup:worktree`. 복사한 DB 에는 이 브랜치의 새 마이그레이션이 없으니 직접 적용한다.
- 비밀값(`.env`, `.dev.vars`)의 내용은 커밋·PR·로그·채팅에 쓰지 않는다. 파일 이름만 다룬다.
