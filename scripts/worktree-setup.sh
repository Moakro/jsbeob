#!/usr/bin/env bash
# 워크트리 로컬 준비 — git 이 추적하지 않아 워크트리에 따라오지 않는 것들을 메인 저장소에서 복사한다.
#   1) .env                       (카카오 지도 키 PUBLIC_KAKAO_JS_KEY 등)
#   2) jsbeob-api/.dev.vars       (API 비밀값 — 로그인 등)
#   3) jsbeob-api/.wrangler/state (로컬 D1 DB·R2 사진)
# 없으면 홈 섹션·지도·로그인이 빈 화면/오류로 나온다.
# 그리고 4) .dev-ports — 이 worktree 전용 dev 포트 쌍(SITE_PORT/API_PORT)을 골라 적는다(없을 때만).
#    메인(4321/8788)·다른 worktree 의 .dev-ports·지금 열려 있는 포트를 피한다. scripts/dev-ports.mjs 참고.
#
# 사용: pnpm setup:worktree            — 없는 것만 복사 (DB는 비어 있을 때만)
#       pnpm setup:worktree --force    — 로컬 DB를 메인 것으로 덮어씀 (기존 것은 state.bak-<시각> 으로 보관)
# Orca 새 worktree 에서는 orca.yaml 의 scripts.setup 이 자동으로 실행한다.
# DB 복사 전에 이 worktree 의 dev 서버를 멈춰야 한다. 복사 후 메인 DB에 없는 이 브랜치의 마이그레이션은 직접 적용할 것.
set -euo pipefail

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

here="$(git rev-parse --show-toplevel)"
main="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"

if [[ "$here" == "$main" ]]; then
  echo "메인 저장소입니다 — 워크트리 안에서 실행하세요."
  exit 1
fi
echo "메인: $main"
echo "대상: $here"

copy_file() {
  local rel="$1"
  if [[ ! -f "$main/$rel" ]]; then
    echo "  - $rel: 메인에 없음, 건너뜀"
  elif [[ -f "$here/$rel" ]]; then
    echo "  = $rel: 이미 있음"
  else
    cp -p "$main/$rel" "$here/$rel"
    echo "  + $rel: 복사함"
  fi
}

copy_file .env
copy_file jsbeob-api/.dev.vars

# dev 포트 쌍 — 사이트 4321+k / API 8788+k (k=1..99)
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
if [[ -f "$here/.dev-ports" ]]; then
  echo "  = .dev-ports: 이미 있음 ($(tr '\n' ' ' < "$here/.dev-ports"))"
else
  claimed=" "
  while IFS= read -r wt; do
    [[ "$wt" == "$here" || ! -f "$wt/.dev-ports" ]] && continue
    claimed+="$(sed -n 's/^[[:space:]]*\(SITE_PORT\|API_PORT\)[[:space:]]*=[[:space:]]*\([0-9]*\).*/\2/p' "$wt/.dev-ports" | tr '\n' ' ')"
  done < <(git worktree list --porcelain | sed -n 's/^worktree //p')
  picked=""
  for k in $(seq 1 99); do
    sp=$((4321 + k)); ap=$((8788 + k))
    [[ "$claimed" == *" $sp "* || "$claimed" == *" $ap "* ]] && continue
    port_open "$sp" || port_open "$ap" && continue
    picked="$sp $ap"; break
  done
  if [[ -z "$picked" ]]; then
    echo "  ! .dev-ports: 빈 포트 쌍을 못 찾음 — SITE_PORT=/API_PORT= 를 직접 적으세요"
  else
    read -r sp ap <<<"$picked"
    printf '# 이 worktree 전용 dev 포트 (scripts/worktree-setup.sh 가 만듦, git 제외)\nSITE_PORT=%s\nAPI_PORT=%s\n' "$sp" "$ap" > "$here/.dev-ports"
    echo "  + .dev-ports: 사이트 :$sp · API :$ap"
  fi
fi
api_port="$(sed -n 's/^[[:space:]]*API_PORT[[:space:]]*=[[:space:]]*\([0-9]*\).*/\1/p' "$here/.dev-ports" 2>/dev/null || true)"
api_port="${api_port:-8788}"

# 로컬 D1 — 실제 데이터가 든 sqlite(수 MB)가 있으면 '채워진' 것으로 본다.
state=jsbeob-api/.wrangler/state
has_data() {
  find "$1/v3/d1" -name '*.sqlite' ! -name 'metadata.sqlite' -size +100k 2>/dev/null | grep -q .
}

if [[ ! -d "$main/$state" ]]; then
  echo "  - $state: 메인에 없음, 건너뜀"
elif has_data "$here/$state" && [[ $FORCE -eq 0 ]]; then
  echo "  = $state: 이미 데이터 있음 (덮어쓰려면 --force)"
else
  if [[ -d "$here/$state" ]] && port_open "$api_port"; then
    echo "  ! :$api_port 에 이 worktree 의 API 가 떠 있습니다 — dev 서버를 멈춘 뒤 다시 실행하세요."
    exit 1
  fi
  if [[ -d "$here/$state" ]]; then
    bak="$here/$state.bak-$(date +%Y%m%d-%H%M%S)"
    mv "$here/$state" "$bak"
    echo "  · 기존 상태 보관: ${bak#$here/}"
  fi
  mkdir -p "$(dirname "$here/$state")"
  cp -a "$main/$state" "$here/$state"
  echo "  + $state: 복사함 ($(du -sh "$here/$state" | cut -f1))"
fi

echo "완료. pnpm dev 로 띄우세요."
