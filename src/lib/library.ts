// 자료실 공용 상수·경로·관리 API — 서버(content.ts)와 클라이언트(관리자·글쓰기) 양쪽에서 쓴다.
// 복원(2026-11-01): 배포본 서버 청크(content_*.mjs)와 클라이언트 청크(_astro/library.*.js) 기준.
import { libraryOrder } from "./content-types";

export interface LibraryCategory {
  key: string;
  label: string;
  type: "article" | "post";
  list_order: "alpha" | "toc" | "recent";
  as_book: boolean;
  sort_order: number;
  place: "main" | "side";
  intro: string | null;
}

/** API 응답이 없을 때 쓰는 기본 카테고리 */
export const DEFAULT_LIBRARY_CATEGORIES: LibraryCategory[] = [
  { key: "book", label: "도서", type: "article", list_order: "alpha", as_book: false, sort_order: 1, place: "main", intro: null },
  { key: "mantra", label: "주문", type: "article", list_order: "alpha", as_book: true, sort_order: 2, place: "main", intro: null },
  { key: "etc", label: "기타 자료", type: "post", list_order: "recent", as_book: true, sort_order: 3, place: "side", intro: null },
];

/** 시리즈 아이콘(Material Symbols) */
export const SERIES_ICON_PATH =
  "M640-260q92 0 156-64.49 64-64.5 64-156Q860-572 796-636q-64-64-156-64-30.51 0-59.33 8.04Q551.86-683.93 527-669q34 38 53.5 86T600-480q0 55-19.5 103T527-291q24.86 14.93 53.67 22.96Q609.49-260 640-260Zm-160-69q28-29 44-68.25t16-83Q540-524 524-563t-44-68q-28 29-44 68.25t-16 83Q420-436 436-397t44 68Zm-160 69q30.51 0 59.33-8.04Q408.14-276.07 433-291q-34-38-53.5-86T360-480q0-55 19.5-103t53.5-86q-24.86-14.93-53.67-22.96Q350.51-700 320-700q-91.3 0-155.65 64Q100-572 100-480.49q0 91.5 64.35 156Q228.7-260 320-260Zm0 60q-117 0-198.5-81.5T40-480q0-117 81.5-198.5T320-760q45 0 85.5 13t74.5 37q34-24 74.5-37t85.5-13q117 0 198.5 81.5T920-480q0 117-81.5 198.5T640-200q-45 0-85.5-13T480-250q-34 24-74.5 37T320-200Z";

/** 게시물형 자료가 들어가는 게시판 */
export const LIBRARY_BOARD = "etc";
/** 경전(content/scripture) 이 붙는 카테고리 */
export const SCRIPTURE_CATEGORY = "book";

export const catHref = (key: string) => `/archive/${encodeURIComponent(key)}/`;
export const articleHref = (kind: string, slug: string) =>
  `/archive/${encodeURIComponent(kind)}/${encodeURIComponent(slug)}/`;
/** 장 주소 안의 장 이름 — 장 slug 가 "책slug-" 로 시작하면 그 뒤만 쓴다 (hwaeundang-silgi-1 → 1). API blocks.ts chapterPath 와 같은 규칙 */
export const chapterKey = (bookSlug: string, chapSlug: string) =>
  chapSlug.startsWith(`${bookSlug}-`) && chapSlug.length > bookSlug.length + 1 ? chapSlug.slice(bookSlug.length + 1) : chapSlug;
export const chapterHref = (kind: string, bookSlug: string, chapSlug: string) =>
  `${articleHref(kind, bookSlug)}${encodeURIComponent(chapterKey(bookSlug, chapSlug))}/`;
/** content/scripture 시절의 옛 경로(/archive/<책>/…)를 받아 줄 책 — 2026-11-14 DB 전환 후에도 주소 유지 */
export const LEGACY_SCRIPTURE_BOOKS = new Set(["hwaeundang-silgi"]);
export const libPostHref = (category: string | null | undefined, id: string) =>
  `/archive/${encodeURIComponent(category || LIBRARY_BOARD)}/${encodeURIComponent(id)}/`;
export const scriptureHref = (book: string, chap?: string) =>
  `/archive/${SCRIPTURE_CATEGORY}/${encodeURIComponent(book)}/${chap ? `${encodeURIComponent(chap)}/` : ""}`;

const ko = new Intl.Collator("ko");

/** 카테고리 목록 정렬 방식(list_order)대로 행을 정렬한다. */
export function sortForCategory<T extends { order: number; title: string; date?: string | null; pinned?: boolean }>(
  listOrder: string,
  rows: T[],
): T[] {
  if (listOrder === "toc") return rows.sort((a, b) => a.order - b.order || ko.compare(a.title, b.title));
  if (listOrder === "recent") return rows.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  return rows.sort(libraryOrder);
}

// ── 자료실 관리 API (클라이언트) ──
async function req<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(data?.error || `요청 실패 (${res.status})`);
  return data as T;
}
const jsonBody = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const library = {
  categories: () => req("/api/library/categories"),
  createCategory: (input: Partial<LibraryCategory>) => req("/api/library/categories", jsonBody("POST", input)),
  updateCategory: (key: string, input: Partial<LibraryCategory>) =>
    req(`/api/library/categories/${encodeURIComponent(key)}`, jsonBody("PUT", input)),
  orderCategories: (keys: string[]) => req("/api/library/categories/order", jsonBody("PUT", { keys })),
  deleteCategory: (key: string) => req(`/api/library/categories/${encodeURIComponent(key)}`, { method: "DELETE" }),
  series: () => req("/api/library/series"),
  createSeries: (title: string) => req("/api/library/series", jsonBody("POST", { title })),
};
