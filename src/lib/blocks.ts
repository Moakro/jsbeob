// 블록 본문 편집(관리자 문서·게시글 에디터) 공용 — 관리자 API, 사진 업로드, 블록 ↔ API 변환.
// 복원(2026-11-01): 배포본 _astro/blocks.*.js 기준. parseYouTube 외 함수 이름은 원본에 남지 않아 새로 붙였다
// (압축명: a=adminApi b=resizeImage e=emptyBlock f=fromApi h=hasContent k=fmtKst l=loadImageBlocks
//  n=newImage p=parseYouTube s=searchContent t=toApi u=uploadImage).

async function req<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const err = new Error(data?.error || `요청 실패 (${res.status})`) as Error & { status?: number; data?: any };
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

const jsonBody = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export type ContentKind = "article" | "place";
const seg = (kind: ContentKind) => (kind === "article" ? "articles" : "places");

/** 관리자 API (/api/admin/*) */
export const adminApi = {
  list: (kind: ContentKind, section?: string) =>
    req(`/api/admin/content/${seg(kind)}${kind === "article" ? `?section=${section}` : ""}`),
  get: (kind: ContentKind, id: string) => req(`/api/admin/content/${seg(kind)}/${id}`),
  create: (kind: ContentKind, input: unknown) => req(`/api/admin/content/${seg(kind)}`, jsonBody("POST", input)),
  update: (kind: ContentKind, id: string, input: unknown) =>
    req(`/api/admin/content/${seg(kind)}/${id}`, jsonBody("PUT", input)),
  remove: (kind: ContentKind, id: string) => req(`/api/admin/content/${seg(kind)}/${id}`, { method: "DELETE" }),
  revisions: (kind: ContentKind, id: string) => req(`/api/admin/content/${seg(kind)}/${id}/revisions`),
  orderChapters: (bookId: string, ids: string[]) =>
    req(`/api/admin/content/articles/${encodeURIComponent(bookId)}/chapters/order`, jsonBody("PUT", { ids })),
  revision: (id: string) => req(`/api/admin/revisions/${id}`),

  listPoints: () => req("/api/admin/points"),
  getPoint: (id: string) => req(`/api/admin/points/${encodeURIComponent(id)}`),
  createPoint: (input: unknown) => req("/api/admin/points", jsonBody("POST", input)),
  updatePoint: (id: string, input: unknown) => req(`/api/admin/points/${encodeURIComponent(id)}`, jsonBody("PUT", input)),
  removePoint: (id: string) => req(`/api/admin/points/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // 지부·분원 (2026-11-06) — code 는 회원 소속이 참조하므로 새로 만들 때만 정한다
  listBranches: () => req("/api/admin/branches"),
  getBranch: (code: string) => req(`/api/admin/branches/${encodeURIComponent(code)}`),
  createBranch: (input: unknown) => req("/api/admin/branches", jsonBody("POST", input)),
  updateBranch: (code: string, input: unknown) =>
    req(`/api/admin/branches/${encodeURIComponent(code)}`, jsonBody("PUT", input)),
  removeBranch: (code: string) => req(`/api/admin/branches/${encodeURIComponent(code)}`, { method: "DELETE" }),
  orderBranches: (codes: string[]) => req("/api/admin/branches/order", jsonBody("PUT", { codes })),

  listTags: () => req("/api/admin/tags"),
  getTag: (id: string) => req(`/api/admin/tags/${encodeURIComponent(id)}`),
  createTag: (input: unknown) => req("/api/admin/tags", jsonBody("POST", input)),
  updateTag: (id: string, input: unknown) => req(`/api/admin/tags/${encodeURIComponent(id)}`, jsonBody("PUT", input)),
  removeTag: (id: string) => req(`/api/admin/tags/${encodeURIComponent(id)}`, { method: "DELETE" }),
  orderTags: (ids: string[]) => req("/api/admin/tags/order", jsonBody("PUT", { ids })),

  listMediaVideos: () => req("/api/admin/media-videos"),
  saveMediaVideo: (id: string, input: unknown) =>
    req(`/api/admin/media-videos/${encodeURIComponent(id)}`, jsonBody("PUT", input)),

  listHomeTiles: () => req("/api/admin/home-tiles"),
  createHomeTile: (input: unknown) => req("/api/admin/home-tiles", jsonBody("POST", input)),
  updateHomeTile: (id: string, input: unknown) =>
    req(`/api/admin/home-tiles/${encodeURIComponent(id)}`, jsonBody("PUT", input)),
  removeHomeTile: (id: string) => req(`/api/admin/home-tiles/${encodeURIComponent(id)}`, { method: "DELETE" }),
  orderHomeTiles: (ids: string[]) => req("/api/admin/home-tiles/order", jsonBody("PUT", { ids })),
  getHomeHero: () => req("/api/content/home-hero"),
  saveHomeHero: (mediaId: string | null) => req("/api/admin/home-hero", jsonBody("PUT", { mobile_media_id: mediaId })),

  listMedia: (opts: { q?: string; offset?: number; limit?: number }) => {
    const sp = new URLSearchParams();
    if (opts.q) sp.set("q", opts.q);
    if (opts.offset) sp.set("offset", String(opts.offset));
    if (opts.limit) sp.set("limit", String(opts.limit));
    return req(`/api/admin/media?${sp}`);
  },
  uploadMedia: (blob: Blob, width: number, height: number) =>
    req("/api/admin/media", {
      method: "POST",
      headers: { "Content-Type": blob.type, "X-Image-Width": String(width), "X-Image-Height": String(height) },
      body: blob,
    }),
  updateMedia: (id: string, input: unknown) => req(`/api/admin/media/${id}`, jsonBody("PATCH", input)),
  deleteMedia: (id: string) => req(`/api/admin/media/${id}`, { method: "DELETE" }),

  listUsers: () => req("/api/admin/users"),
  updateUserLevel: (id: string, level: number) =>
    req(`/api/admin/users/${encodeURIComponent(id)}`, jsonBody("PATCH", { level })),
};

/** 사진을 긴 변 max 픽셀 이하 WebP 로 줄인다(EXIF 방향 반영). */
export async function resizeImage(file: Blob, max = 2400) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const width = Math.max(1, Math.round(bmp.width * scale));
  const height = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("사진을 처리할 수 없습니다");
  ctx.drawImage(bmp, 0, 0, width, height);
  (bmp as any).close?.();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.88));
  if (!blob) throw new Error("사진 변환에 실패했습니다");
  return { blob, width, height };
}

/** DB 시각(UTC, "YYYY-MM-DD HH:MM:SS" 또는 ISO) → KST "YYYY-MM-DD HH:MM" */
export function fmtKst(s: string | null | undefined) {
  if (!s) return "";
  const iso = /Z$|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(" ", "T") + "Z";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? s : new Date(d.getTime() + 9 * 36e5).toISOString().slice(0, 16).replace("T", " ");
}

/** 유튜브 주소(또는 11자 ID) → 영상 ID */
export function parseYouTube(input: string): string | null {
  const v = input.trim();
  if (/^[\w-]{11}$/.test(v)) return v;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      const q = u.searchParams.get("v");
      if (q && /^[\w-]{11}$/.test(q)) return q;
      const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{11})/);
      if (m) return m[2];
    }
  } catch {
    /* 주소가 아님 */
  }
  return null;
}

// ── 편집용 블록 ──
let keySeq = 0;
/** 편집기 안에서만 쓰는 고유 키(each 키) */
const newKey = () => `k${Date.now().toString(36)}${++keySeq}`;

export interface EditImage {
  _k: string;
  media_id: string | null;
  key: string | null;
  caption: string;
  view_url: string | null;
}

export type BlockType = "heading" | "text" | "quote" | "image" | "video" | "link" | "imageref" | "map";

export interface EditBlock {
  _k: string;
  id?: string;
  type: BlockType;
  text: string;
  source: string;
  caption: string;
  images: EditImage[];
  video: string;
  url: string;
  label: string;
  ref: any;
  source_ref: any;
  block: any;
  view_thumbs: any[];
  view_title: string | null;
  view_kind: string | null;
  view_href: string | null;
  point: string | null;
  view_point: any;
}

export function newImage(i: Partial<EditImage>): EditImage {
  return { _k: newKey(), media_id: i.media_id ?? null, key: i.key ?? null, caption: i.caption ?? "", view_url: i.view_url ?? null };
}

export function emptyBlock(type: BlockType): EditBlock {
  return {
    _k: newKey(),
    type,
    text: "",
    source: "",
    caption: "",
    images: [],
    video: "",
    url: "",
    label: "",
    ref: null,
    source_ref: null,
    block: null,
    view_thumbs: [],
    view_title: null,
    view_kind: null,
    view_href: null,
    point: null,
    view_point: null,
  };
}

/** API(편집용 응답) 블록 → 편집 블록 */
export function fromApi(blocks: any[] | null | undefined): EditBlock[] {
  return (blocks ?? []).map((b) => ({
    ...emptyBlock(b.type),
    id: b.id,
    text: b.text ?? "",
    source: b.source ?? "",
    caption: b.caption ?? "",
    // 예전 단일 이미지 블록(media_id/key 직접)은 items 하나로 본다
    images: (Array.isArray(b.items) ? b.items : b.media_id || b.key ? [b] : []).map((i: any) =>
      newImage({ media_id: i.media_id, key: i.key, caption: i === b ? "" : i.caption, view_url: i.view_url }),
    ),
    video: b.video_id ?? "",
    url: b.url ?? "",
    label: b.label ?? "",
    ref: b.ref ?? null,
    source_ref: b.source_ref ?? null,
    block: b.block ?? null,
    view_thumbs: Array.isArray(b.view_thumbs) ? b.view_thumbs : [],
    view_title: b.view_title ?? null,
    view_kind: b.view_kind ?? null,
    view_href: b.view_href ?? null,
    point: b.point ?? null,
    view_point: b.view_point ?? null,
  }));
}

/** 편집 블록 → API 저장 형식. 빈 블록은 뺀다. */
export function toApi(blocks: EditBlock[]) {
  const out: any[] = [];
  for (const b of blocks) {
    const base = b.id ? { id: b.id, type: b.type } : { type: b.type };
    if (b.type === "heading") {
      if (!b.text.trim()) continue;
      out.push({ ...base, text: b.text });
    } else if (b.type === "text") {
      if (!b.text.trim()) continue;
      out.push({ ...base, text: b.text });
    } else if (b.type === "quote") {
      if (!b.text.trim() && !b.source.trim() && !b.source_ref) continue;
      out.push({ ...base, text: b.text, source: b.source, ...(b.source_ref ? { source_ref: b.source_ref } : {}) });
    } else if (b.type === "image") {
      const items = b.images
        .filter((i) => i.media_id || i.key)
        .map((i) => ({ ...(i.media_id ? { media_id: i.media_id } : { key: i.key }), caption: i.caption }));
      if (!items.length) continue;
      out.push({ ...base, items, caption: b.caption });
    } else if (b.type === "video") {
      if (!b.video.trim() && !b.caption.trim()) continue;
      out.push({ ...base, video_id: b.video, caption: b.caption });
    } else if (b.type === "imageref") {
      if (!b.ref || !b.block) {
        if (b.caption.trim()) out.push({ ...base, caption: b.caption });
        continue;
      }
      out.push({ ...base, ref: b.ref, block: b.block, caption: b.caption });
    } else if (b.type === "map") {
      if (b.point) out.push({ ...base, point: b.point, caption: b.caption });
      else if (b.caption.trim()) out.push({ ...base, caption: b.caption });
    } else if (b.type === "link") {
      if (b.ref) out.push({ ...base, ref: b.ref });
      else if (b.url.trim() || b.label.trim()) out.push({ ...base, url: b.url, label: b.label });
    }
  }
  return out;
}

/** 블록에 저장할 내용이 있는지 */
export function hasContent(b: EditBlock) {
  return toApi([b]).length > 0;
}

/** 회원 사진 업로드(/api/upload/image) — 1600px WebP 로 줄이고 SHA-256 해시로 중복을 막는다. */
export async function uploadImage(file: Blob) {
  const { blob, width, height } = await resizeImage(file, 1600);
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  const hash = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const res = await fetch("/api/upload/image", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": blob.type,
      "X-Upload-Hash": hash,
      "X-Image-Width": String(width),
      "X-Image-Height": String(height),
    },
    body: blob,
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !data.key) throw new Error(data?.error || `사진을 올리지 못했습니다 (${res.status})`);
  return { key: data.key as string, view_url: (data.view_url ?? data.url) as string };
}

/** 자료 검색(링크·인용 블록의 대상 고르기) */
export async function searchContent(q: string, kinds?: string[]) {
  const k = kinds?.length ? `&kinds=${kinds.join(",")}` : "";
  const res = await fetch(`/api/content/search?q=${encodeURIComponent(q)}${k}`, { credentials: "same-origin" });
  return res.ok ? ((await res.json()) as any).items ?? [] : [];
}

/** 다른 문서의 이미지 블록 목록(이미지 참조 블록용) */
export async function loadImageBlocks(kind: string, id: string) {
  const res = await fetch(`/api/content/imageblocks?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`);
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(data?.error || "이미지 블록을 불러오지 못했습니다");
  return data.blocks ?? [];
}
