// 자료실 목록 행 — 문서형(article) 카테고리와 게시물형(post) 카테고리를 같은 행 모양으로 만든다.
// 복원(2026-11-01): 배포본 서버 청크(library-rows_*.mjs)의 프로젝트 코드.
import { getCollection } from "astro:content";
import { listArticles, listLibraryPosts } from "./content";
import { SCRIPTURE_CATEGORY, articleHref, libPostHref, scriptureHref, sortForCategory } from "./library";

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

/** content/scripture/<책>/ 폴더 → 책 정보(제목·장 수) */
async function scriptureBooks() {
  const entries = (await getCollection("scripture")).filter((e) => e.id.includes("/"));
  const books = new Map<string, { title: string; hanja: string | null; chapters: number }>();
  for (const e of entries) {
    const folder = e.id.split("/")[0];
    const b = books.get(folder) ?? { title: e.data.scripture ?? folder, hanja: e.data.scripture_hanja ?? null, chapters: 0 };
    if (!e.data.section) b.chapters += 1;
    books.set(folder, b);
  }
  return books;
}

/** 문서형 카테고리 행. 경전 카테고리는 content/scripture 의 책을 함께 보여 준다. */
export async function articleRows(request: Request, cat: { key: string; list_order: string }, library?: any[]) {
  const all = library ?? (await listArticles(request, "library", cat.key));
  const mine = all.filter((a: any) => a.kind === cat.key);
  let rows: LibRow[];
  if (cat.key === SCRIPTURE_CATEGORY) {
    const books = await scriptureBooks();
    const bySlug = new Map(mine.map((a: any) => [a.slug, a]));
    const scripture = [...books].map(([folder, b]) => {
      const a = bySlug.get(folder);
      const meta = `${b.chapters}장`;
      return a
        ? fromArticle(a, { meta, href: scriptureHref(folder) })
        : {
            key: folder,
            id: null,
            title: b.title,
            hanja: b.hanja,
            href: scriptureHref(folder),
            meta,
            pinned: false,
            featured: false,
            order: 0,
            date: null,
            thumb: null,
          };
    });
    rows = [...scripture, ...mine.filter((a: any) => !books.has(a.slug)).map((a: any) => fromArticle(a))];
  } else {
    rows = mine.map((a: any) => fromArticle(a));
  }
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
