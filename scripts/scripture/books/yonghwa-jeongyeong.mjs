#!/usr/bin/env node
// 『용화전경(龍華典經)』 장 글 8개(옛 시루학당 361~368번 글) → jsbooks 형식 마크다운 + 대조 보고서 (2026-11-28)
//   node scripts/scripture/books/yonghwa-jeongyeong.mjs rows.json legacy.json <출력폴더>
//   legacy.json = 운영 legacy_posts(board='study', cid 361~368)의 body_html — 2장 수종제자 표의 칸을 되살리는 데 쓴다
//
// 원문 체계: 서(序) + 제1장~제7장. 장 > 절(제N절 이름) > 항(N항 이름) > 번호(N. — 장마다 1부터 이어짐).
//   ^장-N        원문 번호 (머리 "## N.")
//   ^장-N-k      번호 절 바로 뒤에 이어진 번호 없는 줄(사이트 임의 구분)
//   ^장-sS-K     절(S) 안의 번호 없는 문단·줄(사이트 임의 구분. S=0 은 절 머리 앞)
//   ^장-toc(-k)  장 머리의 절 목차 줄
//   ^preface-N   서(序) 줄,  ^note-N 등록자 글
// 제7장 부기(가사·명록)는 번호가 없는 글이라 "1." 도 본문 그대로 두고 줄마다 ^7-sS-K.
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { loadRows, lines as splitLines, Out, writeChapter, brokenGlyphs, summary, ws } from "./lib.mjs";

const BOOK_ID = "3c8105dc-a2d3-4177-ae2e-bc9e46f60330";
const MARK = "jsbooks-md 2026-11-28";
const [, , rowsPath, legacyPath, outDir] = process.argv;
if (!rowsPath || !legacyPath || !outDir) throw new Error("사용: node …/yonghwa-jeongyeong.mjs rows.json legacy.json <출력폴더>");
const { chapters } = loadRows(rowsPath, BOOK_ID);
let lraw = readFileSync(legacyPath, "utf8");
lraw = lraw.slice(lraw.indexOf("["));
const legacy = new Map(JSON.parse(lraw)[0].results.map((r) => [r.cid, r]));

const FW = (s) => s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
// 번호 없이 따로 선 소제목 줄(원문 글자 그대로 소제목으로)
const SUBHEADS = new Set(["복희(伏羲)팔괘(八卦)", "문왕(文王)팔괘(八卦)", "증산(甑山)팔괘(八卦)", "천도(天道)공사(公事)", "수종(隨從)제자(弟子)", "지운공사(地運公事)"]);
const PREFACE_HEADS = (l) => l === "서(序)" || l === "본서(本書) 간행(刊行)을 축(祝)함" || l.startsWith("진인도통연계(眞人道通");
// 번호 절 뒤에 오지만 그 절의 이어진 줄이 아니라 따로 선 말씀들(문단마다 사이트 번호)
const STANDALONE_AFTER = { "3-19": "제3장 제3절 법언 — 19. 뒤에 번호 없는 말씀 60줄. 19절의 이어진 줄이 아니라 따로 선 말씀으로 봄" };
const NUMBERLESS = new Set([7]); // 제7장 부기: "1." 을 절 번호로 보지 않음
const report = { chapters: [], notes: [], dropped: [], subLines: [], standalone: [], broken: [], numbering: [], table: null, joinedHeads: [] };

/** legacy HTML 의 첫 표 → 행마다 칸 글 */
function tableRows(html) {
  const t = html.match(/<table[\s\S]*?<\/table>/);
  if (!t) return null;
  return [...t[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((tr) =>
    [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((td) => td[1].replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()),
  );
}

for (const [ci, row] of chapters.entries()) {
  const out = new Out(row.title);
  const meta = JSON.parse(row.meta || "{}");
  const cid = Number(meta.legacy_source.match(/(\d+)번/)[1]);
  const ls = splitLines(row.body_md);
  const isPreface = row.title.startsWith("서");
  let C = isPreface ? 0 : null;
  let S = 0;
  let K = 0;
  let cur = null;
  let sub = 0;
  let standalone = false;
  let expect = 1;
  let note = 0;
  let toc = 0;
  let pre = 0;
  let tocOpen = false;
  let secSeen = false;
  const para = (text, cmp) => {
    out.line(text, `${C}-s${S}-${++K}`, cmp);
  };
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (/^도강님(이|께서) 주신 ?자료 입니다\.$/.test(l)) {
      out.line(l, `note-${++note}`);
      report.notes.push({ row: row.slug, anchor: `note-${note}`, text: l, why: "등록자 글(자료 출처 알림)" });
      continue;
    }
    if (l === "Top") {
      out.drop(l, "옛 홈페이지의 '맨 위로' 링크 글자(본문 아님)", report.dropped);
      report.dropped.at(-1).where = `${row.slug} ${C}장 ${S}절 머리 뒤`;
      continue;
    }
    if (isPreface) {
      if (PREFACE_HEADS(l)) out.head(l);
      else out.line(l, `preface-${++pre}`);
      continue;
    }
    const chm = l.match(/^제([０-９\d]+)장\s*/);
    if (chm && C == null) {
      C = Number(FW(chm[1]));
      const k = l.search(/제[０-９]+절/);
      if (k > 0) {
        out.head(l.slice(0, k).trim(), l.slice(0, k));
        out.line(l.slice(k), `${C}-toc`);
        report.joinedHeads.push({ row: row.slug, head: l.slice(0, k).trim(), toc: l.slice(k, k + 40) });
      } else out.head(l);
      tocOpen = true;
      continue;
    }
    // 장 머리 바로 뒤, 첫 절 머리 앞의 전각 숫자 "제１절 …" 줄 = 절 목차
    if (tocOpen && !secSeen && /^제[０-９]+절/.test(l)) {
      out.line(l, toc++ ? `${C}-toc-${toc}` : `${C}-toc`);
      continue;
    }
    tocOpen = false;
    const sec = FW(l).match(/^(?:제)?(\d+)절(?:\(.*?\))?\s/);
    if (sec) {
      secSeen = true;
      S = Number(sec[1]);
      K = 0;
      cur = null;
      out.head(l);
      continue;
    }
    if (/^\d+항\s/.test(l) || SUBHEADS.has(l)) {
      out.head(l, l, 4);
      cur = null;
      if (l === "수종(隨從)제자(弟子)") {
        // 표: 원본 줄은 칸 하나씩(빈 칸은 사라짐) → 옛 글 HTML 표로 행을 되살린다
        const trs = tableRows(legacy.get(cid).body_html);
        const flat = trs.flat().filter(Boolean);
        const srcCells = ls.slice(i + 1, i + 1 + flat.length);
        if (srcCells.join("\n") !== flat.join("\n")) throw new Error("수종제자 표: 옛 글 표 칸과 본문 줄이 다릅니다");
        for (const cells of trs) para(cells.map((c) => c || "—").join(" | "), cells.join("")); // 빈 칸은 "—"(대조에서는 뺌)
        report.table = { row: row.slug, where: `${C}장 ${S}절`, rows: trs.length, cols: trs[0].length, emptyCells: trs.flat().filter((c) => !c).length, note: "원본 본문은 칸마다 한 줄이고 빈 칸이 없어져 열이 섞여 있었음 — 옛 글 HTML 표로 행·열을 되살려 한 행 = 한 줄(칸 사이 ' | ')" };
        i += flat.length;
      }
      continue;
    }
    const num = !NUMBERLESS.has(C) && l.match(/^(\d+)\.\s*/);
    if (num) {
      const n = Number(num[1]);
      if (n !== expect) report.numbering.push({ row: row.slug, chap: C, expect, got: n });
      out.drop(num[0], null);
      out.verse(`${n}.`, l.slice(num[0].length), `${C}-${n}`);
      cur = n;
      sub = 1;
      expect = n + 1;
      standalone = !!STANDALONE_AFTER[`${C}-${n}`];
      if (standalone) report.standalone.push({ after: `${C}-${n}`, why: STANDALONE_AFTER[`${C}-${n}`] });
      continue;
    }
    if (cur != null && !standalone) {
      sub++;
      out.line(l, `${C}-${cur}-${sub}`);
      report.subLines.push({ row: row.slug, where: `${C}-${cur}-${sub}`, text: l.slice(0, 50) });
      continue;
    }
    if (cur != null && standalone) {
      cur = null; // 이 뒤 번호 없는 줄은 절 안 문단
    }
    para(l);
  }
  const front = {
    scripture: "용화전경",
    scripture_hanja: "龍華典經",
    편자: "김낙원",
    slug: row.slug,
    제목: row.title,
    ...(isPreface ? {} : { 장: C }),
    meta: {
      ...meta,
      structure: MARK,
      verse_numbering: NUMBERLESS.has(C) || isPreface ? "site(번호 없는 글 — 줄마다 사이트 임의 구분)" : "original(원문 장마다 이어지는 번호 → ^장-번호)",
      sub_lines: "site(^장-번호-k 이어진 줄, ^장-s절-K 절 안 번호 없는 문단, ^장-toc 절 목차, ^note-N 등록자 글 — 사이트 임의 구분)",
    },
  };
  const file = `${String(ci).padStart(2, "0")}_${row.slug}.md`;
  writeChapter(outDir, file, front, out);
  report.broken.push(...brokenGlyphs(row.body_md, row.slug));
  report.chapters.push({ file, slug: row.slug, id: row.id, title: row.title, legacy: meta.legacy_source, chap: C, verses: out.verses, lastVerse: expect - 1, lines: out.lineCount, blocks: out.blocks, ...out.check(row.body_md) });
}
writeFileSync(path.join(outDir, "..", "용화전경.report.json"), JSON.stringify(report, null, 1));
summary(report.chapters);
console.log(`번호 어긋남 ${report.numbering.length}, 이어진 줄 ${report.subLines.length}, 뺀 잡음 ${report.dropped.length}, 깨진 글자 ${report.broken.length}`);
