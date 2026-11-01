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
  /** 목록용 본문 앞부분(오리알터 피드 카드) */
  excerpt?: string;
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

/** 회원 등급 라벨 */
export const LEVEL_LABEL: Record<number, string> = { 0: "대기", 1: "일반", 2: "검증", 3: "큐레이터", 4: "운영자" };

/** 오리알터 피드 필터 변경 이벤트(window CustomEvent) */
export const ORIALTER_FILTER_EVENT = "jb:orialter-filter";
/** 소식 모달 열기 이벤트(window CustomEvent) */
export const NEWS_OPEN_EVENT = "jb:news-open";

/** 일정 기간 → "2026.10.01 ~ 10.03" */
export function fmtPeriodFull(p: Period | null | undefined) {
  if (!p) return "";
  const ymd = (d: string) => d.slice(0, 10).replace(/-/g, ".");
  if (!p.end) return ymd(p.start);
  return `${ymd(p.start)} ~ ${p.start.slice(0, 4) === p.end.slice(0, 4) ? ymd(p.end).slice(5) : ymd(p.end)}`;
}

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

export const api = {
  me: () => req<{ user: MeUser | null }>("/api/me"),
  loginUrl: (provider: "kakao" | "google", next: string) =>
    `/api/auth/login?provider=${provider}&next=${encodeURIComponent(next)}`,
  logout: () => req("/api/auth/logout", { method: "POST" }),
  /** 정보 설정 저장. member: 생략=변경 없음, null=교인 정보 삭제, 객체=저장 */
  setNickname: (nickname: string, affiliation?: string, member?: MemberInfo | null) =>
    req<{ ok: boolean }>("/api/me/nickname", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(member === undefined ? { nickname, affiliation } : { nickname, affiliation, member }),
    }),
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
  getPost: (id: string) => req<{ post: PostDetail }>(`/api/posts/${id}`),
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
};

/** 보드 메타 — 라벨·설명·권한. */
export interface BoardMeta {
  key: string;
  label: string;
  desc: string;
  /** 사진 피드형이면 true. */
  photo?: boolean;
  /** 작성 가능 최소 level (기본 1). 소식은 4(운영자). */
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
  orialter: { key: "orialter", label: "오리알터", desc: "도생들이 나누는 사진과 이야기", photo: true, writeLevel: 2, tab: true },
  news: { key: "news", label: "소식", desc: "법종교 공지와 소식", writeLevel: 4, tab: true },
  // 자료실 '기타 자료' — 정형 자료(도서·주문)가 아닌 자료는 게시물로 올린다(2026-09-28 사장 결정).
  // 지금은 운영자만 쓴다. 편집자 등급을 열면 writeLevel 을 내린다(서버 index.ts BOARD_WRITE_LEVEL 과 같이).
  etc: {
    key: "etc",
    label: "기타 자료",
    desc: "그 밖의 자료",
    writeLevel: 4,
    base: "/archive/etc",
    parent: { href: "/archive/", label: "자료실" },
  },
  help: { key: "help", label: "문의", desc: "문의와 제안 — 글쓴이와 운영자만 봅니다", private: true },
};

/** 보드 글 경로의 기준. 자료실 게시물은 카테고리 경로(/archive/<category>) 아래에 있다. */
export const boardBase = (board: string, category?: string | null) =>
  board === "etc" ? `/archive/${category || "etc"}` : (BOARDS[board]?.base ?? `/community/${board}`);

export const postHref = (board: string, id: string, category?: string | null) => `${boardBase(board, category)}/${id}/`;
