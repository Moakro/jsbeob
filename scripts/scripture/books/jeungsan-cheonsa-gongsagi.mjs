#!/usr/bin/env node
// 『증산천사공사기(甑山天師公事記)』 장 글 9개(옛 시루학당 164·167~174번 글) → jsbooks 형식 마크다운 + 대조 보고서 (2026-11-28)
//   node scripts/scripture/books/jeungsan-cheonsa-gongsagi.mjs rows.json <출력폴더>
//
// 원문 체계: 표제·서(序, 한문) + 본문(장·절 번호 없이 이어지는 기록) + 끝의 '천사(天師)의 이표(異表)'.
// 옛 글 9개는 한 책을 길이 제한 때문에 나눠 올린 것(-1 ~ -9)이고 조각 경계에서 문장이 끊기거나 겹친 곳은 없다
// → 행은 그대로 두고, 책 전체에 이어지는 사이트 임의 문단 번호를 단다.
//   ^N          본문 줄(문단) — 책 전체 1부터 이어짐(사이트 임의 구분, 원문 번호 없음)
//   ^N-2        바로 앞 줄의 한문·한글 짝(독음 또는 원문) 줄
//   ^preface-N  서(序) 줄(짝 줄은 ^preface-N-2),  ^cover-1 표제 앞 기년 줄
import path from "node:path";
import { writeFileSync } from "node:fs";
import { loadRows, lines as splitLines, Out, writeChapter, brokenGlyphs, summary, ws } from "./lib.mjs";

const BOOK_ID = "5b43b13d-d0ff-46e5-8ef0-8954cb9b7e6e";
const MARK = "jsbooks-md 2026-11-28";
const [, , rowsPath, outDir] = process.argv;
if (!rowsPath || !outDir) throw new Error("사용: node …/jeungsan-cheonsa-gongsagi.mjs rows.json <출력폴더>");
const { chapters } = loadRows(rowsPath, BOOK_ID);
const TITLE = "증산천사공사기 (甑山天師公事記)";
const HEADS = new Set([TITLE, "서(序)", "천사(天師)의 이표(異表)"]);
const report = { chapters: [], pairs: [], boundaries: [], broken: [], heads: [], brackets: [] };

const share = (s, re) => {
  const t = ws(s).replace(/[()\[\]（）,.·:;'"]/g, "");
  return t.length ? (t.match(re) ?? []).length / t.length : 0;
};
const isHan = (s) => share(s, /[㐀-鿿豈-﫿]/g) >= 0.6;
const isHangul = (s) => share(s, /[가-힣]/g) >= 0.6;
const near = (a, b) => {
  const x = ws(a).length;
  const y = ws(b).length;
  return Math.abs(x - y) <= Math.max(3, 0.25 * Math.max(x, y));
};
/** 한문 한 줄 + 한글 독음 한 줄(어느 쪽이 먼저든)이 짝인지 */
const pair = (a, b) => b != null && ((isHan(a) && isHangul(b)) || (isHangul(a) && isHan(b))) && near(a, b);

let N = 0;
let P = 0;
let preface = false;
for (const [ci, row] of chapters.entries()) {
  const out = new Out(row.title);
  const meta = JSON.parse(row.meta || "{}");
  const ls = splitLines(row.body_md);
  const from = N + 1;
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (ci === 0 && i === 0 && /^후천기원/.test(l)) {
      out.line(l, "cover-1");
      continue;
    }
    if (HEADS.has(l)) {
      out.head(l);
      report.heads.push({ row: row.slug, text: l });
      preface = l === "서(序)";
      continue;
    }
    if (/^\[.*\]\.?$/.test(l) || /^\(編者註|^\(편자주/.test(l)) report.brackets.push({ row: row.slug, text: l });
    const two = pair(l, ls[i + 1]) && !HEADS.has(ls[i + 1]);
    const a = preface ? `preface-${++P}` : `${++N}`;
    out.line(l, a);
    if (two) {
      out.line(ls[i + 1], `${a}-2`);
      report.pairs.push({ row: row.slug, anchor: a, first: isHan(l) ? "한문" : "한글", a: l.slice(0, 30), b: ls[i + 1].slice(0, 30) });
      i++;
    }
  }
  const front = {
    scripture: "증산천사공사기",
    scripture_hanja: "甑山天師公事記",
    편자: "이상호",
    편자_한자: "李祥昊",
    slug: row.slug,
    제목: row.title,
    meta: {
      ...meta,
      structure: MARK,
      verse_numbering: "site(원문에 장·절 번호 없음 — 책 전체에 이어지는 줄 번호 ^N, 사이트 임의 구분)",
      sub_lines: "site(^N-2 한문·한글 독음 짝 줄, ^preface-N 서, ^cover-1 기년 줄)",
      range: N >= from ? `^${from}~^${N}` : null,
    },
  };
  const file = `${String(ci + 1).padStart(2, "0")}_${row.slug}.md`;
  writeChapter(outDir, file, front, out);
  report.broken.push(...brokenGlyphs(row.body_md, row.slug));
  report.boundaries.push({ row: row.slug, first: ls[0].slice(0, 50), last: ls.at(-1).slice(-50) });
  report.chapters.push({ file, slug: row.slug, id: row.id, title: row.title, legacy: meta.legacy_source, range: front.meta.range, verses: 0, lines: out.lineCount, blocks: out.blocks, ...out.check(row.body_md) });
}
writeFileSync(path.join(outDir, "..", "증산천사공사기.report.json"), JSON.stringify(report, null, 1));
summary(report.chapters);
console.log(`본문 줄 ${N}, 서 ${P}, 한문·한글 짝 ${report.pairs.length}, 깨진 글자 ${report.broken.length}`);
