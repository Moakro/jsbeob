// 회원 등급 — API(jsbeob-api가 `../src/data/levels`로 import)와 화면이 함께 쓴다.
// 등급 값은 20 간격으로 둔다. 나중에 등급을 더하면 사이의 숫자(예: 50)를 쓴다 (2026-11-16 사용자 결정).
// 권한 검사는 숫자 대신 아래 상수로 한다 — 값 비교는 "이상(>=)" 기준.
export const LEVEL = {
  /** 처음 로그인 — 읽기만 */
  PENDING: 0,
  /** 닉네임을 정하면 자동으로 */
  GENERAL: 20,
  /** 교인 — 지부·생년월일·본명 등을 올리고 편집진 이상이 확인 */
  BELIEVER: 40,
  /** 편집진 — 콘텐츠 관리 */
  EDITOR: 60,
  /** 운영진 — 사이트 관리 */
  STAFF: 80,
  /** 관리자 — 전체 */
  ADMIN: 100,
} as const;

/** 회원 등급 라벨 (낮은 등급 → 높은 등급 순) */
export const LEVEL_LABEL: Record<number, string> = {
  [LEVEL.PENDING]: "대기",
  [LEVEL.GENERAL]: "일반",
  [LEVEL.BELIEVER]: "교인",
  [LEVEL.EDITOR]: "편집진",
  [LEVEL.STAFF]: "운영진",
  [LEVEL.ADMIN]: "관리자",
};

/** 정의된 등급 값 (오름차순) — 회원 등급 변경 검증·선택 목록에 쓴다 */
export const LEVELS: number[] = Object.values(LEVEL).sort((a, b) => a - b);
