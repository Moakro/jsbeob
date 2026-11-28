#!/usr/bin/env node
// 『고부인 신정기(高夫人神政記)』 장 글 4개(옛 시루학당 331·335·336·337번 글) → jsbooks 형식 마크다운 + 대조 보고서 (2026-11-28)
//   node scripts/scripture/books/gobuin-sinjeonggi.mjs rows.json <출력폴더>
//
// 원문 체계: 머릿말 + 제일장~제오장(장마다 "1." 부터 절 번호 새로) + 재판 편집후기.
// 옛 글 4개는 장 경계와 맞지 않는다(글1 = 머릿말·1장·2장·3장 1~27절, 글2 = 3장 28~60절, 글3 = 3장 61~90절, 글4 = 4장·5장·후기).
// → 장 글(행)은 그대로 두고, 글 안에 장 머리(### 제N장 …)와 원문 절 번호(## N절, ^장-절)를 단다.
//   글1 끝의 3장 28절은 옛 사이트 길이 제한으로 문장 중간에서 잘린 조각이고 글2 첫머리에 온전한 28절이 있다 → 조각은 뺀다(보고서에 기록).
import path from "node:path";
import { writeFileSync } from "node:fs";
import { loadRows, paragraphs, Out, writeChapter, brokenGlyphs, summary, ws } from "./lib.mjs";

const BOOK_ID = "1894bbee-4248-4f9a-ad7a-188822a05c0e";
const MARK = "jsbooks-md 2026-11-28";
const [, , rowsPath, outDir] = process.argv;
if (!rowsPath || !outDir) throw new Error("사용: node …/gobuin-sinjeonggi.mjs rows.json <출력폴더>");
const { chapters } = loadRows(rowsPath, BOOK_ID);
const NUM = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6 };
const report = { chapters: [], notes: [], dropped: [], subLines: [], broken: [], numbering: [], truncated: [], chapterMap: [] };

let chap = 0; // 지금 장
let expect = 1;
let cur = null; // 지금 절 번호
let sub = 0;
let section = null; // "preface" | "postface" | null
let secN = 0;
let postN = 0;

for (const [ci, row] of chapters.entries()) {
  const out = new Out(row.title);
  const paras = paragraphs(row.body_md);
  const nextFirst = chapters[ci + 1] ? paragraphs(chapters[ci + 1].body_md).find((p) => /^\d+\.\s/.test(p)) : null;
  let note = 0;
  const range = { slug: row.slug, from: null, to: null };
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    if (/^도강님(이|께서) 주신 ?자료 입니다\.$/.test(p)) {
      out.line(p, `note-${++note}`);
      report.notes.push({ row: row.slug, anchor: `note-${note}`, text: p, why: "등록자 글(자료 출처 알림)" });
      continue;
    }
    if (p === "머 릿 말") {
      out.head(p);
      section = "preface";
      continue;
    }
    if (p === "재판(再版) 편집후기(編輯後記)") {
      out.head(p);
      section = "postface";
      cur = null;
      continue;
    }
    const ch = p.match(/^제(.)장\(第.章\)/);
    if (ch) {
      chap = NUM[ch[1]];
      // "제이장(第二章)" 다음 문단이 장 이름이면 한 머리로
      let text = p.replace(/\n/g, " ");
      let cmp = p;
      const nxt = paras[i + 1];
      if (!/\n/.test(p) && nxt && !/^\d+\.\s/.test(nxt) && !/^제.장/.test(nxt)) {
        text += ` ${nxt}`;
        cmp += nxt;
        i++;
      }
      out.head(text, cmp);
      section = null;
      expect = 1;
      cur = null;
      continue;
    }
    if (section === "preface") {
      out.line(p, `preface-${++secN}`);
      continue;
    }
    if (section === "postface") {
      out.line(p, `postface-${++postN}`);
      continue;
    }
    const m = p.match(/^(\d+)\.\s+/);
    if (m) {
      const n = Number(m[1]);
      const text = p.slice(m[0].length);
      // 글 끝의 잘린 조각: 다음 글 첫 절과 번호가 같고, 그 앞부분과 글자가 같을 때만
      if (i === paras.length - 1 && nextFirst && nextFirst.startsWith(`${n}. `) && ws(nextFirst).startsWith(ws(p)) && ws(nextFirst).length > ws(p).length) {
        out.drop(p, `${chap}-${n} 앞부분 — 옛 글 길이 제한으로 잘린 조각. 다음 글(${chapters[ci + 1].slug}) 첫머리에 온전한 ${n}절이 있음`, report.dropped);
        report.truncated.push({ row: row.slug, verse: `${chap}-${n}`, tail: p.slice(-40), resolved: `${chapters[ci + 1].slug} 첫 절로 이어짐` });
        continue;
      }
      if (n !== expect) report.numbering.push({ row: row.slug, chap, expect, got: n });
      out.drop(m[0], null);
      out.verse(`${n}절`, text, `${chap}-${n}`);
      cur = n;
      sub = 1;
      expect = n + 1;
      range.from ??= `${chap}-${n}`;
      range.to = `${chap}-${n}`;
      continue;
    }
    // 번호 없는 문단 → 앞 절의 다음 줄(사이트 임의 구분)
    if (cur == null) throw new Error(`${row.slug}: 절 앞의 번호 없는 문단 "${p.slice(0, 40)}"`);
    sub++;
    out.line(p, `${chap}-${cur}-${sub}`);
    report.subLines.push({ row: row.slug, where: `${chap}-${cur}-${sub}`, text: p.slice(0, 60) });
  }
  const meta = JSON.parse(row.meta || "{}");
  const front = {
    scripture: "고부인 신정기",
    scripture_hanja: "高夫人神政記",
    편자: "이정립",
    편자_한자: "李正立",
    slug: row.slug,
    제목: row.title,
    meta: {
      ...meta,
      structure: MARK,
      verse_numbering: "original(원문 장마다 1부터 매긴 절 번호 → ^장-절)",
      sub_lines: "site(절 번호 없는 이어진 문단 ^장-절-N, 머릿말 ^preface-N, 재판 편집후기 ^postface-N, 등록자 글 ^note-N — 사이트 임의 구분)",
      range: range.from ? `${range.from}~${range.to}` : null,
    },
  };
  const file = `${String(ci + 1).padStart(2, "0")}_${row.slug}.md`;
  writeChapter(outDir, file, front, out);
  report.broken.push(...brokenGlyphs(row.body_md, row.slug));
  report.chapterMap.push(range);
  report.chapters.push({ file, slug: row.slug, id: row.id, title: row.title, legacy: meta.legacy_source, range: front.meta.range, verses: out.verses, lines: out.lineCount, blocks: out.blocks, ...out.check(row.body_md) });
}
writeFileSync(path.join(outDir, "..", "고부인-신정기.report.json"), JSON.stringify(report, null, 1));
summary(report.chapters);
console.log(`번호 어긋남 ${report.numbering.length}, 잘린 조각 ${report.truncated.length}, 이어진 줄 ${report.subLines.length}, 깨진 글자 ${report.broken.length}`);
