// 소개 글 묶기 — 소개 메인과 상세 페이지 오른쪽 목록이 같은 구조를 쓴다 (2026-11-20).
// 분류 순서: 하위 메뉴(ABOUT_NAV) → 나머지 알려진 분류 → 그 밖. 메뉴에 없는 분류(조직표·교가)도 포함.
// 창교와 글이 여러 편인 분류는 자기 이름의 묶음, 한 편뿐인 분류는 '교단 안내' 한 묶음(첫 단독 분류 자리)에 모은다.
import { ABOUT_KINDS, ABOUT_NAV } from "./content-types";

export type AboutCat = { kind: string; label: string; items: any[] };
export type AboutBlock = { type: "cat"; cat: AboutCat } | { type: "guide"; items: any[] };

export const GUIDE_LABEL = "교단 안내";

export function aboutCats(all: any[]): AboutCat[] {
  const order = [...new Set([...ABOUT_NAV, ...Object.keys(ABOUT_KINDS), ...all.map((a) => a.kind)])];
  return order
    .filter((k) => all.some((a) => a.kind === k))
    .map((k) => ({ kind: k, label: ABOUT_KINDS[k] ?? k, items: all.filter((a) => a.kind === k) }));
}

const isGroup = (c: AboutCat) => c.kind === "person" || c.items.length > 1;

export function aboutBlocks(cats: AboutCat[]): AboutBlock[] {
  const singles = cats.filter((c) => !isGroup(c));
  return cats.flatMap((c): AboutBlock[] =>
    isGroup(c)
      ? [{ type: "cat", cat: c }]
      : c === singles[0]
        ? [{ type: "guide", items: singles.map((s) => ({ ...s.items[0], catLabel: s.label })) }]
        : [],
  );
}
