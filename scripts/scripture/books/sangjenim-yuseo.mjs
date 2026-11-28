#!/usr/bin/env node
// 『상제님 유서(遺書)』 장 글 2개(옛 시루학당 445·469번 글) → jsbooks 형식 마크다운 + 대조 보고서 (2026-11-28)
//   node scripts/scripture/books/sangjenim-yuseo.mjs rows.json <출력폴더>
// 원문에 번호가 없다 → 구(句, 한글 한 줄 + 한문 한 줄)마다 사이트 임의 번호: 글1 ^1-N(한문 줄 ^1-N-2), 글2 ^2-N
// 등록자·종무원의 머리말·덧붙임 줄은 지우지 않고 ^note-N / ^notice-N 으로 두고 보고서에 올린다.
import path from "node:path";
import { writeFileSync } from "node:fs";
import { loadRows, paragraphs, Out, writeChapter, brokenGlyphs, summary, ws } from "./lib.mjs";

const BOOK_ID = "f352bf05-87d6-4825-9df9-71e3b5ccf91d";
const MARK = "jsbooks-md 2026-11-28";
const DROP_NOTES = process.argv.includes("--drop-notes"); // 글1 등록자 덧붙임 줄을 본문에서 뺀다
const [, , rowsPath, outDir] = process.argv.filter((a) => a !== "--drop-notes");
if (!rowsPath || !outDir) throw new Error("사용: node …/sangjenim-yuseo.mjs rows.json <출력폴더>");
const { chapters } = loadRows(rowsPath, BOOK_ID);
const HAN = /[一-鿿]/;
const HANGUL = /[가-힣]/;
const report = { chapters: [], notes: [], dropped: [], broken: [], images: [], diff: [] };
const couplets = {};

for (const [ci, row] of chapters.entries()) {
  const n = ci + 1;
  const out = new Out(row.title);
  const paras = paragraphs(row.body_md);
  let k = 0;
  let note = 0;
  let notice = 0;
  let img = 0;
  let inPoem = false;
  couplets[n] = [];
  for (const p of paras) {
    const ls = p.split("\n").map((l) => l.trim()).filter(Boolean);
    if (/^상제님 유서\(遺書\)$|^증산상제님 유서\(遺書\)$/.test(p)) {
      out.head(p);
      inPoem = true;
      continue;
    }
    if (p === "#별첨") {
      out.drop("#", "옛 글의 마크다운 머리 표시 '#' (글자가 아님)", report.dropped);
      out.head("별첨");
      continue;
    }
    if (/^\[gp:\d+\]/.test(p)) {
      for (const l of ls) {
        out.line(l, `img-${++img}`);
        report.images.push({ row: row.slug, token: l, anchor: `img-${img}` });
      }
      continue;
    }
    const isCouplet = inPoem && ls.length === 2 && HANGUL.test(ls[0]) && HAN.test(ls[1]) && !HANGUL.test(ls[1].replace(/[님]/g, ""));
    if (isCouplet) {
      k++;
      out.line(ls[0], `${n}-${k}`);
      out.line(ls[1], `${n}-${k}-2`);
      couplets[n].push(ls);
      continue;
    }
    // 시 본문이 아닌 글: 글1 = 등록자 덧붙임(note), 글2 = 종무원 공표문(notice)
    if (n === 2 && !inPoem && notice === 0) {
      out.head(p); // 공표문 제목 줄
      notice++;
      continue;
    }
    for (const l of ls) {
      if (n === 1) {
        if (DROP_NOTES) {
          out.drop(l, "등록자 글 — 오너 결정(2026-11-28)으로 뺌, 원본 백업에는 그대로", report.dropped);
          report.dropped.at(-1).where = row.slug;
        } else out.line(l, `note-${++note}`);
        report.notes.push({ row: row.slug, anchor: DROP_NOTES ? null : `note-${note}`, text: l, removed: DROP_NOTES });
      } else {
        out.line(l, `notice-${notice++}`);
        report.notes.push({ row: row.slug, anchor: `notice-${notice - 1}`, text: l.slice(0, 80) });
      }
    }
    if (n === 1 && /원본에 없을 가능성/.test(p)) inPoem = true;
  }
  const meta = JSON.parse(row.meta || "{}");
  const front = {
    scripture: "상제님 유서",
    scripture_hanja: "上帝님 遺書",
    slug: row.slug,
    제목: row.title,
    meta: {
      ...meta,
      structure: MARK,
      verse_numbering: "site(구 단위 — 한글 한 줄 ^글-N, 한문 한 줄 ^글-N-2. 원문 번호 없음, 사이트 임의 구분)",
      notes: n === 1 ? (DROP_NOTES ? "등록자 덧붙임 3줄 뺌(원본 백업에 있음)" : "note-N: 등록자 덧붙임(사설 후보)") : "notice-N: 종무원 오자 수정 공표문, img-N: 옛 글 사진 자리",
    },
  };
  const file = `${String(n).padStart(2, "0")}_${row.slug}.md`;
  writeChapter(outDir, file, front, out);
  report.broken.push(...brokenGlyphs(row.body_md, row.slug));
  report.chapters.push({ file, slug: row.slug, id: row.id, title: row.title, legacy: meta.legacy_source, couplets: k, verses: k, lines: out.lineCount, blocks: out.blocks, ...out.check(row.body_md) });
}

// 두 판의 구 단위 차이(글자 그대로 비교, 공백 무시)
const [a, b] = [couplets[1], couplets[2]];
for (let i = 0; i < Math.max(a.length, b.length); i++) {
  const x = a[i]?.join(" / ") ?? "(없음)";
  const y = b[i]?.join(" / ") ?? "(없음)";
  if (ws(x) !== ws(y)) report.diff.push({ n: i + 1, 원문: x, 감수본: y });
}
writeFileSync(path.join(outDir, "..", "상제님-유서.report.json"), JSON.stringify(report, null, 1));
summary(report.chapters);
console.log(`두 판이 다른 구 ${report.diff.length}곳, 깨진 글자 ${report.broken.length}, 사진 자리 ${report.images.length}`);
