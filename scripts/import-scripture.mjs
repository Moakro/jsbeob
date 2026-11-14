#!/usr/bin/env node
// jsbooks 형식 경전 마크다운 → 자료실 DB 책(책 글 1 + 장 글 N, 장 본문은 '절' 블록) (2026-11-14)
//
// 쓰는 법 (로컬 API 기준, 관리자 쿠키 필요 — pnpm dev:login 이 찍어 주는 jb_session 값):
//   JB_SESSION=… node scripts/import-scripture.mjs <폴더> --book <책slug> [--kind book] [--api http://127.0.0.1:8788]
//                [--status published] [--dry]
//
// 입력 폴더: 00_서문.md, 01_제1장.md … 99_부록.md (파일 이름 순서 = 장 순서)
//   프론트매터: scripture, scripture_hanja, 편자, 편자_한자, 장, 장_이름, section(preface|appendix)
//   본문: "# 제목"(무시) / "## N절" → 절 블록 / 빈 줄로 나뉜 문단 = 문장 한 줄, 끝의 "^1-1-3" = 문장 위치
//   서문·부록처럼 절 머리가 없으면 문단마다 preface-N / appendix-N 위치를 붙인 절 블록(이름 없음)
//   [[대상|별칭]] 위키링크는 그대로 둔다(화면에는 별칭 글자, 나중 관련링크 작업의 출발점)
//
// 같은 slug 가 이미 있으면 PUT(수정)으로 덮어쓴다 — 수정 이력은 API 가 남긴다.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const dir = args[0];
const BOOK = opt("book");
const KIND = opt("kind", "book");
const API = opt("api", "http://127.0.0.1:8788");
const STATUS = opt("status", "published");
const DRY = args.includes("--dry");
const COOKIE = process.env.JB_SESSION ? `jb_session=${process.env.JB_SESSION}` : "";
if (!dir || !BOOK) {
  console.error("사용: JB_SESSION=… node scripts/import-scripture.mjs <폴더> --book <책slug> [--kind book] [--dry]");
  process.exit(1);
}
if (!DRY && !COOKIE) {
  console.error("JB_SESSION(관리자 쿠키 값)이 필요합니다. pnpm dev:login 출력의 jb_session= 뒤 값을 넣으세요.");
  process.exit(1);
}

function parseFront(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  const data = {};
  if (m) {
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^([^:]+):\s*(.*)$/);
      if (!kv) continue;
      const v = kv[2].trim();
      data[kv[1].trim()] = /^\d+$/.test(v) ? Number(v) : v;
    }
  }
  return { data, body: m ? src.slice(m[0].length) : src };
}

/** 본문 → 블록. 절 머리가 없으면 문단마다 `${fallback}-N` 위치 */
function toBlocks(body, fallback) {
  const lines = body.replace(/\r\n/g, "\n").replace(/^#\s.*$/m, "").split("\n");
  const blocks = [];
  let cur = null;
  let buf = [];
  let seq = 0;
  let noAnchor = 0;
  const flush = () => {
    const joined = buf.join(" ").trim();
    buf = [];
    if (!joined) return;
    const m = joined.match(/\s*\^([\w-]+)\s*$/);
    let a = m ? m[1] : "";
    const t = m ? joined.slice(0, m.index).trim() : joined;
    if (!a && fallback) a = `${fallback}-${++seq}`;
    if (!a) noAnchor++;
    if (!cur) {
      cur = { type: "verse", lines: [] };
      blocks.push(cur);
    }
    cur.lines.push({ a, t });
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const head = line.match(/^(#{2,6})\s+(.+?)\s*$/);
    if (head) {
      flush();
      const label = head[2].replace(/\s*\^[\w-]+\s*$/, "").trim();
      if (head[1] === "##" && !fallback) {
        cur = { type: "verse", label, lines: [] };
        blocks.push(cur);
      } else {
        blocks.push({ type: "heading", text: label });
        cur = null;
      }
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    buf.push(line.trim());
  }
  flush();
  // 절 블록 id 는 첫 문장 위치로 고정(관련링크·이미지 참조가 블록 id 를 가리킬 때 안정적)
  const used = new Set();
  for (const b of blocks) {
    if (b.type !== "verse" || !b.lines[0]?.a) continue;
    let id = `v-${b.lines[0].a}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 22);
    if (id.length < 6) id = id.padEnd(6, "0");
    if (!used.has(id)) {
      b.id = id;
      used.add(id);
    }
  }
  return { blocks: blocks.filter((b) => b.type !== "verse" || b.lines.length), noAnchor };
}

async function api(method, p, body) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: COOKIE, Origin: "http://localhost:4321" },
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
  chapters.push({ key, title, slug: `${BOOK}-${key}`, blocks, sentences, noAnchor, file: f });
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
const book = existingBook
  ? await api("PUT", `/api/admin/content/articles/${existingBook.id}`, bookInput)
  : await api("POST", "/api/admin/content/articles", bookInput);
const bookId = (book.item ?? book).id;
console.log(`책 ${existingBook ? "수정" : "생성"}: ${bookId}`);

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
  };
  const ex = bySlug.get(c.slug);
  const r = ex
    ? await api("PUT", `/api/admin/content/articles/${ex.id}`, input)
    : await api("POST", "/api/admin/content/articles", input);
  const id = (r.item ?? r).id;
  ids.push(id);
  console.log(`  장 ${ex ? "수정" : "생성"}: ${c.slug} → ${id}`);
}
await api("PUT", `/api/admin/content/articles/${bookId}/chapters/order`, { ids });
console.log("장 순서 저장 완료");
