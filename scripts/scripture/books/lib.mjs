// 책별 구조화 스크립트 공용 도구 (2026-11-28, 미발행 경전 4종)
//
// 대순전경(scripts/scripture/daesoon-structure.mjs)과 같은 원칙을 책마다 다시 쓰지 않으려고 모은 것:
//   - 경전 문장은 고치지 않는다. 바꾸는 것은 구조(머리·위치 표시·줄 나눔)뿐
//   - 뺀 글자(번호 머리, 잡음, 겹친 조각)는 모두 기록하고, 마지막에 원본과 출력을 글자·순서 단위로 대조한다
//
// 출력 한 장(= articles 한 행)은 Out 에 차례로 쌓는다.
//   out.head(text, cmp, level) → "### text" (소제목 블록, level 4 면 "####" — 화면은 같은 소제목)
//   out.verse(label, text, a) → "## label" + "text ^a" (절 머리 + 첫 줄)
//   out.line(text, a)         → "text ^a" (앞 절에 이어지는 줄, 또는 머리 없는 절)
//   out.drop(text, why)       → 원본에서 뺀 글(대조 때 그 자리에 있어야 함)
// 각 함수의 cmp 인자: 원본 대조용 글(기본은 text). 표 칸 사이에 " | " 처럼 사이트가 넣은 구분자를 대조에서 뺄 때 쓴다.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export const ws = (s) => s.replace(/[\s﻿]+/g, "");

export function loadRows(rowsPath, bookId) {
  let raw = readFileSync(rowsPath, "utf8");
  raw = raw.slice(Math.min(...["[", "{"].map((c) => raw.indexOf(c)).filter((i) => i >= 0)));
  let rows = JSON.parse(raw);
  if (Array.isArray(rows) && rows[0]?.results) rows = rows[0].results;
  const book = rows.find((r) => r.id === bookId);
  if (!book) throw new Error(`책 행 ${bookId} 이 없습니다`);
  const chapters = rows.filter((r) => r.parent_id === bookId).sort((a, b) => a.sort_order - b.sort_order);
  return { book, chapters };
}

/** 빈 줄로 나뉜 문단 */
export const paragraphs = (md) =>
  md.replace(/\r\n/g, "\n").replace(/^﻿/, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
/** 줄 (빈 줄 제외) */
export const lines = (md) =>
  md.replace(/\r\n/g, "\n").replace(/^﻿/, "").split("\n").map((l) => l.trim()).filter(Boolean);

const ANCHOR = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

export class Out {
  constructor(title) {
    this.title = title;
    this.md = [`# ${title}`, ""];
    this.stream = []; // { kind: "out" | "drop", text }
    this.anchors = new Set();
    this.verses = 0;
    this.lineCount = 0;
    this.heads = 0;
    this.blocks = 0; // import 뒤 블록 수 추정(최대 200)
    this.open = false; // 지금 절 블록이 열려 있는지
    this.maxLines = 0;
    this.curLines = 0;
  }
  #anchor(a) {
    if (!ANCHOR.test(a)) throw new Error(`위치 표시 형식 오류: ^${a}`);
    if (this.anchors.has(a)) throw new Error(`위치 표시가 두 번: ^${a}`);
    this.anchors.add(a);
  }
  #oneLine(t) {
    if (/\n/.test(t)) throw new Error(`한 줄이어야 함: ${t.slice(0, 40)}`);
    if (/^#{1,6}\s/.test(t)) throw new Error(`줄이 # 로 시작: ${t.slice(0, 40)}`);
    return t;
  }
  head(text, cmp = text, level = 3) {
    this.md.push(`${"#".repeat(level)} ${this.#oneLine(text)}`, "");
    this.stream.push({ kind: "out", text: cmp });
    this.heads++;
    this.blocks++;
    this.open = false;
  }
  verse(label, text, a, cmp = text) {
    this.#anchor(a);
    this.md.push(`## ${label}`, "", `${this.#oneLine(text)} ^${a}`, "");
    this.stream.push({ kind: "out", text: cmp });
    this.verses++;
    this.lineCount++;
    this.blocks++;
    this.open = true;
    this.curLines = 1;
    this.maxLines = Math.max(this.maxLines, 1);
  }
  line(text, a, cmp = text) {
    this.#anchor(a);
    this.md.push(`${this.#oneLine(text)} ^${a}`, "");
    this.stream.push({ kind: "out", text: cmp });
    this.lineCount++;
    if (!this.open) {
      this.blocks++;
      this.open = true;
      this.curLines = 0;
    }
    this.curLines++;
    this.maxLines = Math.max(this.maxLines, this.curLines);
  }
  drop(text, why, log) {
    this.stream.push({ kind: "drop", text });
    log?.push({ text, why });
  }
  /** 원본(공백 제외) == 출력·뺀 글을 차례로 이은 것(공백 제외) — 순서까지 같아야 한다 */
  check(source) {
    const src = ws(source);
    const got = ws(this.stream.map((s) => s.text).join(""));
    const outOnly = ws(this.stream.filter((s) => s.kind === "out").map((s) => s.text).join(""));
    const dropped = ws(this.stream.filter((s) => s.kind === "drop").map((s) => s.text).join(""));
    let k = 0;
    while (k < src.length && src[k] === got[k]) k++;
    const same = src === got;
    if (!same) console.error(`  ✗ 불일치 위치 ${k}: 원본 "${src.slice(Math.max(0, k - 20), k + 20)}" / 출력 "${got.slice(Math.max(0, k - 20), k + 20)}"`);
    if (this.blocks > 200) throw new Error(`블록 ${this.blocks}개 — 글 하나 최대 200`);
    if (this.maxLines > 400) throw new Error(`절 블록 하나에 줄 ${this.maxLines} — 최대 400`);
    return { same, srcNoWs: src.length, outNoWs: outOnly.length, droppedNoWs: dropped.length };
  }
  render(front) {
    const fm = Object.entries(front).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
    return `---\n${fm.join("\n")}\n---\n\n${this.md.join("\n").trimEnd()}\n`;
  }
}

export function writeChapter(outDir, file, front, out) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, file), out.render(front));
}

/** 깨진 글자 — '?'(옛 문자 코드에 없던 한자 자리로 보임)와 이상한 기호(㈛ 등)의 앞뒤 글.
 *  물음표 문장 끝("…이냐?' ", "…까? ")은 빼고, 한자·괄호 한자 안·글자 바로 앞의 '?' 만 잡는다 */
export function brokenGlyphs(text, where) {
  text = text.replace(/https?:\/\/\S+/g, "");
  const out = [];
  const HAN = /[\u3400-\u9FFF\uF900-\uFAFF]/;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    let bad = false;
    if (c === "?") {
      const prev = text[i - 1] ?? "";
      const next = text[i + 1] ?? "";
      bad = HAN.test(prev) || HAN.test(next) || /[가-힣A-Za-z0-9?]/.test(next) || (prev === "(" && next === ")");
      if (!bad && prev === "?") bad = true;
    } else if (/[\u3200-\u32FF\uFFFD]/.test(c)) bad = true;
    if (bad) out.push({ where, ctx: text.slice(Math.max(0, i - 12), i + 9).replace(/\n/g, " ") });
  }
  return out;
}

export function summary(chapters) {
  for (const c of chapters)
    console.log(
      `${c.file} ${c.title} 절 ${c.verses} 줄 ${c.lines} 블록 ${c.blocks} 원본 ${c.srcNoWs} = 출력 ${c.outNoWs} + 뺀 ${c.droppedNoWs} ${c.same ? "✓" : "✗ 글자 불일치"}`,
    );
  if (chapters.some((c) => !c.same)) process.exit(2);
}
