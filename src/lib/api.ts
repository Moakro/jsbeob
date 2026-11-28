/** jsbeob-api(worker) 호출 헬퍼. 사이트 Worker 의 /api/* 가 API Worker 로 넘겨 준다(같은 출처). */
// 복원(2026-11-01): 배포본 서버 Base 청크(주석 포함)와 클라이언트 _astro/api.*.js 기준.

export interface MemberInfo {
  /** 교인 인증 지부 코드(src/data/branches.ts) */
  branch: string;
  real_name: string;
}

export interface MeUser {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  affiliation: string | null;
  level: number;
  needs_nickname?: boolean;
  member?: MemberInfo | null;
  /** 처리 전 신고(대상 수) — 관리자에게만 온다 (2026-11-28) */
  reports_open?: number;
}

export interface PostAuthor {
  display_name: string | null;
  avatar_url: string | null;
  affiliation: string | null;
  level: number;
  /** 교인 인증 지부 코드 */
  branch?: string | null;
}

export interface PostAttachment {
  type: "image" | "video" | "map";
  url?: string;
  width?: number;
  height?: number;
  provider?: string;
  videoId?: string;
}

/** 소식 일정 기간(달력에 들어간 일정) */
export interface Period {
  start: string;
  end: string | null;
}

export interface PostSummary {
  id: string;
  board: string;
  category: string | null;
  title: string;
  attachments: PostAttachment[];
  cover_image: string | null;
  view_count: number;
  comment_count: number;
  is_pinned: boolean;
  /** 글마다 비공개(options.private_posts 게시판, 2026-11-21) */
  is_private?: boolean;
  /** 볼 수 없는 비공개 글 — 제목·글쓴이·본문이 비어 있고 등록일시만 온다 */
  locked?: boolean;
  /** 관리자가 숨긴 글(신고 처리) — 글쓴이·관리자에게만 온다 (2026-11-28) */
  is_hidden?: boolean;
  /** 목록용 본문 앞부분(오리알터 피드 카드) */
  excerpt?: string;
  /** 본문 첫 블록이 소제목이면 그 글 — 오리알터 카드에서 제목으로 굵게 (2026-11-28) */
  lead_heading?: string;
  period: Period | null;
  /** 최근 댓글 한 건(오리알터 피드 카드 아래 미리보기) */
  last_comment?: { body: string; author: string; created_at: string };
  created_at: string;
  updated_at: string;
  author: PostAuthor;
  author_id: string;
}

export interface PostDetail extends PostSummary {
  body_html: string;
  body_md: string;
  /** 공식 콘텐츠 글의 실제 등록자 — 권한자에게만 온다 */
  registered_by?: string;
  [k: string]: unknown;
}

export interface ListPostsParams {
  board?: string;
  from?: string;
  category?: string;
  before?: string;
  q?: string | string[];
  has_image?: boolean;
  limit?: number;
  author?: string;
  page?: number;
}

export interface ListPostsResult {
  posts: PostSummary[];
  next: string | null;
  has_more: boolean;
  page?: number;
  total?: number;
  pages?: number;
}

/** 회원 등급 라벨 — 정의는 src/data/levels.ts */
export { LEVEL, LEVEL_LABEL, LEVELS } from "../data/levels";
import { LEVEL } from "../data/levels";
import { kstDateText, periodText } from "../data/date-text";

/** 오리알터 피드 필터 변경 이벤트(window CustomEvent) */
export const ORIALTER_FILTER_EVENT = "jb:orialter-filter";
/** 소식 모달 열기 이벤트(window CustomEvent) */
export const NEWS_OPEN_EVENT = "jb:news-open";

/** 일정 기간 → "2026.10.01(목) ~ 10.03(토)" — 규칙은 src/data/date-text.ts (일정 블록과 공용) */
export function fmtPeriodFull(p: Period | null | undefined) {
  return p ? periodText(p) : "";
}
/** 글 작성 시각 → 한국 날짜 "2026.11.27(금)" */
export const fmtPostDate = kstDateText;

/** SNS 식 상대 시각(KST 날짜 기준): 방금 · n분 전 · n시간 전 · 어제 · n일 전 · 10.3 · 2025.10.3 */
export function snsTime(iso: string, now = new Date()) {
  const t = new Date(iso);
  const sec = Math.max(0, (now.getTime() - t.getTime()) / 1e3);
  if (sec < 60) return "방금";
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  const KST = 9 * 3600 * 1e3;
  const dayNo = (d: Date) => Math.floor((d.getTime() + KST) / 864e5);
  const days = dayNo(now) - dayNo(t);
  if (days <= 1) return "어제";
  if (days < 7) return `${days}일 전`;
  const k = new Date(t.getTime() + KST);
  const md = `${k.getUTCMonth() + 1}.${k.getUTCDate()}`;
  return k.getUTCFullYear() === new Date(now.getTime() + KST).getUTCFullYear() ? md : `${k.getUTCFullYear()}.${md}`;
}

/** 전체 시각(KST): "2026년 10월 3일 오후 3:05" */
export function fullTime(iso: string) {
  const k = new Date(new Date(iso).getTime() + 9 * 3600 * 1e3);
  const h = k.getUTCHours();
  return `${k.getUTCFullYear()}년 ${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 ${h < 12 ? "오전" : "오후"} ${h % 12 || 12}:${String(
    k.getUTCMinutes(),
  ).padStart(2, "0")}`;
}

async function req<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(data?.error || `요청 실패 (${res.status})`);
  return data as T;
}

/**
 * 로그인 확인은 한 페이지에서 한 번만 보내고 나눠 쓴다 (2026-11-21) — 계정 메뉴·피드·문의 상자·소식 팝업 등이
 * 각자 /api/me 를 부르면 같은 요청이 4~5번 나갔다. 실패하면 다음 호출 때 다시 보낸다.
 * 닉네임 저장·로그아웃 뒤에는 resetMe() 로 비운다(대개 페이지를 다시 불러오므로 함께 비워진다).
 */
let mePromise: Promise<{ user: MeUser | null }> | null = null;
export function resetMe() {
  mePromise = null;
}

export const api = {
  me: () => {
    if (!mePromise) {
      mePromise = req<{ user: MeUser | null }>("/api/me");
      mePromise.catch(() => (mePromise = null));
    }
    return mePromise;
  },
  loginUrl: (provider: "kakao" | "google", next: string) =>
    `/api/auth/login?provider=${provider}&next=${encodeURIComponent(next)}`,
  logout: () => (resetMe(), req("/api/auth/logout", { method: "POST" })),
  /** 정보 설정 저장. member: 생략=변경 없음, null=교인 정보 삭제, 객체=저장 */
  setNickname: (nickname: string, affiliation?: string, member?: MemberInfo | null) =>
    (resetMe(), req<{ ok: boolean }>("/api/me/nickname", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(member === undefined ? { nickname, affiliation } : { nickname, affiliation, member }),
    })),
  listPosts: (params: ListPostsParams) => {
    const sp = new URLSearchParams();
    if (params.board) sp.set("board", params.board);
    if (params.from) sp.set("from", params.from);
    if (params.category) sp.set("category", params.category);
    if (params.before) sp.set("before", params.before);
    for (const t of ([] as string[]).concat(params.q ?? [])) if (t) sp.append("q", t);
    if (params.has_image) sp.set("has_image", "1");
    if (params.limit) sp.set("limit", String(params.limit));
    if (params.author) sp.set("author", params.author);
    if (params.page) sp.set("page", String(params.page));
    return req<ListPostsResult>(`/api/posts?${sp.toString()}`);
  },
  /** count=false: 조회수를 올리지 않는다(수정 창·저장 뒤 다시 읽기) */
  getPost: (id: string, count = true) => req<{ post: PostDetail }>(`/api/posts/${id}${count ? "" : "?count=0"}`),
  /** 글 보기 — 볼 수 없는 비공개 글이면 locked 로 등록일시만 돌려준다 (2026-11-21) */
  getPostOrLocked: async (id: string): Promise<{ post: PostDetail } | { locked: { id: string; created_at: string } }> => {
    const res = await fetch(`/api/posts/${id}`, { credentials: "same-origin" });
    const data = await res.json().catch(() => null);
    if (res.status === 403 && data?.private) return { locked: { id, created_at: data.post?.created_at ?? "" } };
    if (!res.ok) throw new Error(data?.error || `요청 실패 (${res.status})`);
    return data as { post: PostDetail };
  },
  /** 비공개 전환 — 글쓴이는 양쪽, 관리자는 비공개로만 */
  setPostPrivate: (id: string, isPrivate: boolean) =>
    req<{ ok: boolean; is_private: boolean }>(`/api/posts/${id}/private`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ private: isPrivate }),
    }),
  /** 게시판 설정(권한·블록) — 2026-11-16 게시판 관리 */
  boards: () => req<{ boards: BoardConfig[] }>("/api/boards"),
  board: (key: string) => req<{ board: BoardConfig }>(`/api/boards/${encodeURIComponent(key)}`),
  /** 최근에 글을 올린 회원(최근 등록순) — 도생광장 오른쪽 회원 목록 */
  listAuthors: (board: string, offset = 0, limit = 10) =>
    req<{ authors: any[]; has_more: boolean }>(
      `/api/posts/authors?board=${encodeURIComponent(board)}&limit=${limit}&offset=${offset}`,
    ),
  /** 상단 고정 토글(운영자) — 소식 게시판에서 고정 글이 '공지'로 보인다. */
  pinPost: (id: string) => req<{ ok: boolean; is_pinned: boolean }>(`/api/posts/${id}/pin`, { method: "POST" }),
  createPost: (input: Record<string, unknown>) =>
    req<{ ok: boolean; id: string }>("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  updatePost: (id: string, input: Record<string, unknown>) =>
    req<{ ok: boolean }>(`/api/posts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  deletePost: (id: string) => req<{ ok: boolean }>(`/api/posts/${id}`, { method: "DELETE" }),
  /** 신고 — 로그인 회원, 이유는 선택. 같은 대상을 다시 신고하면 already=true (2026-11-28) */
  report: (type: "post" | "comment", id: string, reason = "") =>
    req<{ ok: boolean; already: boolean }>(`/api/${type === "post" ? "posts" : "comments"}/${encodeURIComponent(id)}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }),
  /** 신고 목록(관리자) — 대상별로 묶음 */
  adminReports: (all = false) => req<{ reports: ReportGroup[]; open: number }>(`/api/admin/reports${all ? "?status=all" : ""}`),
  /** 숨김·되살리기·문제없음(관리자) — 신고가 없어도 숨김·되살리기는 된다 */
  moderate: (type: "post" | "comment", id: string, action: "hide" | "restore" | "keep") =>
    req<{ ok: boolean; status: string; open: number }>(`/api/admin/reports/${type}/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }),
};

/** 신고 목록 한 줄(관리자) — jsbeob-api/reports.ts adminList */
export interface ReportGroup {
  type: "post" | "comment";
  id: string;
  count: number;
  open: number;
  last_at: string;
  resolution: "hidden" | "restored" | "kept" | null;
  resolved_at: string | null;
  target: {
    id: string;
    status: "published" | "hidden" | "deleted";
    title?: string;
    board?: string;
    excerpt: string;
    cover_image?: string | null;
    post_title?: string | null;
    author: { id: string; name: string | null };
    created_at: string;
    href: string | null;
  } | null;
  items: { reason: string; reporter: string; open: boolean; created_at: string }[];
}

/** ＋ 버튼으로 오리알터에 올린 뒤 알리는 window 이벤트 — 피드가 받으면 detail.handled=true (2026-11-28) */
export const ORIALTER_POSTED = "jb:orialter-posted";

/** 보드 메타 — 라벨·설명·권한. */
/** 게시판 설정 (DB boards 표 — jsbeob-api/boards.ts shapeBoard). 등급 값은 src/data/levels.ts, -1 = 비회원 */
export interface BoardConfig {
  key: string;
  label: string;
  description: string;
  storage: "post" | "article" | "place";
  view: "list" | "feed" | "doc" | "book";
  menu: "community" | "archive" | "about" | "jeongak";
  read_level: number;
  read_scope: "all" | "own";
  create_level: number;
  edit_own: boolean;
  edit_level: number;
  delete_own: boolean;
  delete_level: number;
  comment_level: number | null;
  /** {블록 종류: 최소 등급} — 없는 종류는 사용 안 함 */
  blocks: Record<string, number>;
  /** official: 공식 콘텐츠 — 공개 글쓴이 JSBeob, 실제 등록자는 권한자에게만 */
  options: { notice?: boolean; title_optional?: boolean; photo?: boolean; official?: boolean; private_posts?: boolean; plain_editor?: boolean };
  sort_order: number;
  status: "active" | "hidden";
  builtin: boolean;
  /** 관리자 목록에서만 */
  post_count?: number;
}

export interface BoardMeta {
  key: string;
  label: string;
  desc: string;
  /** 사진 피드형이면 true. */
  photo?: boolean;
  /** 작성 가능 최소 level (기본 LEVEL.GENERAL). 소식은 LEVEL.ADMIN. */
  writeLevel?: number;
  /** 도생광장 탭에 보이는 보드 */
  tab?: boolean;
  /** 글쓴이와 운영자만 보는 보드 */
  private?: boolean;
  /** 기본 경로(/community/<key>) 대신 쓰는 경로 */
  base?: string;
  /** 상위 이동 링크 */
  parent?: { href: string; label: string };
}

export const BOARDS: Record<string, BoardMeta> = {
  // 도생광장(2026-09-28 사장 결정): 공지·법종교 소식 → '소식' 하나(공지는 상단 고정 글).
  // 도생 사진·갤러리 → '오리알터' 하나(교인이 쓰는 사진·글 — 2단계에서 SNS 형식으로 바꾼다). 순서 = 탭 순서.
  orialter: { key: "orialter", label: "오리알터", desc: "도생들이 나누는 사진과 이야기", photo: true, writeLevel: LEVEL.BELIEVER, tab: true },
  news: { key: "news", label: "소식", desc: "법종교 공지와 소식", writeLevel: LEVEL.ADMIN, tab: true },
  // 자료실 '기타 자료' — 정형 자료(도서·주문)가 아닌 자료는 게시물로 올린다(2026-09-28 사장 결정).
  // 지금은 운영자만 쓴다. 편집자 등급을 열면 writeLevel 을 내린다(서버 index.ts BOARD_WRITE_LEVEL 과 같이).
  etc: {
    key: "etc",
    label: "기타 자료",
    desc: "그 밖의 자료",
    writeLevel: LEVEL.ADMIN,
    base: "/archive/etc",
    parent: { href: "/archive/", label: "자료실" },
  },
  help: { key: "help", label: "문의", desc: "문의와 제안 — 비공개로 쓰면 글쓴이와 운영자만 봅니다" },
};

/** 보드 글 경로의 기준. 자료실 게시물은 카테고리 경로(/archive/<category>) 아래에 있다. */
export const boardBase = (board: string, category?: string | null) =>
  board === "etc" ? `/archive/${category || "etc"}` : (BOARDS[board]?.base ?? `/community/${board}`);

export const postHref = (board: string, id: string, category?: string | null) => `${boardBase(board, category)}/${id}/`;
