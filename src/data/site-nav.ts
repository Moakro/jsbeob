/**
 * 상단 헤더 내비게이션.
 *
 * 헤더는 `prefixes` 로 활성 섹션을 강조한다: 현재 URL이 prefix 중 하나로
 * 시작하면 해당 탭이 활성화된다. (most-specific → least-specific 순서)
 */

// 복원: 추정 — 배포본 Base 청크에서 HEADER_NAV 바로 앞에 있던 상수. 문의 게시판의 카카오 채널 링크(비어 있으면 숨김).
export const KAKAO_CHANNEL_URL = "";

/**
 * 헤더 사이트 제목 오른쪽과 로그인 창·로그인 후 메뉴의 '옛 홈페이지 보관함' 링크에 붙는 [OLD] 배지 (2026-11-13).
 * 사이트 이전(jsbeob.com → 새 사이트) 후 일정 기간만 보인다 — 기간이 끝나면 false 로 바꾸면 배지가 모두 사라진다.
 * (보관함 링크 자체는 로그인 창·메뉴에 그대로 남는다.)
 */
export const SHOW_OLD_BADGE = true;

export type SectionSlug =
  | "home"
  | "media" // 미디어
  | "about" // 소개
  | "jeongak" // 전각
  | "archive" // 자료실
  | "calendar" // 달력
  | "community" // 도생광장
  | "map" // 지도
  | "account"
  | "admin";

export interface SectionDef {
  slug: SectionSlug;
  label: string;
  href: string;
  prefixes: string[];
}

/** ── 헤더 순서 ── */
export const HEADER_NAV: SectionDef[] = [
  { slug: "home", label: "홈", href: "/", prefixes: [] },
  // 법종교 미디어(가칭) — 유튜브 채널 본격 운영(사장 결정 2026-09-27: 처음부터 독립 메뉴, 서브탭 없이 · 같은 날 메뉴 맨 앞으로)
  { slug: "media", label: "미디어", href: "/media/", prefixes: ["/media/"] },
  { slug: "about", label: "소개", href: "/about/", prefixes: ["/about/"] },
  { slug: "jeongak", label: "전각", href: "/jeongak/", prefixes: ["/jeongak/"] },
  {
    slug: "archive",
    label: "자료실",
    href: "/archive/",
    prefixes: ["/archive/"],
  },
  { slug: "calendar", label: "달력", href: "/calendar/", prefixes: ["/calendar/"] },
  {
    slug: "community",
    label: "도생광장",
    href: "/community/",
    prefixes: ["/community/"],
  },
  { slug: "map", label: "지도", href: "/map/", prefixes: ["/map/"] },
];

export const ACCOUNT_SECTION: SectionDef = {
  slug: "account",
  label: "계정",
  href: "/account/",
  prefixes: ["/account/"],
};

export const ADMIN_SECTION: SectionDef = {
  slug: "admin",
  label: "관리자",
  href: "/admin/",
  prefixes: ["/admin/"],
};

/** URL 경로가 속한 섹션 판정 (완전 중립 페이지는 null). */
export function resolveSection(pathname: string): SectionSlug | null {
  if (pathname === "/") return "home";
  for (const def of HEADER_NAV) {
    if (def.prefixes.some((p) => pathname.startsWith(p))) return def.slug;
  }
  if (ACCOUNT_SECTION.prefixes.some((p) => pathname.startsWith(p))) return "account";
  if (ADMIN_SECTION.prefixes.some((p) => pathname.startsWith(p))) return "admin";
  return null;
}
