// 편집진 올림함(＋ 올리기) — 화면 쪽 도우미 (2026-11-27, docs/design/ai-intake.md 0단계)
// API: jsbeob-api/intake.ts. 편집진(60) 이상만 쓴다 — 화면은 숨기기만 하고, 권한은 API 가 항상 검사한다.
import { LEVEL } from "../data/levels";
import { decodeImage } from "./blocks";

/** 올림함을 쓰는 최소 등급(API 의 INTAKE_LEVEL 과 같음) */
export const INTAKE_LEVEL = LEVEL.EDITOR;
export const INBOX_PATH = "/editor/inbox/";
/** 올린 뒤·버린 뒤 ＋ 배지 숫자를 다시 읽게 알리는 window 이벤트 */
export const INTAKE_CHANGED = "jb:intake-changed";
/** 어디서나 올리기 창을 여는 window 이벤트 */
export const INTAKE_OPEN = "jb:intake-open";

export const MAX_FILES = 10;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_DOC_BYTES = 20 * 1024 * 1024;
/** 파일 고르기 창에 거는 형식 */
export const ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.hwp,.hwpx,.doc,.docx,image/*,application/pdf";
const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;
const DOC_EXT = /\.(pdf|hwp|hwpx|docx?)$/i;

export interface IntakeFile {
  n: number;
  name: string;
  content_type: string;
  size: number;
  file_url: string | null;
}
export interface Intake {
  id: string;
  status: "uploaded" | "extracting" | "ready" | "failed" | "published" | "discarded";
  source: string;
  hint: string | null;
  note: string | null;
  url: string | null;
  user: { id: string; name: string | null };
  files: IntakeFile[];
  kind: string | null;
  title: string | null;
  draft_blocks: any[];
  warnings: IntakeWarning[];
  /** 글에서 뺀 내용(담당자 연락처·회신 기한 등) — 편집진만 본다 */
  excluded: { kind: string; text: string; reason: string }[];
  doc_type: string | null;
  model: string | null;
  attempts: number;
  /** AI 가 읽을 수 있는 원본(JPG·PNG·WebP·PDF·메모)이 있나 — 없으면 직접 작성만 */
  ai_readable: boolean;
  error: string | null;
  post_id: string | null;
  post: { id: string; title: string; board: string } | null;
  /** '달력만 등록'으로 만든 일정 id */
  event_ids: string[];
  /** 한 건 보기에서만: 만든 일정·같은 파일을 올린 다른 건·달력의 비슷한 일정 (2단계 중복 경고) */
  events?: IntakeEvent[];
  same_file?: SameFileIntake[];
  similar_events?: SimilarEvents[];
  handled_by: { id: string; name: string | null } | null;
  created_at: string;
  updated_at: string;
  purge_after: string | null;
  purged_at: string | null;
}

export interface IntakeEvent {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  is_public: number;
  memo: string | null;
}
export interface SameFileIntake {
  id: string;
  status: Intake["status"];
  created_at: string;
  user: { id: string; name: string | null };
  post: { id: string; title: string; board: string } | null;
  event_count: number;
}
export interface SimilarEvent {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  is_annual: number;
  is_public: number;
  category: string | null;
  source_post_id: string | null;
  source_block_id: string | null;
  source_board: string | null;
  source_category: string | null;
  score: number;
}
export interface SimilarEvents {
  label: string;
  start: string;
  end: string | null;
  matches: SimilarEvent[];
}
/** 달력에서 그 일정을 여는 주소 — 그달로 가서 그날을 고르고 일정 내용을 펼친다 */
export function calendarHref(date: string, eventId?: string) {
  const [y, m] = date.split("-").map(Number);
  return `/calendar/?y=${y}&m=${m}&d=${date}${eventId ? `&ev=${encodeURIComponent(eventId)}` : ""}`;
}
/** 달력만 등록할 일정 하나(편집 칸) */
export interface CalendarDraft {
  on: boolean;
  label: string;
  start: string;
  end: string;
  memo: string;
}
/** 초안의 일정 블록 → '달력만 등록' 편집 칸 (일정 블록이 없으면 빈 칸 하나) */
export function calendarDrafts(it: Pick<Intake, "draft_blocks" | "title">): CalendarDraft[] {
  const rows = (it.draft_blocks ?? [])
    .filter((b) => b?.type === "schedule")
    .map((b) => ({ on: true, label: b.label || it.title || "", start: b.start || "", end: b.end || "", memo: b.memo || "" }));
  return rows.length ? rows : [{ on: true, label: it.title ?? "", start: "", end: "", memo: "" }];
}

export interface IntakeWarning {
  level: "check" | "info";
  text: string;
}

export const STATUS_LABEL: Record<Intake["status"], string> = {
  uploaded: "올림",
  extracting: "AI 처리 중",
  ready: "초안 준비",
  failed: "실패",
  published: "게시됨",
  discarded: "버림",
};
export const HINT_LABEL: Record<string, string> = { event_notice: "일정·소식", photos: "사진", document: "자료" };
export const KIND_LABEL: Record<string, string> = { ...HINT_LABEL, unknown: "종류 모름" };
export const EXCLUDED_LABEL: Record<string, string> = {
  person_contact: "개인 연락처",
  person_name: "사람 이름",
  private_talk: "사적인 말",
  internal_request: "우리 단체 할 일",
  internal_deadline: "회신·제출 기한",
  doc_meta: "문서 정보",
  seal: "직인·서명",
  financial: "계좌 등",
  canceled_event: "취소된 약속",
  other: "기타",
};
/** 상태 이름 — 'uploaded' 는 AI 가 읽을 수 있으면 '처리 대기', 아니면 '올림'(직접 작성) */
export function statusLabel(it: Pick<Intake, "status" | "ai_readable">) {
  return it.status === "uploaded" && it.ai_readable ? "처리 대기" : STATUS_LABEL[it.status];
}
/** AI 처리를 기다리는 중인가(화면이 몇 초마다 다시 묻는다) */
export function isProcessing(it: Pick<Intake, "status" | "ai_readable">) {
  return it.status === "extracting" || (it.status === "uploaded" && it.ai_readable);
}
export const checkCount = (it: Pick<Intake, "warnings">) => (it.warnings ?? []).filter((w) => w.level !== "info").length;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(data?.error || `요청 실패 (${res.status})`);
  return data as T;
}

export const intakeApi = {
  list: (status: "open" | "published" | "discarded" | "all" = "open", before?: string | null) =>
    req<{ items: Intake[]; next: string | null; open: number }>(
      `/api/intake?status=${status}${before ? `&before=${encodeURIComponent(before)}` : ""}`,
    ),
  count: () => req<{ open: number }>("/api/intake/count"),
  get: (id: string) => req<{ intake: Intake }>(`/api/intake/${id}`),
  discard: (id: string) => req<{ ok: boolean }>(`/api/intake/${id}`, { method: "DELETE" }),
  /** AI 다시 읽기·다시 시도 — 감시 서비스가 다음 확인(30초 안) 때 가져간다 */
  extract: (id: string, hint?: string | null) =>
    req<{ intake: Intake }>(`/api/intake/${id}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hint === undefined ? {} : { hint }),
    }),
  /** 달력만 등록 — 소식 글 없이 일정만 달력에 */
  publishCalendar: (id: string, events: { label: string; start: string; end?: string; memo?: string }[], isPublic: boolean) =>
    req<{ intake: Intake }>(`/api/intake/${id}/calendar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events, public: isPublic }),
    }),
  /** 달력 등록 되돌리기 — 만든 일정을 지우고 게시 전으로 */
  undoCalendar: (id: string) => req<{ intake: Intake }>(`/api/intake/${id}/calendar`, { method: "DELETE" }),
};

export interface UploadResult {
  ok: boolean;
  intake: Intake;
  duplicate?: boolean;
  /** 같은 파일을 이미 올렸을 때 — 막지 않고 새 건을 만든 뒤 알려 준다 */
  duplicate_of?: SameFileIntake;
  notice?: string;
  replayed?: boolean;
  warning?: string;
}

/**
 * 올리기 — multipart(files[], note, url, hint, source). 진행률은 XHR 로 받는다.
 * 같은 묶음을 다시 보낼 때(전송 끊김 → 다시 시도) 같은 idemKey 를 쓰면 서버가 새 건을 만들지 않는다.
 */
export function uploadIntake(
  input: { files: Blob[]; names: string[]; note: string; url: string; hint: string },
  idemKey: string,
  onProgress: (ratio: number) => void,
): Promise<UploadResult> {
  const fd = new FormData();
  input.files.forEach((f, i) => fd.append("files[]", f, input.names[i]));
  if (input.note) fd.append("note", input.note);
  if (input.url) fd.append("url", input.url);
  if (input.hint) fd.append("hint", input.hint);
  fd.append("source", "web");
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", "/api/intake");
    x.withCredentials = true;
    x.setRequestHeader("Idempotency-Key", idemKey);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => {
      let data: any = {};
      try {
        data = JSON.parse(x.responseText);
      } catch {}
      if (x.status >= 200 && x.status < 300) resolve(data);
      else reject(new Error(data?.error || `올리기 실패 (${x.status})`));
    };
    x.onerror = () => reject(new Error("전송이 끊겼습니다. 다시 시도해 주세요."));
    x.send(fd);
  });
}

export function isImageName(name: string, type = "") {
  return IMAGE_EXT.test(name) || /^image\//.test(type);
}
export function isAcceptedName(name: string, type = "") {
  return isImageName(name, type) || DOC_EXT.test(name) || type === "application/pdf";
}

/**
 * 올리기 전 사진 손보기 — 공문 글씨가 뭉개지지 않게 크게 둔다 (설계 5장).
 * - 보통 사진: 긴 변 2400px 이하 JPG. 이미 작고 가벼운 JPG·PNG 는 그대로(PNG 캡처 글씨가 선명하게)
 * - 세로로 아주 긴 캡처(카톡 등): 긴 변이 아니라 가로 폭 기준 — 폭 1440px 이하로만 줄인다
 * - HEIC: 브라우저가 열 수 있으면 JPG 로 바꾼다. 못 열면 원본 그대로(서버가 보관만)
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; name: string; note?: string }> {
  const heic = /\.(heic|heif)$/i.test(file.name) || /hei[cf]/i.test(file.type);
  let src: ImageBitmap | HTMLImageElement;
  try {
    src = await decodeImage(file, 2400);
  } catch {
    return { blob: file, name: file.name, note: heic ? "HEIC 원본 그대로 올림(이 브라우저에서 열 수 없음)" : undefined };
  }
  const w = (src as any).naturalWidth || src.width;
  const h = (src as any).naturalHeight || src.height;
  const tall = h > w * 2.2;
  const scale = tall ? Math.min(1, 1440 / w) : Math.min(1, 2400 / Math.max(w, h));
  const small = scale === 1 && file.size <= 3 * 1024 * 1024;
  if (!heic && small && /\.(jpe?g|png)$/i.test(file.name)) {
    (src as any).close?.();
    return { blob: file, name: file.name };
  }
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { blob: file, name: file.name };
  ctx.fillStyle = "#fff"; // 투명 PNG → JPG 바탕
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(src, 0, 0, cw, ch);
  (src as any).close?.();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  if (!blob) return { blob: file, name: file.name };
  return { blob, name: file.name.replace(/\.[^.]+$/, "") + ".jpg" };
}

export function fmtSize(n: number) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

/** DB 시각(UTC "YYYY-MM-DD HH:MM:SS") → "오늘 14:20" / "11.26 14:20" / "2025.11.26" (한국 시간) */
export function fmtWhen(s: string, now = new Date()) {
  const t = new Date(s.replace(" ", "T") + (s.endsWith("Z") ? "" : "Z"));
  const k = new Date(t.getTime() + 9 * 3600e3);
  const n = new Date(now.getTime() + 9 * 3600e3);
  const hm = `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
  if (k.getUTCFullYear() !== n.getUTCFullYear()) return `${k.getUTCFullYear()}.${k.getUTCMonth() + 1}.${k.getUTCDate()}`;
  if (k.getUTCMonth() === n.getUTCMonth() && k.getUTCDate() === n.getUTCDate()) return `오늘 ${hm}`;
  return `${k.getUTCMonth() + 1}.${k.getUTCDate()} ${hm}`;
}

/** 올림 → 편집기 처음 내용. AI 초안(draft_blocks)이 있으면 그것, 없으면 메모·주소를 글 블록 하나로(0단계) */
export function intakeStartBlocks(it: Intake): any[] {
  if (it.draft_blocks?.length) return it.draft_blocks;
  const text = [it.note?.trim(), it.url?.trim()].filter(Boolean).join("\n\n");
  return text ? [{ type: "text", text }] : [];
}
