// 워드 문서(DOCX) → Claude 가 Read 로 읽을 수 있는 HTML + 그림 파일 (2026-11-27)
//
// 외부 라이브러리 없이 직접 푼다: DOCX = zip 안의 XML(word/document.xml) + 관계(word/_rels/document.xml.rels) + 그림(word/media/*).
// zip 은 node:zlib 의 inflateRaw 로, XML 은 아래의 작은 해석기로 읽는다(필요한 것: 문단·표·그림·글상자).
//
// 받은 파일은 신뢰할 수 없는 입력이므로 (convert-hwp.mjs 와 같은 방식)
//   - 감시 서비스와 다른 프로세스(node --max-old-space-size)에서 돌리고 시간 제한을 건다 — 이 파일을 `--child` 로 다시 띄운다
//   - 그 건의 임시 폴더 안에서만 읽고 쓴다(cwd = 임시 폴더, 출력 경로는 자식이 정하지 않고 고정 이름)
//   - zip 항목 수·풀린 크기(zip 폭탄)·XML 노드 수·결과 HTML 크기·그림 수·그림 크기에 상한을 둔다
//   - 실패하면 DocxError(사유) — 감시 서비스는 그 파일만 '못 읽음' 경고로 남기고 나머지로 계속한다
//
// 결과: { files:[{path, name, content_type, converted_from}], warnings:[string] }
//   - 본문: "<n>-docx.html" — 문단 <p>, 표 <table>(rowspan·colspan 유지), 그림 자리 [그림 k: 파일 경로], 글상자 [글상자] …
//   - 그림: "<n>-img/image-k.png" 등 (Claude 가 읽을 수 있는 PNG·JPG·GIF·WebP 만)
//
// 옛 워드(.doc, OLE 바이너리)는 읽지 않는다 — 이유와 함께 '못 읽음'(convertWord 가 바로 DocxError).
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

export const DOCX_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const DOC_CT = "application/msword";
/** 변환해서 읽는 형식(.doc 은 받아서 이유와 함께 '못 읽음'으로 돌려준다) — API 의 CONVERT_TYPES 와 같다 */
export const WORD_TYPES = { [DOCX_CT]: "docx", [DOC_CT]: "doc" };

const LIMITS = {
  timeoutMs: 60_000,
  heapMb: 512,
  srcBytes: 30 * 1024 * 1024, // 원본(API 는 문서 20MB 까지 받는다)
  entries: 5000, // zip 항목 수
  xmlBytes: 30 * 1024 * 1024, // 풀린 document.xml
  relsBytes: 2 * 1024 * 1024,
  nodes: 2_000_000, // XML 요소 수
  depth: 200, // XML 깊이(표 속 표 …)
  htmlBytes: 400_000, // Claude 에게 넘기는 본문 HTML (넘으면 자르고 경고)
  images: 10,
  imageBytes: 8 * 1024 * 1024,
};
const IMAGE_CT = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

export class DocxError extends Error {}

const DOC_REASON = "옛 워드 형식(.doc)이라 읽을 수 없습니다 — 워드에서 '다른 이름으로 저장'으로 .docx 나 PDF 로 저장해 올려 주세요";

/**
 * src: 임시 폴더 안 원본 파일 이름(예: "2.docx"), dir: 임시 폴더, n: 원본 순번, name: 원래 이름, type: "docx"|"doc"
 * 원본은 변환 뒤 지운다(Claude 가 바이너리를 읽으려 하지 않게).
 */
export async function convertWord({ src, dir, n, name, type = "docx", limits = {} }) {
  const L = { ...LIMITS, ...limits };
  try {
    if (type === "doc") throw new DocxError(DOC_REASON);
    const out = await runChild(src, n, dir, L);
    let r;
    try {
      r = JSON.parse(out);
    } catch {
      throw new DocxError("변환 결과를 읽지 못했습니다");
    }
    if (r.error) throw new DocxError(r.error);
    // 자식이 알려 준 경로는 우리가 정한 이름 모양일 때만 쓴다
    const safe = (p) => typeof p === "string" && (p === `${n}-docx.html` || new RegExp(`^${n}-img/image-\\d{1,3}\\.(png|jpg|gif|webp)$`).test(p));
    if (!safe(r.html)) throw new DocxError("변환 결과 경로가 이상합니다");
    const files = [{ path: r.html, name, content_type: "text/html", converted_from: "docx" }];
    for (const im of r.images ?? []) {
      if (!safe(im.path) || !Object.values(IMAGE_CT).includes(im.ct)) continue;
      files.push({ path: im.path, name: `${name} 안의 그림 ${im.k}`, content_type: im.ct, converted_from: "docx-image" });
    }
    return { files, warnings: (r.warnings ?? []).map((w) => `${name}: ${String(w).slice(0, 300)}`) };
  } finally {
    await rm(`${dir}/${src}`, { force: true });
  }
}

/** 이 파일을 따로 띄운다 — 시간 초과면 프로세스 그룹째 끈다 */
function runChild(src, n, cwd, L) {
  return new Promise((resolve, reject) => {
    const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: cwd, LANG: "C.UTF-8", DOCX_LIMITS: JSON.stringify(L) };
    const p = spawn(process.execPath, [`--max-old-space-size=${L.heapMb}`, fileURLToPath(import.meta.url), "--child", src, String(n)], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let out = "", errOut = "", timedOut = false;
    p.stdout.on("data", (d) => (out = (out + d).slice(-200_000)));
    p.stderr.on("data", (d) => (errOut = (errOut + d).slice(-4000)));
    const t = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-p.pid, "SIGKILL");
      } catch {}
    }, L.timeoutMs);
    p.on("error", (e) => (clearTimeout(t), reject(new DocxError(`변환기를 실행하지 못했습니다: ${e.message}`))));
    p.on("close", (code) => {
      clearTimeout(t);
      if (timedOut) return reject(new DocxError(`변환 시간 초과(${Math.round(L.timeoutMs / 1000)}초)`));
      if (/heap out of memory|Allocation failed/i.test(errOut)) return reject(new DocxError("변환 중 메모리 상한을 넘었습니다"));
      if (code !== 0 && !out.trim()) return reject(new DocxError(`변환하지 못했습니다(종료 코드 ${code}) — 손상된 파일일 수 있습니다. PDF 로 저장해 올려 주세요`));
      resolve(out);
    });
  });
}

// ── 아래는 자식 프로세스에서 돈다 ─────────────────────────────────────────

class Bad extends Error {} // 편집진에게 보일 이유

async function child(src, n) {
  const L = JSON.parse(process.env.DOCX_LIMITS || "{}");
  const buf = await readFile(src);
  if (buf.length > L.srcBytes) throw new Bad(`파일이 너무 큽니다(${Math.round(buf.length / 1024 / 1024)}MB)`);
  if (buf.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])))
    throw new Bad("암호가 걸린 워드 문서이거나 옛 워드 형식(.doc)이라 읽을 수 없습니다 — 암호를 풀고 .docx 나 PDF 로 저장해 올려 주세요");
  const zip = readZip(buf, L);
  const docName = mainDocumentName(zip, L);
  const docXml = zip.text(docName, L.xmlBytes);
  if (docXml == null) throw new Bad("워드 문서의 본문(word/document.xml)이 없습니다 — 손상된 파일이거나 워드 문서가 아닙니다");
  const relsName = docName.replace(/[^/]*$/, (f) => `_rels/${f}.rels`);
  const rels = parseRels(zip.text(relsName, L.relsBytes) ?? "", docName);
  const root = parseXml(docXml, L);
  const body = find(root, "w:body");
  if (!body) throw new Bad("워드 문서의 본문을 찾지 못했습니다");

  const st = { n, zip, rels, L, k: 0, images: [], skipped: [], missing: 0, textboxes: 0, imgDir: false };
  const htmlBody = await blocks(body.c, st);
  let html = `<!-- 워드 문서에서 변환한 내용. 문단은 <p>, 표는 <table>(rowspan·colspan = 합친 칸). 원래 서식·쪽 배치·머리말·각주는 없음 -->\n${htmlBody}\n`;
  const warnings = [];
  if (Buffer.byteLength(html) > L.htmlBytes) {
    html = Buffer.from(html).subarray(0, L.htmlBytes).toString("utf8").replace(/�+$/, "") + "\n<p>[……문서가 너무 길어 여기서 잘랐습니다]</p>\n";
    warnings.push(`문서가 길어 앞부분(${Math.round(L.htmlBytes / 1000)}KB)만 읽었습니다`);
  }
  if (!htmlBody.replace(/<[^>]+>/g, "").replace(/\[[^\]]*\]/g, "").trim() && !st.images.length) throw new Bad("문서에 글자가 없습니다");
  const htmlPath = `${n}-docx.html`;
  await writeFile(htmlPath, html, { mode: 0o600 });
  if (st.missing) warnings.push(`변환기가 읽지 못한 개체 ${st.missing}개(수식·차트·SmartArt·OLE 등)가 있습니다 — 그 안의 글은 빠졌을 수 있으니 원본과 대조해 주세요`);
  if (st.skipped.length) warnings.push(`그림 ${st.skipped.length}개를 넘기지 못했습니다(${[...new Set(st.skipped)].join(", ")}) — 그림 속 글씨는 빠졌습니다`);
  return { html: htmlPath, images: st.images, warnings };
}

// ── zip (중앙 디렉터리만 믿고, 필요한 항목만 푼다) ──
function readZip(buf, L) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Bad("워드 문서(zip)가 아니거나 손상된 파일입니다");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || off === 0xffffffff) throw new Bad("지원하지 않는 zip 형식(ZIP64)입니다");
  if (count > L.entries) throw new Bad(`zip 항목이 너무 많습니다(${count})`);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) throw new Bad("zip 목록이 손상됐습니다");
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const usize = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28), xlen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nlen).toString("utf8");
    entries.set(name, { flags, method, csize, usize, local });
    off += 46 + nlen + xlen + clen;
  }
  const raw = (name, max) => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.flags & 1) throw new Bad("암호가 걸린 zip 항목이 있어 읽을 수 없습니다");
    if (e.usize > max) throw new Bad(`문서 안 항목이 너무 큽니다(${Math.round(e.usize / 1024 / 1024)}MB)`);
    const lo = e.local;
    if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== 0x04034b50) throw new Bad("zip 항목이 손상됐습니다");
    const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    if (start + e.csize > buf.length) throw new Bad("zip 항목이 잘렸습니다");
    const data = buf.subarray(start, start + e.csize);
    if (e.method === 0) return data;
    if (e.method !== 8) throw new Bad(`지원하지 않는 압축 방식(${e.method})입니다`);
    try {
      // 선언 크기를 믿지 않고 풀리는 크기 자체를 묶는다(zip 폭탄)
      return inflateRawSync(data, { maxOutputLength: Math.min(max, Math.max(e.usize, 1)) + 1 });
    } catch (err) {
      if (err?.code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|too large/i.test(err?.message)) throw new Bad("문서 안 항목이 너무 크게 풀립니다(손상 또는 zip 폭탄)");
      throw new Bad("zip 항목을 풀지 못했습니다(손상된 파일)");
    }
  };
  return {
    has: (name) => entries.has(name),
    raw,
    text: (name, max) => raw(name, max)?.toString("utf8") ?? null,
  };
}

/** [Content_Types]·_rels/.rels 에서 본문 위치를 찾는다(대개 word/document.xml) */
function mainDocumentName(zip, L) {
  const rels = zip.text("_rels/.rels", L.relsBytes);
  if (rels) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const t = attr(m[0], "Type"), target = attr(m[0], "Target");
      if (t?.endsWith("/officeDocument") && target) {
        const name = target.replace(/^\/+/, "");
        if (zip.has(name) && /^[\w./-]+\.xml$/.test(name) && !name.includes("..")) return name;
      }
    }
  }
  if (zip.has("word/document.xml")) return "word/document.xml";
  if (zip.has("Contents/section0.xml")) throw new Bad("한글(HWPX) 문서인데 확장자가 .docx 입니다 — 원래 확장자(.hwpx)로 올려 주세요");
  throw new Bad("워드 문서의 본문을 찾지 못했습니다 — 손상된 파일이거나 워드 문서가 아닙니다");
}
const attr = (tag, k) => tag.match(new RegExp(`\\s${k}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`))?.slice(1).find((v) => v != null);

/** rId → zip 안 경로(외부 링크는 뺀다) */
function parseRels(xml, docName) {
  const base = docName.replace(/[^/]*$/, "");
  const map = new Map();
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id"), target = attr(m[0], "Target"), mode = attr(m[0], "TargetMode");
    if (!id || !target || mode === "External") continue;
    const parts = (target.startsWith("/") ? target.slice(1) : base + target).split("/");
    const out = [];
    for (const p of parts) p === ".." ? out.pop() : p && p !== "." && out.push(p);
    map.set(id, out.join("/"));
  }
  return map;
}

// ── 작은 XML 해석기 (DOCX 에 필요한 만큼: 요소·속성·글자·엔티티, 주석·PI·CDATA 건너뜀) ──
function parseXml(xml, L) {
  const root = { t: "#root", a: {}, c: [] };
  const stack = [root];
  let nodes = 0;
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[6] != null) {
      if (top.t === "w:t" || top.t === "m:t") top.c.push(decode(m[6]));
    } else if (m[1] != null) {
      if (top.t === "w:t" || top.t === "m:t") top.c.push(m[1]);
    } else if (m[3]) {
      if (m[2]) {
        // 닫는 태그 — 이름이 맞는 데까지 올라간다(어긋난 XML 도 끝까지)
        for (let i = stack.length - 1; i > 0; i--) if (stack[i].t === m[3]) (stack.length = i);
      } else {
        if (++nodes > L.nodes) throw new Bad("문서 구조가 너무 큽니다");
        const el = { t: m[3], a: attrs(m[4]), c: [] };
        top.c.push(el);
        if (!m[5]) {
          if (stack.length > L.depth) throw new Bad("문서 구조가 너무 깊습니다");
          stack.push(el);
        }
      }
    }
  }
  return root;
}
function attrs(s) {
  const a = {};
  if (s) for (const m of s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) a[m[1]] = decode(m[2] ?? m[3]);
  return a;
}
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    }
    return { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[e.toLowerCase()];
  });
}
function find(el, t) {
  for (const c of el.c) {
    if (typeof c === "string") continue;
    if (c.t === t) return c;
    const f = find(c, t);
    if (f) return f;
  }
  return null;
}
const kids = (el, t) => el.c.filter((c) => typeof c !== "string" && c.t === t);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── 본문 → HTML ──
/** 문단·표가 들어 있는 자리(body·표 칸·글상자) */
async function blocks(list, st) {
  const out = [];
  for (const c of list) {
    if (typeof c === "string") continue;
    if (c.t === "w:p") out.push(await para(c, st));
    else if (c.t === "w:tbl") out.push(await table(c, st));
    else if (c.t === "w:sdt") out.push(await blocks(find(c, "w:sdtContent")?.c ?? [], st));
    else if (c.t === "w:customXml" || c.t === "w:ins" || c.t === "w:smartTag" || c.t === "w:sdtContent") out.push(await blocks(c.c, st));
    else if (c.t === "mc:AlternateContent") out.push(await blocks(altChoice(c)?.c ?? [], st));
    // w:sectPr, w:bookmarkStart, w:del 등은 건너뜀
  }
  return out.filter(Boolean).join("\n");
}
/** mc:AlternateContent — 첫 Choice 만(Fallback 은 같은 내용의 옛 모양) */
const altChoice = (el) => kids(el, "mc:Choice")[0] ?? kids(el, "mc:Fallback")[0];

async function para(p, st) {
  const ctx = { text: [], extra: [] }; // extra: 문단 뒤에 붙일 글상자·그림 줄
  await inline(p.c, st, ctx);
  const text = ctx.text.join("").replace(/[ \t ]+$/gm, "").replace(/^\s+|\s+$/g, "");
  const lines = [];
  if (text) lines.push(`<p>${text}</p>`);
  lines.push(...ctx.extra);
  return lines.join("\n");
}

async function inline(list, st, ctx) {
  for (const c of list) {
    if (typeof c === "string") continue;
    switch (c.t) {
      case "w:t":
        ctx.text.push(esc(c.c.join("")));
        break;
      case "w:tab":
      case "w:ptab":
        ctx.text.push("\t");
        break;
      case "w:br":
      case "w:cr":
        ctx.text.push(c.a["w:type"] === "page" ? " " : "<br>");
        break;
      case "w:noBreakHyphen":
        ctx.text.push("-");
        break;
      case "w:sym":
        if (/^[0-9A-F]{4}$/i.test(c.a["w:char"] ?? "")) {
          const cp = parseInt(c.a["w:char"], 16);
          ctx.text.push(cp >= 0xf000 ? "·" : esc(String.fromCodePoint(cp))); // 기호 글꼴(F0xx)은 모양을 알 수 없다
        }
        break;
      case "w:drawing":
      case "w:pict":
      case "w:object":
        await drawing(c, st, ctx);
        break;
      case "mc:AlternateContent": {
        const ch = altChoice(c);
        if (ch) await inline(ch.c, st, ctx);
        break;
      }
      case "m:oMath":
      case "m:oMathPara":
        ctx.text.push(esc(mathText(c)) || "[수식]");
        break;
      case "w:del":
      case "w:delText":
      case "w:instrText":
      case "w:rPr":
      case "w:pPr":
      case "w:fldData":
        break; // 지운 글(변경 추적)·필드 코드·서식
      default:
        if (c.c.length) await inline(c.c, st, ctx); // w:r, w:hyperlink, w:ins, w:smartTag, w:fldSimple, w:sdt …
    }
  }
}
function mathText(el) {
  return el.c.map((c) => (typeof c === "string" ? "" : c.t === "m:t" ? c.c.map((x) => (typeof x === "string" ? x : "")).join("") : mathText(c))).join("");
}

/** 그림·글상자·OLE */
async function drawing(el, st, ctx) {
  // 글상자: 안의 문단을 [글상자] 로 문단 뒤에
  const boxes = [];
  collect(el, "w:txbxContent", boxes);
  for (const b of boxes) {
    const inner = await blocks(b.c, st);
    if (inner.trim()) {
      st.textboxes++;
      ctx.extra.push(`<p>[글상자]</p>\n${inner}\n<p>[글상자 끝]</p>`);
    }
  }
  // 그림: a:blip r:embed (DrawingML) / v:imagedata r:id (VML)
  const ids = [];
  walk(el, (x) => {
    if (x.t === "a:blip" && x.a["r:embed"]) ids.push(x.a["r:embed"]);
    else if (x.t === "v:imagedata" && x.a["r:id"]) ids.push(x.a["r:id"]);
  });
  for (const id of ids) ctx.extra.push(await image(id, st));
  if (!ids.length && !boxes.length) {
    // 차트·SmartArt·OLE 등 — 안의 글이 있으면 그것만이라도
    const isChart = !!findBy(el, (x) => x.t === "c:chart" || x.t === "dgm:relIds");
    if (isChart || el.t === "w:object") {
      st.missing++;
      ctx.extra.push(`<p>[빠진 개체: ${isChart ? "차트·SmartArt" : "OLE 개체"} — 변환기가 안의 내용을 읽지 못함]</p>`);
    }
  }
}
function collect(el, t, out) {
  for (const c of el.c) {
    if (typeof c === "string") continue;
    if (c.t === "mc:Fallback") continue; // 같은 글상자가 두 번 나오지 않게
    if (c.t === t) out.push(c);
    else collect(c, t, out);
  }
}
function walk(el, fn) {
  for (const c of el.c) {
    if (typeof c === "string" || c.t === "mc:Fallback" || c.t === "w:txbxContent") continue;
    fn(c);
    walk(c, fn);
  }
}
function findBy(el, pred) {
  for (const c of el.c) {
    if (typeof c === "string") continue;
    if (pred(c)) return c;
    const f = findBy(c, pred);
    if (f) return f;
  }
  return null;
}

async function image(id, st) {
  st.k++;
  const k = st.k;
  const skip = (why) => (st.skipped.push(why), `<p>[그림 ${k}: 넘기지 못함 — ${why}]</p>`);
  const target = st.rels.get(id);
  if (!target) return skip("문서 밖 링크이거나 찾을 수 없음");
  const ext = (target.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  const ct = IMAGE_CT[ext];
  if (!ct) return skip(`${ext.toUpperCase() || "알 수 없는"} 형식`);
  if (st.images.length >= st.L.images) return skip(`그림이 ${st.L.images}개를 넘음`);
  let data;
  try {
    data = st.zip.raw(target, st.L.imageBytes);
  } catch {
    return skip("너무 크거나 손상됨");
  }
  if (!data) return skip("문서 안에 없음");
  if (data.length > st.L.imageBytes) return skip("너무 큼");
  if (!st.imgDir) await mkdir(`${st.n}-img`, { mode: 0o700 }), (st.imgDir = true);
  const path = `${st.n}-img/image-${k}.${ext === "jpeg" ? "jpg" : ext}`;
  await writeFile(path, data, { mode: 0o600 });
  st.images.push({ path, ct, k });
  return `<p>[그림 ${k}: 같이 넘긴 파일 ${path} — 이 자리에 있던 그림]</p>`;
}

/** 표 — w:gridSpan → colspan, w:vMerge(restart/continue) → rowspan */
async function table(tbl, st) {
  const rows = [];
  for (const tr of within(tbl, "w:tr")) {
    const cells = [];
    let col = 0;
    const before = Number(find(tr, "w:gridBefore")?.a["w:val"]) || 0;
    col += before;
    for (const tc of within(tr, "w:tc")) {
      const pr = kids(tc, "w:tcPr")[0];
      const span = Math.max(1, Math.min(64, Number(pr && kids(pr, "w:gridSpan")[0]?.a["w:val"]) || 1));
      const vm = pr && kids(pr, "w:vMerge")[0];
      const merge = vm ? (vm.a["w:val"] === "restart" ? "restart" : "continue") : null;
      cells.push({ col, span, merge, html: merge === "continue" ? "" : await blocks(tc.c, st), rowspan: 1 });
      col += span;
    }
    rows.push(cells);
  }
  // 이어지는 칸(continue)을 위 칸의 rowspan 으로
  for (let r = 1; r < rows.length; r++) {
    for (const cell of rows[r]) {
      if (cell.merge !== "continue") continue;
      for (let u = r - 1; u >= 0; u--) {
        const up = rows[u].find((x) => x.col === cell.col && !x.dropped);
        if (up) {
          up.rowspan++;
          break;
        }
      }
      cell.dropped = true;
    }
  }
  const out = ["<table>"];
  for (const cells of rows) {
    out.push("<tr>");
    for (const c of cells) {
      if (c.dropped) continue;
      const a = (c.span > 1 ? ` colspan="${c.span}"` : "") + (c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : "");
      out.push(`<td${a}>${c.html.includes("\n") ? `\n${c.html}\n` : c.html.replace(/^<p>([\s\S]*)<\/p>$/, "$1")}</td>`);
    }
    out.push("</tr>");
  }
  out.push("</table>");
  return out.join("\n");
}
/** 표 안의 행·행 안의 칸 — 내용 컨트롤(w:sdt)·w:customXml 로 싸인 것도 순서대로 */
function within(el, t) {
  const out = [];
  for (const c of el.c) {
    if (typeof c === "string") continue;
    if (c.t === t) out.push(c);
    else if (c.t === "w:sdt" || c.t === "w:customXml" || c.t === "w:sdtContent") out.push(...within(c, t));
  }
  return out;
}

if (process.argv[2] === "--child" && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [src, n] = process.argv.slice(3);
  // 자식은 고정 이름만 다룬다
  if (!/^\d{1,2}\.docx$/.test(src ?? "") || !/^\d{1,2}$/.test(n ?? "")) process.exit(2);
  child(src, Number(n)).then(
    (r) => process.stdout.write(JSON.stringify(r)),
    (e) => {
      process.stdout.write(JSON.stringify({ error: e instanceof Bad ? e.message : `변환하지 못했습니다(${String(e?.message ?? e).slice(0, 80)}) — 손상된 파일일 수 있습니다. PDF 로 저장해 올려 주세요` }));
    }
  );
}
