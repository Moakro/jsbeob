# 올림함 AI 초안 감시 서비스 (intake-watcher)

편집진이 ＋ 로 올린 공문·사진·PDF·카톡 캡처·메모를 **미니PC에서** 읽어 일정·소식 초안을 만들어 올림함에 되돌린다.
설계: `docs/design/ai-intake.md` 4.3 (2026-11-27 오너 결정 — 사이트 서버는 AI 를 부르지 않는다).

```
사이트 API (Cloudflare)                       미니PC (이 프로그램)
  POST /api/intake  → status=uploaded
                                       ←── 30초마다 POST /api/intake-worker/claim  (새 올림만 물음, AI 비용 없음)
  uploaded → extracting, attempts+1   ──→  {intake}
                                       ←── GET  /api/intake-worker/:id/file/:n     (원본을 임시 폴더로)
                                            claude -p (Read 만, 임시 폴더 안만, Bash·웹·MCP·훅 없음, JSON 스키마)
                                            답 검사 → 블록 조립(천기·음력·상대 날짜, jsbeob-api/intake-draft.mjs)
  → ready / failed                     ←── POST /api/intake-worker/:id/result
```

- 한 번에 하나씩. 하나 끝나면 바로 다음 것을 묻고, 없으면 30초 쉰다. 올린 뒤 보통 1분 안에 초안(시험: 한 건 6~16초).
- 열쇠: API Worker 비밀값 `INTAKE_WORKER_TOKEN` 과 같은 값을 열쇠 파일에 둔다. 회원 쿠키로는 이 길을 못 쓴다.
- 실패(claude 오류·시간 초과·답이 틀에 안 맞음·글씨를 못 읽음) → `failed` + 사유. 올림함의 **다시 시도**로 다시 대기열에.
- 감시 서비스가 처리 중에 꺼지면 그 건은 `extracting` 으로 남았다가 10분 뒤 다시 잡힌다(최대 3번, 그다음은 `failed`).
- 늦게 끝난 결과가 새 결과를 덮지 않게, 결과는 잡을 때 받은 `attempt` 가 맞을 때만 쓰인다(아니면 409).
- AI 가 못 읽는 형식(HEIC·HWP·DOCX)만 있는 건은 잡지 않는다 → `uploaded` 로 남고 직접 작성.
- 로그에는 공문 내용을 적지 않는다(건 id·블록 수·경고 수·토큰·시간만). claude 세션 기록도 남기지 않는다(`--no-session-persistence`).

## 손으로 시험 (로컬)

```bash
# 1) API 의 .dev.vars 에 열쇠(32자 이상)를 넣고 같은 값을 파일로
openssl rand -hex 32 > /tmp/intake-token && chmod 600 /tmp/intake-token
echo "INTAKE_WORKER_TOKEN=\"$(cat /tmp/intake-token)\"" >> jsbeob-api/.dev.vars
pnpm dev                                   # API 포트는 .dev-ports (main 은 8788)

# 2) 편집진으로 올린 뒤 한 건만 처리
INTAKE_API_BASE=http://localhost:8788 INTAKE_TOKEN_FILE=/tmp/intake-token \
  node tools/intake-watcher/watcher.mjs --once
```

`--once` 를 빼면 계속 돈다(Ctrl+C 로 멈춤).

## 미니PC 설치 (머지·운영 배포 뒤)

```bash
cd ~/Dev/svelte/jsbeob && git pull --ff-only
mkdir -p ~/.config/jsbeob-intake-watcher && chmod 700 ~/.config/jsbeob-intake-watcher
cp tools/intake-watcher/env.example ~/.config/jsbeob-intake-watcher/env      # 값 확인(INTAKE_API_BASE=https://jsbeob.com, PATH 의 node 버전)
openssl rand -hex 32 > ~/.config/jsbeob-intake-watcher/token && chmod 600 ~/.config/jsbeob-intake-watcher/token
# 같은 값을 운영 API 비밀값으로 (오너 승인 뒤):
#   cd jsbeob-api && npx wrangler secret put INTAKE_WORKER_TOKEN -c wrangler.toml < ~/.config/jsbeob-intake-watcher/token
cp tools/intake-watcher/jsbeob-intake-watcher.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now jsbeob-intake-watcher
journalctl --user -u jsbeob-intake-watcher -f
```

- 서비스는 `~/Dev/svelte/jsbeob`(main) 코드를 돌린다. 머지 뒤 `git pull` 하고 `systemctl --user restart jsbeob-intake-watcher`.
- `claude` 는 오너 구독 로그인으로 돈다(`ANTHROPIC_API_KEY` 는 넘기지 않음). 구독 사용 한도에 걸리면 그 건은 `failed` — 나중에 다시 시도.
- 미니PC가 꺼져 있으면 올림은 `처리 대기` 로 남을 뿐이고, 켜지면 밀린 것부터 처리한다.

## AI 부르는 방식 바꾸기

`extractors/` 의 모듈 하나가 "AI 부르기"만 맡는다: `extract(ctx, {dir, model, timeoutMs}) → {extracted, model, input_tokens, output_tokens}`.
지시문·답의 틀(`EXTRACT_SCHEMA`)·검사·블록 조립·결과 쓰기는 `jsbeob-api/intake-draft.mjs` 와 이 프로그램이 공유한다.

- 지금: `claude-cli` — 오너 구독 Claude Code. 편집진이 오너 한 명일 때.
- 나중(다른 편집진 것까지 처리·사용량이 늘 때): `anthropic-api` 모듈을 더해 API 키로 Messages API 를 직접 부르고 `INTAKE_EXTRACTOR=anthropic-api` 로 바꾼다.
  미니PC 없이 돌리고 싶으면 같은 `intake-draft.mjs` 를 API Worker 의 Cron·대기열에서 부르게 옮길 수도 있다 — 엔드포인트·DB 칸·화면은 그대로다.

## 설정 (env.example)

| 변수 | 기본 | 뜻 |
|------|------|-----|
| `INTAKE_API_BASE` | (필수) | 사이트 주소. 운영 `https://jsbeob.com` |
| `INTAKE_TOKEN_FILE` | (필수) | 열쇠 파일 |
| `INTAKE_EXTRACTOR` | `claude-cli` | AI 부르는 방식 |
| `INTAKE_MODEL` | `claude-opus-5-5` | 모델 |
| `INTAKE_EFFORT` | (claude 기본) | `low`·`medium`·`high` |
| `INTAKE_POLL_SECONDS` | 30 | 확인 간격 |
| `INTAKE_TIMEOUT_SECONDS` | 300 | 한 건 시간 제한 |
| `INTAKE_MAX_PER_DAY` | 30 | 하루(한국 날짜) 최대 처리 |
| `INTAKE_WORK_DIR` | OS 임시 폴더 | 원본을 잠깐 받아 두는 곳(한 건 끝나면 지움) |
| `CLAUDE_BIN` | `claude` | claude 실행 파일 |
