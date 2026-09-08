/**
 * 상단 헤더 내비게이션 — 사이트 5개 섹션.
 *
 * 헤더는 `prefixes` 로 활성 섹션을 강조한다: 현재 URL이 prefix 중 하나로
 * 시작하면 해당 탭이 활성화된다. (most-specific → least-specific 순서)
 */
export type SectionSlug =
  | "home"
  | "about" // 소개
  | "jeongak" // 전각
  | "archive" // 경전·자료
  | "community" // 소식·커뮤니티
  | "calendar" // 달력
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
  { slug: "about", label: "소개", href: "/about/", prefixes: ["/about/"] },
  { slug: "jeongak", label: "전각", href: "/jeongak/", prefixes: ["/jeongak/"] },
  {
    slug: "archive",
    label: "경전·자료",
    href: "/archive/",
    prefixes: ["/archive/"],
  },
  {
    slug: "community",
    label: "소식·커뮤니티",
    href: "/community/",
    prefixes: ["/community/"],
  },
  { slug: "calendar", label: "달력", href: "/calendar/", prefixes: ["/calendar/"] },
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
