// 자료실 목록 행 — 문서형(article) 카테고리와 게시물형(post) 카테고리를 같은 행 모양으로 만든다.
// 복원(2026-11-01): 배포본 서버 청크(library-rows_*.mjs)의 프로젝트 코드.
import { listArticles, listLibraryPosts } from "./content";
import { articleHref, libPostHref, sortForCategory } from "./library";

export interface LibRow {
  key: string;
  id: string | null;
  title: string;
  hanja?: string | null;
  href: string;
  meta?: string | null;
  pinned?: boolean;
  featured?: boolean;
  order?: number;
  date?: string | null;
  thumb?: any;
  draft?: boolean;
  series?: any;
}

const fromArticle = (a: any, extra: Partial<LibRow> = {}): LibRow => ({
  key: a.id,
  id: a.id,
  title: a.title,
  hanja: a.title_hanja,
  href: articleHref(a.kind, a.slug),
  meta: a.chapter_count ? `${a.chapter_count}장` : null, // 책(2026-10-02): 장 수
  pinned: !!a.pinned,
  featured: !!a.featured,
  order: a.sort_order ?? 0,
  date: a.published_at ?? a.updated_at,
  thumb: a.thumb,
  draft: a.status === "draft",
  ...extra,
});

/** 문서형 카테고리 행. 경전도 DB 자료실 책(2026-11-14 전환, 옛 content/scripture 병합 제거)이다. */
export async function articleRows(request: Request, cat: { key: string; list_order: string }, library?: any[]) {
  const all = library ?? (await listArticles(request, "library", cat.key));
  const mine = all.filter((a: any) => a.kind === cat.key);
  const rows: LibRow[] = mine.map((a: any) => fromArticle(a));
  return sortForCategory(cat.list_order, rows as any);
}

const ymd = (s: string) => String(s).slice(0, 10).replace(/-/g, ".");

/** 게시물형 카테고리 행(최근순, 커서 페이지) */
export async function postRows(request: Request, cat: { key: string }, opts: { limit?: number; before?: string | null } = {}) {
  const { items, next } = await listLibraryPosts(request, cat.key, opts);
  const rows: LibRow[] = items.map((p: any) => ({
    key: p.id,
    id: p.id,
    title: p.title,
    href: libPostHref(p.category, p.id),
    meta: ymd(p.created_at),
    series: p.series,
  }));
  return { rows, next };
}
