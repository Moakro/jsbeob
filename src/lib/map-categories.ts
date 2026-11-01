// 지도 마커 아이콘·색과 지도 기본 위치 — 지도 페이지·홈 미니맵·관리자 장소 편집 공용.
// 복원(2026-11-01): 배포본 _astro/map-categories.*.js 기준. MAP_HOME 외의 이름은 원본에 남지 않아 새로 붙였다.

/** 지도 첫 화면(오리알터) */
export const MAP_HOME = {
  center: [35.72076, 127.01973] as [number, number],
  level: 4,
  mapType: "hybrid",
  label: "오리알터",
};

/** 마커 아이콘(Material Symbols 경로). pick=false 는 관리자 선택지에 안 보인다. */
export const MARKER_ICONS: Record<string, { label: string; pick: boolean; path: string }> = {
  temple: {
    label: "전각",
    pick: true,
    path: "m330-720 150-200 150 200H330Zm-90 160v-46q-52-13-86-55t-34-98h80q0 32 23.5 55.5T279-680h402q32 0 55.5-23.5T760-759h80q0 56-34 98t-86 55v46H240ZM160-80v-366q-52-13-86-55t-34-98h80q0 32 23.5 55.5T199-520h562q32 0 55.5-23.5T840-599h80q0 56-34 98t-86 55v366H520v-160q0-17-11.5-28.5T480-280q-17 0-28.5 11.5T440-240v160H160Z",
  },
  building: {
    label: "건물",
    pick: true,
    path: "M680-600h80v-80h-80v80Zm0 160h80v-80h-80v80Zm0 160h80v-80h-80v80ZM40-120v-400l280-200 280 200v400H400v-240H240v240H40Zm640 0v-440L400-762v-78h520v720H680Z",
  },
  home: { label: "집", pick: true, path: "M160-120v-480l320-240 320 240v480H560v-280H400v280H160Z" },
  star: {
    label: "별",
    pick: true,
    path: "m233-120 65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149-247 149Z",
  },
  mountain: { label: "산", pick: true, path: "m40-240 240-320 180 240h300L560-586 460-454l-50-66 150-200 360 480H40Z" },
  flag: { label: "깃발", pick: true, path: "M200-120v-680h360l16 80h224v400H520l-16-80H280v280h-80Z" },
  pin: {
    label: "핀",
    pick: true,
    path: "M536.5-503.5Q560-527 560-560t-23.5-56.5Q513-640 480-640t-56.5 23.5Q400-593 400-560t23.5 56.5Q447-480 480-480t56.5-23.5ZM480-80Q319-217 239.5-334.5T160-552q0-150 96.5-239T480-880q127 0 223.5 89T800-552q0 100-79.5 217.5T480-80Z",
  },
  doc: {
    label: "문서",
    pick: false,
    path: "M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520h200L520-800v200Z",
  },
};

/** 태그 색 팔레트 */
export const TAG_COLORS = ["#B8322A", "#2F6DB5", "#C98A12", "#8E4A3F", "#3E7D4F", "#6B4FA0", "#1F7A80", "#7A8592"];

/** 아이콘 이름 → SVG 경로(모르면 핀) */
export const iconPath = (icon?: string | null) => (MARKER_ICONS[icon ?? ""] ?? MARKER_ICONS.pin).path;

/** 문서(자료)에 붙은 지도 마커 */
export const DOC_MARKER = { color: "#FFFFFF", icon: "doc" };
/** 기본 마커 */
export const MARKER_DEFAULT = { color: "#7A8592", icon: "pin", label: "장소" };
/** 사이트 대표색 */
export const BRAND_COLOR = "#B8322A";

const KIND_COLORS: Record<string, string> = {
  jeongak: "#B8322A",
  branch: "#2F6DB5",
  affiliated: "#8E4A3F",
  sacred: "#C98A12",
};

/** 장소 종류 → 마커 색 */
export const markerForKind = (kind?: string | null) => ({ color: KIND_COLORS[kind ?? ""] ?? MARKER_DEFAULT.color });
