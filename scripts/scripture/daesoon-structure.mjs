#!/usr/bin/env node
// 『대순전경』 옛 게시판 글(articles draft, body_md) → jsbooks 형식 장·절 마크다운 + 대조 보고서 (2026-11-28)
//
// 쓰는 법:
//   1) 운영 D1 에서 원본 행을 JSON 으로 받는다(읽기만):
//      npx wrangler d1 execute jsbeob-db -c wrangler.toml --remote --json \
//        --command "SELECT * FROM articles WHERE id='<책 id>' OR parent_id='<책 id>' ORDER BY sort_order" > rows.json
//   2) node scripts/scripture/daesoon-structure.mjs rows.json <출력폴더>   (예: …/drafts/daesoon/대순전경 — 저장소 밖. 옛 content/scripture 는 DB 전환 때 지웠다)
//      출력폴더 옆에 대순전경.report.json(보고서 재료)도 만든다
//   3) JB_SESSION=… node scripts/import-scripture.mjs <출력폴더> --book 대순전경 --status keep --no-book   (로컬 API)
//   4) python3 scripts/scripture/make-update-sql.py rows.json <로컬 import 뒤 rows.json> <SQL 폴더>
//
// 원칙
//   - 경전 문장(맞춤법·한자·띄어쓰기)은 고치지 않는다. 바꾸는 것은 구조뿐:
//     ① 문단 앞 "장-절 " 번호 → "## N절" 머리 + 끝의 위치 표시 "^장-절"(번호가 깨진 곳 — "39 ", "-58 ", "7-1천사" — 도 같은 번호로 맞춤)
//     ② 절 번호 없이 이어지는 문단(주문 줄, 붙여 쓴 글) → 앞 절의 다음 줄, 위치 "^장-절-2, -3 …"(사이트 임의 구분)
//     ③ 문장 한가운데서 끊긴 문단(아래 JOIN) → 띄어쓰기 한 칸으로 다시 붙임
//     ④ 확실한 잡음(아래 NOISE)만 뺀다 — 뺀 것은 보고서에 모두 적는다
//   - 마지막에 원본(공백 제외)과 출력(공백·표시 제외 + 뺀 번호·잡음)을 글자 단위로 대조해 빠진 글자가 없음을 확인한다.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const [, , rowsPath, outDir] = process.argv;
if (!rowsPath || !outDir) {
  console.error("사용: node scripts/scripture/daesoon-structure.mjs rows.json <출력폴더>");
  process.exit(1);
}
let raw = readFileSync(rowsPath, "utf8").replace(/^[^\[{]*/, "");
let rows = JSON.parse(raw);
if (Array.isArray(rows) && rows[0]?.results) rows = rows[0].results;
const book = rows.find((r) => !r.parent_id && r.title === "대순전경");
if (!book) throw new Error("책 행(제목 '대순전경')이 없습니다");
const chapters = rows.filter((r) => r.parent_id === book.id).sort((a, b) => a.sort_order - b.sort_order);

// 문장 중간에서 끊겨 두 문단이 된 곳: [장 번호, 앞 문단이 끝나는 글, 뒤 문단 시작 글]
const JOIN = [
  [4, "쉬임 없이 천지공사를", "행하셨으나 참관한"],
  [4, "그 콩을 세어보니 일 천", "개러라."],
  [8, "나으면 곧 갚으리라고", "결심하니 복통이"],
];
// 확실한 잡음(문단 전체가 이 글자와 같을 때만 뺌): [장, 문단 글, 이유]
const NOISE = [[9, ".", "9-32 뒤 홀로 남은 마침표 한 개(게시판 붙여넣기 찌꺼기)"]];

const ws = (s) => s.replace(/\s+/g, "");
const report = {
  chapters: [],
  fixedNumbers: [],
  continuations: [],
  joins: [],
  noise: [],
  broken: [],
  truncated: [],
};

function paragraphs(md) {
  return md
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function cleanTitle(t) {
  return t.replace(/\s+/g, " ").trim();
}

mkdirSync(outDir, { recursive: true });
const FRONT_BASE = { scripture: "대순전경", scripture_hanja: "大巡典經", 편자: "이상호", 편자_한자: "李祥昊" };

for (const [ci, row] of chapters.entries()) {
  const meta = row.meta ? JSON.parse(row.meta) : {};
  let paras = paragraphs(row.body_md);
  const removed = []; // 원본에서 출력으로 가지 않은 글자(번호 머리)
  const noise = []; // 뺀 잡음 문단
  const isPreface = row.title.startsWith("서");
  const m = row.title.match(/^제\s*(\d+)\s*장\s*(.*)$/);
  const chap = isPreface ? 0 : Number(m[1]);
  const chapName = isPreface ? "" : m[2].trim();

  // 잡음 빼기
  paras = paras.filter((p, i) => {
    const hit = NOISE.find(([c, text]) => c === chap && p === text);
    if (hit) {
      noise.push(p);
      report.noise.push({ chap, idx: i, text: p, why: hit[2], before: paras[i - 1]?.slice(-40) });
      return false;
    }
    return true;
  });
  // 끊긴 문단 붙이기
  for (const [c, endA, startB] of JOIN) {
    if (c !== chap) continue;
    const i = paras.findIndex((p, k) => p.endsWith(endA) && paras[k + 1]?.startsWith(startB));
    if (i < 0) throw new Error(`JOIN 대상을 못 찾음: ${c}장 "${endA}"`);
    report.joins.push({ chap, a: paras[i].slice(-30), b: paras[i + 1].slice(0, 30) });
    paras.splice(i, 2, `${paras[i]} ${paras[i + 1]}`);
  }

  const front = {
    ...FRONT_BASE,
    ...(isPreface ? { section: "preface" } : { 장: chap, 장_이름: chapName }),
    slug: row.slug,
    제목: row.title,
    meta: JSON.stringify({
      ...meta,
      structure: "jsbooks-md 2026-11-28",
      verse_numbering: isPreface ? "site(문단 단위, 사이트 임의 구분)" : "original(원문 장-절 번호)",
      ...(isPreface ? {} : { sub_lines: "site(절 번호 없는 이어진 문단·주문 줄은 ^장-절-N, 사이트 임의 구분)" }),
    }),
  };
  const out = [];
  const title = paras.shift();
  if (ws(title) !== ws(row.title) && !isPreface) throw new Error(`${row.slug} 첫 문단이 장 제목이 아님: ${title}`);

  let verses = 0;
  let lines = 0;
  let lastVerse = "";
  if (isPreface) {
    // 표제(세로쓰기 한 글자씩) → 한 줄, 그 뒤 서(序)·찬(贊) 머리
    out.push(`# ${row.title}`, "");
    let n = 0;
    const cover = [title];
    while (paras.length && /^[一-鿿]$/.test(paras[0])) cover.push(paras.shift());
    out.push(`${cover.join(" ")} ^preface-${++n}`, "");
    report.continuations.push({ chap: 0, where: "표지", text: cover.join(" "), why: "세로쓰기 표제 글자를 한 줄로(띄어쓰기만)" });
    for (const p of paras) {
      if (p === "서(序)" || p === "찬(贊)") {
        out.push(`## ${p}`, "");
        continue;
      }
      out.push(`${p} ^preface-${++n}`, "");
      lines++;
    }
    verses = n;
    lines = n;
  } else {
    out.push(`# ${row.title}`, "");
    let cur = null; // 현재 절 번호
    let sub = 0;
    let expect = 1;
    let afterPostface = false;
    var expectLast = 0;
    let pf = 0;
    for (const p of paras) {
      if (p === "대순전경 삼간사(三刊辭)") {
        afterPostface = true;
        out.push(`### ${p}`, "");
        report.postface = { chap, title: p };
        continue;
      }
      if (afterPostface) {
        out.push(`${p} ^postface-${++pf}`, "");
        continue;
      }
      // 정상: "4-12 본문" / 깨진 꼴: "12 본문", "-12 본문", "7-1본문"
      const ok = p.match(/^(\d+)-(\d+)\s+/);
      const bad = !ok && p.match(/^(?:(\d+)-(\d+)(?=[^\d\s-])|-(\d+)\s+|(\d+)\s+)/);
      let num = null;
      let head = "";
      if (ok) {
        if (Number(ok[1]) !== chap) throw new Error(`${row.slug}: 다른 장 번호 ${ok[0]}`);
        num = Number(ok[2]);
        head = ok[0];
      } else if (bad) {
        const n = Number(bad[2] ?? bad[3] ?? bad[4]);
        // 깨진 번호는 바로 앞 절 다음 번호일 때만 절 머리로 인정(그 밖은 본문 숫자로 봄)
        if (n === expect && (bad[1] == null || Number(bad[1]) === chap)) {
          num = n;
          head = bad[0];
          report.fixedNumbers.push({ chap, verse: n, raw: bad[0].trim() || bad[0], text: p.slice(head.length, head.length + 30) });
        }
      }
      if (num != null) {
        if (num !== expect) report.broken.push({ chap, expect, got: num });
        removed.push(head);
        cur = num;
        sub = 1;
        expect = num + 1;
        expectLast = num;
        verses++;
        lines++;
        lastVerse = p;
        let text = p.slice(head.length);
        // 끝에 남은 HTML 찌꺼기 "<"(옛 글이 잘린 자리) — 잡음으로 빼고 기록
        if (/[^<]<$/.test(text)) {
          text = text.slice(0, -1);
          removed.push("<");
          report.noise.push({ chap, text: "<", why: `${chap}-${num} 끝의 HTML 찌꺼기(옛 게시글이 여기서 잘림)`, before: text.slice(-30) });
        }
        out.push(`## ${num}절`, "", `${text} ^${chap}-${num}`, "");
      } else {
        if (cur == null) {
          // 장 첫 절 앞의 머리글(4장 "◎ …")
          out.push(`${p} ^${chap}-0`, "");
          report.continuations.push({ chap, where: `${chap}장 첫 절 앞`, text: p.slice(0, 60), why: "절 번호 없는 장 머리글 — 위치 ^" + chap + "-0" });
          lines++;
          continue;
        }
        sub++;
        lines++;
        lastVerse = p;
        out.push(`${p} ^${chap}-${cur}-${sub}`, "");
        report.continuations.push({ chap, where: `${chap}-${cur} 의 ${sub}째 줄`, text: p.slice(0, 60) });
      }
    }
  }

  // 장의 마지막 절이 문장 중간에서 끊겼는지
  if (!isPreface && !/[.。」?!]\s*$/.test(lastVerse)) {
    report.truncated.push({ chap, verse: `${chap}-${expectLast}`, tail: lastVerse.slice(-60) });
  }

  // 깨진 글자(?) 찾기
  const body = paras.join("\n");
  for (const mm of body.matchAll(/(.{0,12})\?(.{0,8})/g)) {
    report.broken.push({ chap, glyph: true, ctx: `${mm[1]}?${mm[2]}` });
  }

  // 글자 대조: 원본(공백 제외) == 제목 + 출력 본문(표시 제외) + 뺀 것
  const outBody = out
    .filter((l) => !/^#{1,6}\s/.test(l) || /^#{2,6}\s(?!\d+절$)/.test(l))
    .map((l) => l.replace(/^#{2,6}\s/, "").replace(/\s\^[\w-]+$/, ""))
    .join("");
  // 원본에서 잡음 문단을 빼고, 번호 머리를 앞에서부터 차례로 잘라 낸 것 == 출력(순서까지 같아야 함)
  const origNo = ws(row.body_md);
  let rest = ws(paragraphs(row.body_md).filter((p) => !noise.includes(p)).join(""));
  let cut = "";
  for (const h of removed.map(ws)) {
    const k = rest.indexOf(h);
    if (k < 0) throw new Error(`${row.slug}: 번호 머리 ${h} 를 원본에서 못 찾음`);
    cut += rest.slice(0, k);
    rest = rest.slice(k + h.length);
  }
  cut += rest;
  const outNo = (isPreface ? "" : ws(title)) + ws(outBody); // 서문은 첫 문단(표제)이 본문 첫 줄에 들어감
  const sameSet = cut === outNo;
  if (!sameSet) {
    let k = 0;
    while (cut[k] === outNo[k]) k++;
    console.error(`${row.slug} 불일치 위치 ${k}: 원본 "${cut.slice(k - 20, k + 20)}" / 출력 "${outNo.slice(k - 20, k + 20)}"`);
  }
  const fm = Object.entries({ ...front }).map(([k, v]) => `${k}: ${v}`);
  const file = isPreface ? "00_서문.md" : `${String(chap).padStart(2, "0")}_제${chap}장.md`;
  writeFileSync(path.join(outDir, file), `---\n${fm.join("\n")}\n---\n\n${out.join("\n").trimEnd()}\n`);
  report.chapters.push({
    file,
    slug: row.slug,
    id: row.id,
    title: row.title,
    legacy: meta.legacy_source,
    verses,
    lines,
    origChars: row.body_md.length,
    origNoWs: origNo.length,
    outNoWs: outNo.length,
    removedNoWs: ws(removed.join("") + noise.join("")).length,
    sameChars: sameSet,
  });
}

writeFileSync(path.join(outDir, "..", "대순전경.report.json"), JSON.stringify(report, null, 1));
for (const c of report.chapters)
  console.log(`${c.file} ${c.title} 절 ${c.verses} 줄 ${c.lines} 원본 ${c.origNoWs} = 출력 ${c.outNoWs} + 뺀 ${c.removedNoWs} ${c.sameChars ? "✓" : "✗ 글자 불일치"}`);
if (report.chapters.some((c) => !c.sameChars)) process.exit(2);
