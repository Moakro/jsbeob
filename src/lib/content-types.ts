// 자료(문서·장소) 종류 라벨과 정렬 규칙 — 서버·클라이언트 공용.
// 복원(2026-11-01): 배포본 content-types 청크와 클라이언트 library 청크 기준.

/** 지도 장소 종류(관리자 장소 편집의 선택지 묶음) */
export const MAP_KIND_GROUPS = [
  {
    label: "법종교",
    kinds: [
      { value: "jeongak", label: "전각" },
      { value: "branch", label: "지부·분원" },
      { value: "affiliated", label: "기타 소속" },
    ],
  },
  {
    label: "외부",
    kinds: [
      { value: "sacred", label: "성지" },
      { value: "general", label: "일반 장소" },
    ],
  },
];

// 복원: 추정 — 배포본에는 이 값이 계산만 되고 쓰이지 않아 이름이 남지 않았다.
export const MAP_KIND_LABEL: Record<string, string> = Object.fromEntries(
  MAP_KIND_GROUPS.flatMap((g) => g.kinds.map((k) => [k.value, k.label])),
);

/** 소개(about) 문서 종류 */
export const ABOUT_KINDS: Record<string, string> = {
  person: "창교",
  doctrine: "교기·교지·교리",
  history: "연혁",
  org: "조직",
  branches: "지부·분원",
  anthem: "교가",
  directions: "찾아오시는 길",
  overview: "일반 소개",
};

/** 소개 페이지 하위 메뉴 순서 */
export const ABOUT_NAV = ["person", "doctrine", "history", "branches", "directions"];

// 복원: 이름 추정 — 클라이언트 청크에만 남은 장소 종류 라벨
export const PLACE_KINDS: Record<string, string> = {
  jeongak: "전각",
  landmark: "성지·유적",
  branch: "지부·분원",
  etc: "기타 장소",
};

const koCollator = new Intl.Collator("ko");

/** 자료 목록 기본 정렬: 고정(pinned) 먼저(고정끼리는 order), 나머지는 가나다순 */
export const libraryOrder = (
  a: { pinned?: boolean; order: number; title: string },
  b: { pinned?: boolean; order: number; title: string },
) =>
  Number(!!b.pinned) - Number(!!a.pinned) ||
  (a.pinned ? a.order - b.order : 0) ||
  koCollator.compare(a.title, b.title);
