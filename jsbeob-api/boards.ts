// 게시판 정의 — API와 프론트(src/)가 함께 import한다.
// 복원: 2026-11-01 배포본(jsbeob-api-preview) 번들에서 복원. 원본 TS 타입 정보는 번들에서 사라져
// 대부분 생략되었다(tsconfig strict:false). 동작은 배포본과 같다.
export const BOARD_LABEL = {
  news: "소식",
  orialter: "오리알터",
  etc: "기타 자료",
  help: "문의"
};
export const ALLOWED_BOARDS = new Set(Object.keys(BOARD_LABEL));
export const OPERATOR_BOARDS = new Set(["news", "etc"]);
export const BOARD_MIN_LEVEL = { orialter: 2 };
export const PRIVATE_BOARDS = new Set(["help"]);
export const PRIVATE_BOARDS_SQL = [...PRIVATE_BOARDS].map((b) => `'${b}'`).join(",");
export const TITLE_OPTIONAL_BOARDS = new Set(["orialter"]);

