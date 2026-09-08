/** jsbeob-api(worker) 호출 헬퍼. dev에선 vite proxy로 :8788, prod에선 동일 출처. */

export interface MeUser {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  affiliation: string | null;
  level: number;
  needs_nickname?: boolean;
}

export interface PostAuthor {
  display_name: string | null;
  avatar_url: string | null;
  affiliation: string | null;
  level: number;
}

export interface PostAttachment {
  type: "image" | "video" | "map";
  url?: string;
  width?: number;
  height?: number;
  provider?: string;
  videoId?: string;
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
  created_at: string;
  updated_at: string;
  author: PostAuthor;
  author_id: string;
}

export interface PostDetail extends PostSummary {
  body_html: string;
  body_md: string;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
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

  setNickname: (nickname: string, affiliation?: string) =>
    req<{ ok: boolean }>("/api/me/nickname", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname, affiliation }),
    }),

  listPosts: (params: {
    board?: string;
    category?: string;
    before?: string;
    q?: string;
    has_image?: boolean;
    limit?: number;
  }) => {
    const sp = new URLSearchParams();
    if (params.board) sp.set("board", params.board);
    if (params.category) sp.set("category", params.category);
    if (params.before) sp.set("before", params.before);
    if (params.q) sp.set("q", params.q);
    if (params.has_image) sp.set("has_image", "1");
    if (params.limit) sp.set("limit", String(params.limit));
    return req<{ posts: PostSummary[]; next: string | null; has_more: boolean }>(
      `/api/posts?${sp.toString()}`,
    );
  },

  getPost: (id: string) => req<{ post: PostDetail }>(`/api/posts/${id}`),

  createPost: (input: {
    board: string;
    title: string;
    body: string;
    category?: string | null;
    attachments?: PostAttachment[];
  }) =>
    req<{ ok: boolean; id: string }>("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),

  updatePost: (
    id: string,
    input: { title: string; body: string; category?: string | null; attachments?: PostAttachment[] },
  ) =>
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
  /** sns 등 사진 피드형이면 true. */
  photo?: boolean;
  /** 작성 가능 최소 level (기본 1). 공지·소식은 4(운영자). */
  writeLevel?: number;
}

export const BOARDS: Record<string, BoardMeta> = {
  notice: { key: "notice", label: "공지", desc: "법종교 알림·사이트 공지", writeLevel: 4 },
  jsnews: { key: "jsnews", label: "법종교 소식", desc: "교단의 새 소식", writeLevel: 4 },
  sns: { key: "sns", label: "도생 사진", desc: "교인들이 나누는 사진", photo: true },
  album: { key: "album", label: "갤러리", desc: "법종교 앨범", photo: true },
  book: { key: "book", label: "경전·도서", desc: "경전과 간행 도서" },
  mantra: { key: "mantra", label: "주문·수행", desc: "주문과 수행법" },
  ritual: { key: "ritual", label: "의식·예법", desc: "법종교의 의식과 예법" },
  etc: { key: "etc", label: "기타 자료", desc: "그 밖의 자료" },
  help: { key: "help", label: "문의·제안", desc: "문의와 제안" },
};
