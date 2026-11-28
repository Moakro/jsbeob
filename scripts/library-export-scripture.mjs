#!/usr/bin/env node
// jsbeob 자료실 책(articles) → 공용 자료실(GenMedia assets-shared/library) 경전 내보내기 (2026-11-28)
//
// 자료실 설계: GenMedia memory/자료실-설계.md 8절. 책 하나 = 자료 하나:
//   text/증산-경전/<id>_<책>/전문.txt   한 파일 전문(검색용, 줄 앞에 [위치])
//   text/증산-경전/<id>_<책>/장/NN.md   장 글마다 jsbooks 형식 마크다운(import-scripture.mjs 가 그대로 읽음)
//   text/증산-경전/<id>_<책>.meta.json  사이드카(kind scripture, text.format jsbooks-md …)
// id·파일 이름·해시·사이드카 뼈대는 GenMedia `tools/library.py add` 가 만들고, 이 스크립트는 `text` 메타를 덧붙인 뒤
// `library.py index` 로 색인을 다시 쓴다. GenMedia 쪽 git 커밋은 하지 않는다(Zoy 담당).
//
// DB 는 **읽기만** 한다(SELECT 한 문장). 운영 D1 을 읽으려면 --remote (저장소 최상위 .env 의 CLOUDFLARE_* 를 씀).
//
// 쓰는 법:
//   node scripts/library-export-scripture.mjs --out <폴더> [--remote] [--book <slug> …]   # 마크다운·전문만 만들고 되읽기 검사
//   node scripts/library-export-scripture.mjs --out <폴더> --remote --library ~/GenMedia   # + 자료실에 넣고 색인
//   기본 책: 아래 BOOKS 6종. --book 으로 골라 낼 수 있다(여러 번).
//   같은 책(text.jsbeob_book)이 자료실에 이미 있으면 넣지 않고 건너뛴다.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toBlocks } from "./scripture/jsbooks-md.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TODAY = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

// 책별 사이드카 정보 — 판·인용 규칙은 Zec 구조화 보고서(2026-11-28) 기준
const BOOKS = {
  "대순전경": {
    name: "대순전경",
    editor: "이상호", editor_hanja: "李祥昊",
    edition: "3판(1947, 국한문 9장 체제)",
    title_extra: "3판(1947)",
    cite_rule: "장·절까지 — 장-절은 원문 번호(3판). 서(序) 문단·절 안 이어진 줄(^장-절-N)·삼간사는 사이트 임의 구분",
    description: "jsbeob 서재 대순전경(서 + 9장). 옛 사이트 글 길이 제한으로 2장 등 몇 장은 끝 절이 잘려 있음(남은 절 수 미상).",
    tags: ["대순전경", "경전", "증산"],
  },
  "대순전경-초판": {
    name: "대순전경-초판",
    editor: "이상호", editor_hanja: "李祥昊",
    edition: "초판(1929)",
    title_extra: "(1929)",
    cite_rule: "장·절까지 — 절은 원문 번호, 장 번호는 글 제목. 1~6판 안내·서·보주·찬과 절 안 줄(^장-절-N)은 사이트 임의 구분",
    description: "jsbeob 서재 대순전경 초판 — 번역(현대어, 도강님 자료) + 原文(초판 국한문). 첫 글 '1~6판 안내'는 등록자 해설(초판 본문 아님).",
    tags: ["대순전경", "초판", "경전", "증산"],
  },
  "고부인-신정기": {
    name: "고부인-신정기",
    hanja: "高夫人神政記",   // DB 책 title_hanja 가 비어 있음 — Zec 초안 프론트매터 값
    editor: "이정립", editor_hanja: "李正立",
    edition: "재판본(천후신정기, 절 번호 붙인 판)",
    title_extra: "재판본",
    cite_rule: "장·절까지 — 절은 원문 번호(장마다 1부터). 머릿말·재판 편집후기와 절 안 줄(^장-절-N)은 사이트 임의 구분",
    description: "jsbeob 서재 고부인 신정기(머릿말 + 5장 + 재판후기). 옛 글 4개 경계가 장과 맞지 않아 글 안에 장 머리가 있음. 등록자 줄 뺀 구조화본 — L2611-n3jj(작성 중 원문 txt)의 정리판.",
    tags: ["고부인 신정기", "경전", "증산"],
  },
  "상제님-유서": {
    name: "상제님-유서",
    hanja: "上帝님 遺書",   // DB 책 title_hanja 가 비어 있음 — Zec 초안 프론트매터 값
    editor: null, editor_hanja: null,
    edition: "원문(2016 등록) + 용화진경 감수본(2018 종무원 공표)",
    cite_rule: "글(원문/감수본)까지만 — 원문에 번호 없음, 구 번호(^글-N)는 사이트 임의 구분",
    description: "jsbeob 서재 상제님 유서 — 글1 원문, 글2 용화진경 감수본(오자 수정 공표문 포함). 글2 끝 [gp:…]는 옛 글 사진 자리.",
    tags: ["상제님 유서", "경전", "증산"],
  },
  "용화전경": {
    name: "용화전경",
    hanja: "龍華典經",   // DB 책 title_hanja 가 비어 있음 — Zec 초안 프론트매터 값
    editor: "김낙원", editor_hanja: null,
    edition: "jsbeob 서재본(서 + 7장)",
    cite_rule: "장·번호까지 — 번호는 원문(장마다 이어짐). 서·7장 부기와 ^장-번호-k·^장-s절-K 줄은 사이트 임의 구분",
    description: "jsbeob 서재 용화전경(서 + 7장, 장 > 절(소제목) > 번호). 2장 수종제자 표는 옛 HTML로 복원. 깨진 글자·복자 일부 있음.",
    tags: ["용화전경", "경전", "증산"],
  },
  "증산천사공사기": {
    name: "증산천사공사기",
    editor: "이상호", editor_hanja: "李祥昊",
    edition: "jsbeob 서재본(9조각 연대기)",
    cite_rule: "책 이름까지만 — 원문에 장·절 없음, 책 전체 줄 번호(^N)는 사이트 임의 구분",
    description: "jsbeob 서재 증산천사공사기 — 장·절 없는 연대기를 옛 글 9개로 나눈 그대로. 한글 독음 줄(^N-2)은 등록자가 단 것으로 보이며 오류가 있음.",
    tags: ["증산천사공사기", "경전", "증산"],
  },
};

// ---------------------------------------------------------------- 인자
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const multi = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const OUT = opt("out");
const REMOTE = args.includes("--remote");
const LIBRARY = opt("library");
const PICK = multi("book");
if (!OUT) {
  console.error("사용: node scripts/library-export-scripture.mjs --out <폴더> [--remote] [--book <slug>] [--library ~/GenMedia]");
  process.exit(1);
}
const slugs = PICK.length ? PICK : Object.keys(BOOKS);
for (const s of slugs) if (!BOOKS[s]) throw new Error(`모르는 책 slug: ${s} (BOOKS 에 정보를 먼저 적을 것)`);

// ---------------------------------------------------------------- DB 읽기 (SELECT 만)
function readEnv() {
  const env = { ...process.env };
  const f = path.join(ROOT, ".env");
  if (REMOTE && existsSync(f)) {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^(CLOUDFLARE_[A-Z_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

function select(sql) {
  if (!/^\s*SELECT\b/i.test(sql) || /;\s*\S/.test(sql)) throw new Error("SELECT 한 문장만 실행한다");
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "jsbeob-db", "-c", "wrangler.toml", REMOTE ? "--remote" : "--local", "--json", "--command", sql],
    { cwd: path.join(ROOT, "jsbeob-api"), env: readEnv(), encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  );
  const json = out.slice(out.indexOf("["));   // wrangler 가 앞에 안내 줄을 찍을 때가 있음
  return JSON.parse(json)[0].results;
}

const q = (s) => `'${s.replace(/'/g, "''")}'`;
const books = select(
  `SELECT id, slug, title, title_hanja, status FROM articles WHERE section='library' AND kind='book' AND parent_id IS NULL AND slug IN (${slugs.map(q).join(",")})`,
);
const chapterRows = select(
  `SELECT c.parent_id, c.slug, c.title, c.sort_order, c.status, c.meta, c.body_blocks FROM articles c
   JOIN articles p ON p.id = c.parent_id
   WHERE p.section='library' AND p.slug IN (${slugs.map(q).join(",")}) AND c.status='published'
   ORDER BY c.sort_order, c.slug`,
);

// ---------------------------------------------------------------- 블록 → jsbooks 마크다운
function front(obj) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === "") continue;
    lines.push(`${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v).replace(/\n/g, " ")}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function blocksToMd(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type === "heading") out.push(`### ${b.text}`);
    else if (b.type === "verse") {
      if (b.label) out.push(`## ${b.label}`);
      for (const l of b.lines) out.push(l.a ? `${l.t} ^${l.a}` : l.t);
    } else throw new Error(`모르는 블록 종류: ${b.type}`);
  }
  return out.join("\n\n");
}

const norm = (blocks) =>
  blocks.map((b) =>
    b.type === "heading"
      ? { type: "heading", text: b.text }
      : { type: "verse", label: b.label ?? "", lines: b.lines.map((l) => ({ a: l.a ?? "", t: l.t.replace(/\s+/g, " ").trim() })) },
  );

function blocksToText(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type === "heading") out.push("", `【${b.text}】`);
    else {
      if (b.label) out.push("", b.label);
      for (const l of b.lines) out.push(l.a ? `[${l.a}] ${l.t}` : l.t);
    }
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- 책마다 쓰기
mkdirSync(OUT, { recursive: true });
const results = [];
let bad = 0;
for (const slug of slugs) {
  const info = BOOKS[slug];
  const book = books.find((b) => b.slug === slug);
  if (!book) {
    console.error(`✗ ${slug}: DB 에 책이 없음`);
    bad++;
    continue;
  }
  if (book.status !== "published") console.warn(`  ⚠ ${slug}: 책 상태 ${book.status}`);
  book.title_hanja ||= info.hanja ?? null;
  const chs = chapterRows.filter((c) => c.parent_id === book.id);
  const dir = path.join(OUT, info.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, "장"), { recursive: true });

  const textParts = [
    `${book.title}${book.title_hanja ? ` (${book.title_hanja})` : ""} — 전문`,
    `출처: jsbeob.com 자료실 책 '${book.title}'(https://jsbeob.com/archive/book/${slug}/), 운영 D1 articles 내보내기 ${TODAY}.`,
    info.editor ? `편자: ${info.editor}${info.editor_hanja ? `(${info.editor_hanja})` : ""} · 판: ${info.edition}` : `판: ${info.edition}`,
    `인용: ${info.cite_rule}`,
    `줄 앞 [위치] = jsbeob 문장 위치(^…). 장 파일(장/NN.md)은 jsbooks 형식.`,
  ];
  let lines = 0;
  for (const [i, c] of chs.entries()) {
    const blocks = JSON.parse(c.body_blocks || "[]");
    const meta = c.meta ? JSON.parse(c.meta) : null;
    const md = `${front({
      scripture: book.title,
      scripture_hanja: book.title_hanja,
      편자: info.editor,
      편자_한자: info.editor_hanja,
      장: i + 1,
      slug: c.slug,
      제목: c.title,
      meta,
    })}\n\n# ${c.title}\n\n${blocksToMd(blocks)}\n`;
    const file = `${String(i + 1).padStart(2, "0")}.md`;
    writeFileSync(path.join(dir, "장", file), md);
    // 되읽기 검사: import-scripture.mjs 와 같은 파서로 읽어 DB 블록과 같은지
    const back = toBlocks(md.replace(/^---\n[\s\S]*?\n---\n?/, ""), null).blocks;
    const a = JSON.stringify(norm(blocks));
    const b = JSON.stringify(norm(back));
    if (a !== b) {
      console.error(`✗ ${c.slug}: 되읽기 결과가 DB 블록과 다름`);
      bad++;
    }
    lines += blocks.reduce((n, x) => n + (x.lines?.length ?? 0), 0);
    textParts.push("", "", `==== ${c.title} (${c.slug}, 장/${file}) ====`, blocksToText(blocks));
  }
  writeFileSync(path.join(dir, "전문.txt"), textParts.join("\n").replace(/\n{3,}/g, "\n\n") + "\n");
  console.log(`✓ ${slug}: 장 ${chs.length} · 문장 ${lines} → ${dir}`);
  results.push({ slug, info, book, chapters: chs.length, lines, dir });
}
if (bad) {
  console.error(`문제 ${bad}건 — 자료실에 넣지 않음`);
  process.exit(1);
}

// ---------------------------------------------------------------- 자료실에 넣기 (선택)
if (!LIBRARY) process.exit(0);
const GM = path.resolve(LIBRARY.replace(/^~/, process.env.HOME));
const PY = path.join(GM, ".venv/bin/python");
const TOOL = path.join(GM, "tools/library.py");
const LIBDIR = path.join(GM, "assets-shared/library");
const TOPIC = "증산-경전";
const topicDir = path.join(LIBDIR, "text", TOPIC);

function existingFor(slug) {
  if (!existsSync(topicDir)) return null;
  for (const f of readdirSync(topicDir)) {
    if (!f.endsWith(".meta.json")) continue;
    const m = JSON.parse(readFileSync(path.join(topicDir, f), "utf8"));
    if (m.text?.jsbeob_book === slug) return m.id;
  }
  return null;
}

for (const r of results) {
  const have = existingFor(r.slug);
  if (have) {
    console.log(`= ${r.slug}: 자료실에 이미 있음(${have}) — 건너뜀`);
    continue;
  }
  const { info, book } = r;
  const credit = `${book.title} · 증산법종교 jsbeob.com 자료실`;
  const out = execFileSync(
    PY,
    [
      TOOL, "add", r.dir,
      "--kind", "scripture", "--topic", TOPIC, "--name", info.name,
      "--title", `${book.title}${info.title_extra ? ` ${info.title_extra}` : ""} (jsbeob 자료실, 장·절 구조화)`,
      "--description", info.description,
      "--license", "OWNER-OK", "--checked", TODAY,
      "--url", `https://jsbeob.com/archive/book/${r.slug}/`,
      "--holder", "증산법종교 jsbeob.com",
      ...(info.editor ? ["--creator", `${info.editor}${info.editor_hanja ? `(${info.editor_hanja})` : ""} 편`] : []),
      "--ref", `jsbeob articles book slug=${r.slug}`,
      "--credit", credit,
      "--note", "jsbeob 사이트 공개 도서 — 출처 표기 문구 그대로 붙여 사용. 인용 위치는 text.cite_rule",
      "--seed", path.join(r.dir, "전문.txt"),
      "--by", "Zec 워커(jsbeob 경전 내보내기)",
      ...info.tags.flatMap((t) => ["--tag", t]),
    ],
    { cwd: GM, encoding: "utf8" },
  );
  process.stdout.write(out);
  const m = out.match(/사이드카 (\S+\.meta\.json)/);
  if (!m) throw new Error(`${r.slug}: 사이드카 경로를 못 찾음`);
  const side = path.join(GM, m[1]);
  const meta = JSON.parse(readFileSync(side, "utf8"));
  meta.license.basis = `오너 확인 ${TODAY} — jsbeob 사이트 공개 도서, 영상·웹 모두 출처 표기 후 사용(설계 8절)`;
  meta.files = meta.files.map((f) => ({ ...f, role: "original" }));
  meta.text = {
    name: book.title,
    edition: info.edition,
    author: info.editor ? `${info.editor} 편` : null,
    translator: null,
    chapters: r.chapters,
    format: "jsbooks-md",
    cite_rule: info.cite_rule,
    origin: `jsbeob articles 내보내기 ${TODAY}`,
    publication: "published",
    jsbeob_book: r.slug,
  };
  writeFileSync(side, JSON.stringify(meta, null, 2) + "\n");
}
process.stdout.write(execFileSync(PY, [TOOL, "index"], { cwd: GM, encoding: "utf8" }));
