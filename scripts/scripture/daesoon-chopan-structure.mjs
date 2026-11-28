#!/usr/bin/env node
// 『대순전경 초판』(1929, 13장) 옛 게시판 글(articles draft, body_md) → jsbooks 형식 장·절 마크다운 + 대조 보고서 (2026-11-28)
//
// 『대순전경』(3판) 도구(daesoon-structure.mjs)와 같은 원칙·같은 출력 형식. 초판 글은 꼴이 달라 따로 둔다:
//   - 절 = 줄 머리 "N. "(장 번호 없음). 한 절 = 현대어 번역 + "原文: 국한문 원문"(같은 줄 또는 다음 줄)
//   - 긴 장은 옛 게시판 길이 제한 때문에 여러 글(제목 끝 "-2", "-3")로 나뉘어 있다 → 장 하나로 합친다
//   - 모든 글 첫 줄 "도강님께서 주신 자료 입니다."(등록자 글) → 뺀다(보고서에 기록)
//
// 쓰는 법:
//   1) 운영 D1 에서 원본 행을 JSON 으로 받는다(읽기만):
//      npx wrangler d1 execute jsbeob-db -c wrangler.toml --remote --json \
//        --command "SELECT * FROM articles WHERE id='<책 id>' OR parent_id='<책 id>' ORDER BY sort_order" > rows.json
//   2) node scripts/scripture/daesoon-chopan-structure.mjs rows.json <출력폴더>   (출력폴더 옆에 대순전경-초판.report.json)
//   3) JB_SESSION=… node scripts/import-scripture.mjs <출력폴더> --book 대순전경-초판 --status keep --no-book   (로컬 API)
//   4) python3 scripts/scripture/make-update-sql.py rows.json <로컬 import 뒤 rows.json> <SQL 폴더> "<표식>" --hide <이어지는 조각 id,…>
//
// 원칙
//   - 경전 문장(맞춤법·한자·띄어쓰기·'?' 깨진 글자)은 고치지 않는다. 바꾸는 것은 구조뿐:
//     ① "N. " 번호 → "## N절" 머리 + 문장 끝 위치 "^장-절"
//     ② 같은 절 안의 "原文:" 앞에서 줄을 나눔(위치 "^장-절-2"), 그 밖에 절 안에서 이어지는 줄도 "^장-절-N"(사이트 임의 구분)
//     ③ 조각 이음매: 앞 조각 끝 절이 뒤 조각 첫 절의 앞부분과 글자까지 같으면(확실한 중복 붙여넣기) 앞 조각의 잘린 사본만 뺀다
//        — 같지 않으면 둘 다 두고 보고서에 적는다
//     ④ 뒤 조각의 번호가 1부터 다시 시작하면(4장-2) 앞 조각에 이어지는 번호로 맞춘다(보고서에 적음)
//   - 마지막에 원본(공백 제외)과 출력(공백·표시 제외 + 뺀 것)을 글자 단위·순서까지 대조한다.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const [, , rowsPath, outDir] = process.argv;
if (!rowsPath || !outDir) {
  console.error("사용: node scripts/scripture/daesoon-chopan-structure.mjs rows.json <출력폴더>");
  process.exit(1);
}
const BOOK_TITLE = "대순전경 초판";
const MARK = "jsbooks-md-chopan 2026-11-28";
let raw = readFileSync(rowsPath, "utf8").replace(/^[^\[{]*/, "");
let rows = JSON.parse(raw);
if (Array.isArray(rows) && rows[0]?.results) rows = rows[0].results;
const book = rows.find((r) => !r.parent_id && r.title === BOOK_TITLE);
if (!book) throw new Error(`책 행(제목 '${BOOK_TITLE}')이 없습니다`);
const items = rows.filter((r) => r.parent_id === book.id).sort((a, b) => a.sort_order - b.sort_order);

// 등록자 글(자료 제공 표시) — 줄 전체가 같을 때만 뺀다
const NOISE_LINE = /^도강님께서 주신 ?자료 입니다\.$/;
// 장이 아닌 글: 제목 → 파일·위치 머리·성격
const SECTIONS = [
  { re: /^1~6판 안내$/, key: "guide", file: "00a_1~6판안내.md", note: "초판 본문 아님 — 등록자(도강님 자료)의 1~6판 해설 글. 3판(1947) 이후 내용 포함" },
  { re: /^대순전경 삼간사/, key: "postface3", file: "00b_삼간사.md", note: "초판 본문 아님 — 3판(1947) 편자 후기(三刊辭). 3판 책 제9장 끝과 같은 글" },
  { re: /^서\(序\)$/, key: "preface", file: "00c_서.md", note: "초판 서(序), 이상호 1929" },
  { re: /^補 ?註$/, key: "notes", file: "00d_보주.md", note: "초판 補註(본문 이해를 돕는 주)" },
  { re: /^찬\(贊\)$/, key: "chan", file: "14_찬.md", note: "초판 찬(贊), 이성영 1929" },
];

const ws = (s) => s.replace(/\s+/g, "");
const lines = (md) =>
  md
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
const report = { book: { id: book.id, slug: book.slug }, chapters: [], noise: [], seams: [], renumbered: [], missingVerses: [], numberGaps: [], beforeFirstVerse: [], glyphs: {}, truncatedEnd: [] };

// 장 조각 묶기: 제목 끝 "-N" 이면 바로 앞 장에 붙인다
const groups = [];
for (const r of items) {
  const frag = r.title.match(/^(.*?)-(\d+)$/);
  if (frag && groups.length && groups.at(-1).chap != null) {
    groups.at(-1).rows.push(r);
    continue;
  }
  const sec = SECTIONS.find((s) => s.re.test(r.title.trim()));
  const m = r.title.match(/^제\s*(\d+)\s*장/);
  if (!sec && !m) throw new Error(`장도 아니고 알려진 글도 아님: ${r.title}`);
  groups.push({ rows: [r], sec, chap: m ? Number(m[1]) : null });
}

mkdirSync(outDir, { recursive: true });
const FRONT_BASE = { scripture: BOOK_TITLE, scripture_hanja: "大巡典經", 편자: "이상호", 편자_한자: "李祥昊" };

for (const g of groups) {
  const first = g.rows[0];
  const meta0 = first.meta ? JSON.parse(first.meta) : {};
  const removed = []; // 원본에서 출력으로 가지 않은 글(순서대로): 번호 머리·잡음·중복 사본
  const out = [`# ${first.title}`, ""];
  let title = null; // 본문 첫 줄의 장 제목
  let verses = 0;
  let nLines = 0;
  const chap = g.chap;
  const fragLines = g.rows.map((r) => lines(r.body_md));

  // 잡음(등록자 글) 빼기
  fragLines.forEach((ls, fi) => {
    if (NOISE_LINE.test(ls[0])) {
      report.noise.push({ slug: g.rows[fi].slug, text: ls[0], why: "등록자의 자료 제공 표시(사설)" });
      ls.splice(0, 1);
      ls.removedNoise = true;
    }
  });

  if (g.sec) {
    // 장이 아닌 글: 첫 줄이 제목과 같으면 제목으로 쓰고, 나머지는 줄(문단) 단위
    const ls = [...fragLines[0]];
    if (ws(ls[0]) === ws(first.title)) title = ls.shift();
    let n = 0;
    for (const l of ls) {
      out.push(`${l} ^${g.sec.key}-${++n}`, "");
    }
    verses = n;
    nLines = n;
  } else {
    // 장: 조각마다 번호 머리를 따라 절로 나눈다
    const vs = []; // {num, parts:[줄…], frag}
    const pre = []; // 첫 절 앞 줄
    const tail = []; // 판권 등 마지막 절 뒤 줄
    let expect = 1;
    for (const [fi, ls0] of fragLines.entries()) {
      const ls = [...ls0];
      if (fi === 0) {
        if (!/^제\s*\d+\s*장/.test(ls[0])) throw new Error(`${first.slug} 첫 줄이 장 제목이 아님: ${ls[0]}`);
        title = ls.shift();
      }
      // 이 조각의 번호 보정(1부터 다시 시작하는 조각)
      const firstNum = Number(ls.find((l) => /^\d+\.\s?/.test(l))?.match(/^(\d+)/)[1]);
      let offset = 0;
      if (fi > 0 && firstNum === 1 && expect > 2) {
        offset = expect - 2; // 앞 조각 마지막 절(expect-1)과 겹친다고 보고 이어 붙인다(아래 이음매 검사로 확인)
        report.renumbered.push({ slug: g.rows[fi].slug, offset, why: `조각의 절 번호가 1부터 다시 시작 → ${offset}을 더해 앞 조각에 이어지게 맞춤(1 → ${1 + offset})` });
      }
      let seamChecked = fi === 0;
      for (const l of ls) {
        const m = l.match(/^(\d+)\.\s?/);
        let num = m ? Number(m[1]) + offset : null;
        // 번호 인정: 다음 번호, 또는 이음매에서 앞 조각 마지막 번호의 반복
        const atSeam = !seamChecked && m;
        if (m && !(num === expect || (atSeam && num === expect - 1))) {
          if (num > expect && num < expect + 5) report.numberGaps.push({ chap, expect, got: num });
          else num = null;
        }
        if (num != null) {
          if (atSeam) {
            seamChecked = true;
            const prev = vs.at(-1);
            if (prev && prev.num === num) {
              // 이음매 겹침: 앞 조각의 잘린 사본이 이 절의 앞부분과 같은가
              const prevText = ws(prev.parts.join(""));
              const curText = ws(l.slice(m[0].length));
              const exact = prev.parts.length === 1 && curText.startsWith(prevText); // 앞 사본(한 줄)이 이 절 첫 줄의 앞부분과 같은가
              report.seams.push({
                chap,
                from: g.rows[fi - 1].slug,
                to: g.rows[fi].slug,
                verse: `${chap}-${num}`,
                prevTail: prev.parts.join(" ").slice(-60),
                prevLen: prevText.length,
                curHead: l.slice(0, 60),
                exactPrefix: exact,
                action: exact ? "앞 조각의 잘린 사본을 뺌(뒤 조각에 같은 글이 처음부터 온전히 있음)" : "둘 다 둠 — 확인 필요",
              });
              if (exact) {
                vs.pop();
                verses--;
                removed[prev.headAt] = { kind: "dup", text: prev.raw }; // 번호 머리 자리에 사본 전체
              } else {
                // 둘 다 둔다: 뒤 조각의 절은 같은 절의 다음 줄들로
                prev.parts.push(l.slice(m[0].length));
                removed.push({ kind: "head", text: m[0], at: l });
                prev.raw += "\n" + l;
                continue;
              }
            } else if (prev && num !== expect) {
              num = null;
            } else {
              report.seams.push({ chap, from: g.rows[fi - 1].slug, to: g.rows[fi].slug, verse: `${chap}-${num}`, prevTail: prev?.parts.join(" ").slice(-60), curHead: l.slice(0, 60), exactPrefix: false, action: "겹침 없음 — 그대로 이어 붙임" });
            }
          }
        }
        if (num != null) {
          removed.push({ kind: "head", text: m[0], at: l });
          vs.push({ num, parts: [l.slice(m[0].length)], raw: l, frag: fi, headAt: removed.length - 1 });
          verses++;
          expect = num + 1;
        } else if (!vs.length) {
          pre.push(l);
        } else if (chap === 13 && (/^昭和/.test(l) || tail.length)) {
          tail.push(l); // 13장 끝의 판권(版權) 줄
        } else {
          vs.at(-1).parts.push(l);
          vs.at(-1).raw += "\n" + l;
        }
      }
    }
    // 절 → 줄(原文: 앞에서 나눔)
    const split = (parts) => parts.flatMap((p) => p.split(/(?<=\S)\s*(?=原文\s*:|補充註解\s*:|補註\s*第)/).map((s) => s.trim()).filter(Boolean));
    if (pre.length) {
      split(pre).forEach((l, i) => {
        out.push(`${l} ^${chap}-0${i ? `-${i + 1}` : ""}`, "");
        nLines++;
      });
      report.beforeFirstVerse.push({ chap, lines: pre.map((l) => l.slice(0, 80)) });
    }
    for (const v of vs) {
      out.push(`## ${v.num}절`, "");
      const ls = split(v.parts);
      ls.forEach((l, i) => {
        out.push(`${l} ^${chap}-${v.num}${i ? `-${i + 1}` : ""}`, "");
        nLines++;
      });
      const body = v.parts.join(" ");
      if (/^\(원본에 누락\)?$/.test(body.trim()) || /^\(원본에 누락/.test(body.trim())) report.missingVerses.push({ chap, verse: v.num, text: body.trim() });
      if (!body.trim()) report.missingVerses.push({ chap, verse: v.num, text: "(번호만 있고 글 없음 — 다음 줄들이 부적·도형 글자)" });
    }
    if (tail.length) {
      out.push(`### 판권(版權)`, "");
      tail.forEach((l, i) => out.push(`${l} ^colophon-${i + 1}`, ""));
      report.colophon = { chap, lines: tail };
    }
    // 마지막 절 끝이 문장 끝인가
    const last = vs.at(-1);
    const lastLine = split(last.parts).at(-1);
    if (!/[.。」?!"”)]\s*$/.test(lastLine)) report.truncatedEnd.push({ chap, verse: `${chap}-${last.num}`, tail: lastLine.slice(-60) });
    report.chapters.push({ chap, numbers: vs.map((v) => v.num) });
  }

  // 깨진 글자(?) 세기
  const allText = fragLines.flat().join("\n");
  const q = [...allText.matchAll(/(.{0,8})\?(.{0,6})/g)].map((m) => `${m[1]}?${m[2]}`);
  report.glyphs[first.slug] = { count: (allText.match(/\?/g) ?? []).length, samples: q.slice(0, 6) };

  // 글자 대조: 원본 조각들(공백 제외) == 제목 + 출력 본문(표시 제외) + 뺀 것(순서까지)
  const outBody = out
    .slice(2)
    .filter((l) => !/^## \d+절$/.test(l) && l !== "### 판권(版權)")
    .map((l) => l.replace(/\s\^[\w-]+$/, ""))
    .join("");
  const orig = g.rows.map((r) => r.body_md).join("\n");
  let rest = ws(fragLines.flat().join(""));
  const noiseNo = g.rows.reduce((n, r, i) => n + (fragLines[i].removedNoise ? ws(lines(r.body_md)[0]).length : 0), 0);
  // 번호 머리·중복 사본을 앞에서부터 차례로 잘라 낸다
  let cut = "";
  for (const h of removed.map((x) => ws(x.text))) {
    const k = rest.indexOf(h);
    if (k < 0) throw new Error(`${first.slug}: 뺀 글 ${h.slice(0, 30)} 를 원본에서 못 찾음`);
    cut += rest.slice(0, k);
    rest = rest.slice(k + h.length);
  }
  cut += rest;
  const outNo = ws((title ?? "") + outBody);
  const same = cut === outNo;
  if (!same) {
    let k = 0;
    while (cut[k] === outNo[k]) k++;
    console.error(`${first.slug} 불일치 위치 ${k}: 원본 "${cut.slice(k - 20, k + 20)}" / 출력 "${outNo.slice(k - 20, k + 20)}"`);
  }

  const legacy = g.rows.map((r) => (r.meta ? JSON.parse(r.meta).legacy_source : "")).join(" + ");
  const meta = {
    ...meta0,
    ...(g.rows.length > 1 ? { legacy_source: legacy, merged_from: g.rows.map((r) => r.slug) } : {}),
    structure: MARK,
    verse_numbering: g.sec ? "site(줄·문단 단위, 사이트 임의 구분)" : "original(원문 절 번호, 장 번호는 글 제목)",
    ...(g.sec ? { not_chopan_text: g.sec.key === "guide" || g.sec.key === "postface3" ? true : undefined, doc_note: g.sec.note } : { sub_lines: "site(절 안 '原文:' 줄과 이어지는 줄은 ^장-절-N, 사이트 임의 구분)", lines: "번역(현대어, 도강님 자료) + 原文(초판 국한문)" }),
  };
  for (const k of Object.keys(meta)) if (meta[k] === undefined) delete meta[k];
  const front = {
    ...FRONT_BASE,
    ...(g.sec ? { section: g.sec.key } : { 장: chap, 장_이름: (title ?? "").replace(/^제\s*\d+\s*장\.?\s*/, "").trim() }),
    slug: first.slug,
    제목: first.title,
    meta: JSON.stringify(meta),
  };
  const file = g.sec ? g.sec.file : `${String(chap).padStart(2, "0")}_제${chap}장.md`;
  const fm = Object.entries(front).map(([k, v]) => `${k}: ${v}`);
  writeFileSync(path.join(outDir, file), `---\n${fm.join("\n")}\n---\n\n${out.join("\n").trimEnd()}\n`);
  const rep = {
    file,
    slug: first.slug,
    id: first.id,
    title: first.title,
    fragments: g.rows.map((r) => ({ id: r.id, slug: r.slug, title: r.title })),
    legacy,
    verses,
    lines: nLines,
    origNoWs: ws(orig).length,
    outNoWs: outNo.length,
    removedNoWs: ws(orig).length - outNo.length,
    removedHeads: ws(removed.filter((x) => x.kind === "head").map((x) => x.text).join("")).length,
    removedDup: ws(removed.filter((x) => x.kind === "dup").map((x) => x.text).join("")).length,
    removedNoise: noiseNo,
    sameChars: same && ws(orig).length === outNo.length + ws(removed.map((x) => x.text).join("")).length + noiseNo,
  };
  const ci = report.chapters.findIndex((c) => c.chap === chap && chap != null && !c.file);
  if (ci >= 0) Object.assign(report.chapters[ci], rep);
  else report.chapters.push(rep);
}

writeFileSync(path.join(outDir, "..", "대순전경-초판.report.json"), JSON.stringify(report, null, 1));
for (const c of report.chapters)
  console.log(
    `${c.file} ${c.title}${c.fragments.length > 1 ? ` (조각 ${c.fragments.length})` : ""} 절 ${c.verses} 줄 ${c.lines} 원본 ${c.origNoWs} = 출력 ${c.outNoWs} + 번호 ${c.removedHeads} + 잡음 ${c.removedNoise} + 중복 ${c.removedDup} ${c.sameChars ? "✓" : "✗ 글자 불일치"}`
  );
if (report.chapters.some((c) => !c.sameChars)) process.exit(2);
