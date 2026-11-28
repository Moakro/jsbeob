#!/usr/bin/env node
// jsbooks 형식 경전 마크다운 → 자료실 DB 책(책 글 1 + 장 글 N, 장 본문은 '절' 블록) (2026-11-14)
//
// 쓰는 법 (로컬 API 기준, 관리자 쿠키 필요 — pnpm dev:login 이 찍어 주는 jb_session 값):
//   JB_SESSION=… node scripts/import-scripture.mjs <폴더> --book <책slug> [--kind book] [--api http://127.0.0.1:<API 포트, 기본 8788>]
//                [--status published|draft|keep] [--no-book] [--dry]
//   --status keep : 이미 있는 글은 지금 공개 상태를 그대로 두고(새 글만 draft), 본문만 바꾼다
//   --no-book     : 책 글(부모)은 건드리지 않고 이미 있는 책 아래 장만 수정한다(책 slug 로 찾음)
//
// 입력 폴더: 00_서문.md, 01_제1장.md … 99_부록.md (파일 이름 순서 = 장 순서)
//   프론트매터: scripture, scripture_hanja, 편자, 편자_한자, 장, 장_이름, section(preface|appendix)
//              선택: slug(장 글 slug 직접 지정), 제목(장 제목 직접 지정), meta(한 줄 JSON — 장 글 meta)
//   본문: "# 제목"(무시) / "## N절" → 절 블록 / 빈 줄로 나뉜 문단 = 문장 한 줄, 끝의 "^1-1-3" = 문장 위치
//   서문·부록처럼 절 머리가 없으면 문단마다 preface-N / appendix-N 위치를 붙인 절 블록(이름 없음)
//   [[대상|별칭]] 위키링크는 그대로 둔다(화면에는 별칭 글자, 나중 관련링크 작업의 출발점)
//
// 같은 slug 가 이미 있으면 PUT(수정)으로 덮어쓴다 — 수정 이력은 API 가 남긴다.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { loadDevPorts } from "./dev-ports.mjs";
import { parseFront, toBlocks } from "./scripture/jsbooks-md.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const dir = args[0];
const BOOK = opt("book");
const KIND = opt("kind", "book");
const PORTS = loadDevPorts();
const API = opt("api", `http://127.0.0.1:${PORTS.api}`);
const STATUS = opt("status", "published");
const DRY = args.includes("--dry");
const NO_BOOK = args.includes("--no-book");
const COOKIE = process.env.JB_SESSION ? `jb_session=${process.env.JB_SESSION}` : "";
if (!dir || !BOOK) {
  console.error("사용: JB_SESSION=… node scripts/import-scripture.mjs <폴더> --book <책slug> [--kind book] [--dry]");
  process.exit(1);
}
if (!DRY && !COOKIE) {
  console.error("JB_SESSION(관리자 쿠키 값)이 필요합니다. pnpm dev:login 출력의 jb_session= 뒤 값을 넣으세요.");
  process.exit(1);
}

async function api(method, p, body) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: COOKIE, Origin: `http://localhost:${PORTS.site}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${data.error ?? ""}`);
  return data;
}

const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
const chapters = [];
let bookMeta = null;
for (const f of files) {
  const { data, body } = parseFront(readFileSync(path.join(dir, f), "utf8"));
  bookMeta ??= data;
  const sec = data.section; // preface | appendix | undefined
  const key = sec === "preface" ? "preface" : sec === "appendix" ? "appendix" : String(data.장);
  const title = sec === "preface" ? "서문" : sec === "appendix" ? "부록" : `제${data.장}장${data.장_이름 ? ` ${data.장_이름}` : ""}`;
  const { blocks, noAnchor } = toBlocks(body, sec ? sec : null);
  const sentences = blocks.filter((b) => b.type === "verse").reduce((n, b) => n + b.lines.length, 0);
  chapters.push({
    key,
    title: data.제목 ?? title,
    slug: data.slug ?? `${BOOK}-${key}`,
    meta: data.meta ?? null,
    blocks,
    sentences,
    noAnchor,
    file: f,
  });
}

console.log(`책 ${bookMeta.scripture} (${BOOK}) — 장 ${chapters.length}개`);
for (const c of chapters) {
  const verses = c.blocks.filter((b) => b.type === "verse").length;
  console.log(`  ${c.file} → ${c.slug} "${c.title}" 절블록 ${verses} 문장 ${c.sentences}${c.noAnchor ? ` (위치 없는 문장 ${c.noAnchor})` : ""}`);
}
if (DRY) process.exit(0);

// 이미 있는 글(slug)
const list = await api("GET", "/api/admin/content/articles?section=library");
const bySlug = new Map((list.items ?? list ?? []).map((a) => [a.slug, a]));

const editorLine = bookMeta.편자 ? `편자: ${bookMeta.편자}${bookMeta.편자_한자 ? `(${bookMeta.편자_한자})` : ""}` : null;
const bookInput = {
  section: "library",
  kind: KIND,
  slug: BOOK,
  title: bookMeta.scripture,
  title_hanja: bookMeta.scripture_hanja ?? null,
  summary: null,
  status: STATUS,
  sort_order: 0,
  meta: { source: "jsbooks", ...(bookMeta.편자 ? { editor: bookMeta.편자 } : {}), ...(bookMeta.편자_한자 ? { editor_hanja: bookMeta.편자_한자 } : {}) },
  blocks: editorLine ? [{ type: "text", text: editorLine }] : [],
};
const existingBook = bySlug.get(BOOK);
let bookId;
if (NO_BOOK) {
  if (!existingBook) throw new Error(`--no-book: 책 slug ${BOOK} 이 없습니다`);
  bookId = existingBook.id;
  console.log(`책은 그대로 둠: ${bookId}`);
} else {
  if (STATUS === "keep") bookInput.status = existingBook?.status ?? "draft";
  const book = existingBook
    ? await api("PUT", `/api/admin/content/articles/${existingBook.id}`, bookInput)
    : await api("POST", "/api/admin/content/articles", bookInput);
  bookId = (book.item ?? book).id;
  console.log(`책 ${existingBook ? "수정" : "생성"}: ${bookId}`);
}

const ids = [];
for (const [i, c] of chapters.entries()) {
  const input = {
    section: "library",
    kind: KIND,
    slug: c.slug,
    title: c.title,
    title_hanja: null,
    summary: null,
    status: STATUS,
    sort_order: i,
    parent_id: bookId,
    blocks: c.blocks,
    ...(c.meta ? { meta: c.meta } : {}),
  };
  const ex = bySlug.get(c.slug);
  if (STATUS === "keep") input.status = ex?.status ?? "draft";
  if (ex && ex.sort_order != null) input.sort_order = ex.sort_order;
  const r = ex
    ? await api("PUT", `/api/admin/content/articles/${ex.id}`, input)
    : await api("POST", "/api/admin/content/articles", input);
  const id = (r.item ?? r).id;
  ids.push(id);
  console.log(`  장 ${ex ? "수정" : "생성"}: ${c.slug} → ${id}`);
}
if (NO_BOOK) {
  console.log("장 순서는 그대로 둠(--no-book)");
} else {
  await api("PUT", `/api/admin/content/articles/${bookId}/chapters/order`, { ids });
  console.log("장 순서 저장 완료");
}
