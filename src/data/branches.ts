// 지부·분원 목록 — 회원 소속 선택(닉네임 설정·관리자)과 API 검증(jsbeob-api가 `../src/data/branches.ts`로 import)에 함께 쓴다.

export type BranchKind = "지부" | "분원";

export interface Branch {
  code: string;
  name: string;
  kind: BranchKind;
}

export const BRANCHES: Branch[] = [
  // 지부
  { code: "jungbu", name: "중부 지부", kind: "지부" },
  { code: "seoul", name: "서울 지부", kind: "지부" },
  { code: "daegu", name: "대구 지부", kind: "지부" },
  { code: "andong", name: "안동 지부", kind: "지부" },
  { code: "miryang", name: "밀양 지부", kind: "지부" },
  { code: "taebaek", name: "태백 지부", kind: "지부" },
  { code: "pohang", name: "포항 지부", kind: "지부" },
  { code: "uiseong", name: "의성 지부", kind: "지부" },
  { code: "danyang", name: "단양 지부", kind: "지부" },
  { code: "hwacheon", name: "화천 지부", kind: "지부" },
  { code: "yeongju", name: "영주 지부", kind: "지부" },
  { code: "seosan", name: "서산 지부", kind: "지부" },
  { code: "changnyeong", name: "창녕 지부", kind: "지부" },
  // 분원
  { code: "daejeon", name: "대전 분원", kind: "분원" },
  { code: "busan", name: "부산 분원", kind: "분원" },
  { code: "chuncheon", name: "춘천 분원", kind: "분원" },
  { code: "jinju", name: "진주 분원", kind: "분원" },
  { code: "ulsan", name: "울산 분원", kind: "분원" },
];

export const BRANCH_CODES = new Set(BRANCHES.map((b) => b.code));

// 복원: 추정 — 함수 이름. 클라이언트 branches.*.js가 `code → name ?? null` 함수를 export하고 AdminApp이 쓴다.
export function branchName(code: string | null | undefined): string | null {
  return BRANCHES.find((b) => b.code === code)?.name ?? null;
}
