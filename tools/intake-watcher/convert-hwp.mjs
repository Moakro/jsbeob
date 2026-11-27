// 한글 문서(HWP 5.0·HWPX) → Claude 가 Read 로 읽을 수 있는 HTML + 그림 파일 (2026-11-27)
//
// 변환기: @ohah/hwpjs (MIT, WASM 엔진 — 한글 프로그램 불필요, 네트워크 안 씀)
// 받은 파일은 신뢰할 수 없는 입력이므로
//   - 감시 서비스와 다른 프로세스(node + hwpjs CLI)에서 돌리고, 시간 제한·메모리 상한(--max-old-space-size)을 건다
//   - 그 건의 임시 폴더 안에서만 읽고 쓴다(cwd = 임시 폴더, 출력도 그 안)
//   - 결과 HTML 크기·그림 수·그림 크기에 상한을 둔다
//   - 실패하면 HangulError(사유) — 감시 서비스는 그 파일만 '못 읽음' 경고로 남기고 나머지로 계속한다
//
// 결과: { files:[{path, name, content_type, converted_from?}], warnings:[string] }
//   - 본문: "<n>-hangul.html" — 문단은 <p>, 표는 <table>(rowspan·colspan 유지), 그림 자리는 [그림 k: 파일 경로]
//   - 그림: "<n>-img/image-0001.png" 등 (Claude 가 읽을 수 있는 PNG·JPG·GIF·WebP 만)
//   - warnings: 변환에서 빠진 것(읽지 못한 개체, 위치를 모르는 글, 넘기지 못한 그림)
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** 변환해서 읽는 형식 — API 의 CONVERT_TYPES 와 같다(claim 때 accept 로 알린다) */
export const HANGUL_TYPES = { "application/x-hwp": "hwp", "application/hwp+zip": "hwpx" };

const LIMITS = {
  timeoutMs: 60_000, // 명령 하나(HTML 만들기·그림 꺼내기 각각)
  heapMb: 1024, // 변환 프로세스 메모리 상한
  htmlBytes: 400_000, // Claude 에게 넘기는 본문 HTML (넘으면 자르고 경고)
  rawHtmlBytes: 20 * 1024 * 1024, // 변환기가 만든 HTML 원본(이보다 크면 실패)
  images: 10, // 문서 하나에서 넘기는 그림 수
  imageBytes: 8 * 1024 * 1024, // 그림 하나
};
const IMAGE_CT = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

export class HangulError extends Error {}

/** hwpjs 오류 코드 → 편집진에게 보일 이유 */
const REASONS = {
  UnsupportedDistribution: "배포용 문서라 내용을 꺼낼 수 없습니다 — 한글에서 PDF 로 저장해 올려 주세요",
  UnsupportedEncryption: "암호가 걸린 문서라 읽을 수 없습니다 — 암호를 풀거나 PDF 로 저장해 올려 주세요",
  EncryptedDocument: "암호가 걸린 문서라 읽을 수 없습니다 — 암호를 풀거나 PDF 로 저장해 올려 주세요",
};

let cliPath;
function hwpjsCli() {
  if (!cliPath) {
    const pkg = createRequire(import.meta.url).resolve("@ohah/hwpjs/package.json");
    cliPath = join(dirname(pkg), "dist", "hwpjs.mjs");
  }
  return cliPath;
}

/**
 * src: 임시 폴더 안 원본 파일 이름(예: "2.hwp"), dir: 임시 폴더, n: 원본 순번, name: 원래 이름
 * 원본은 변환 뒤 지운다(Claude 가 바이너리를 읽으려 하지 않게).
 */
export async function convertHangul({ src, dir, n, name, limits = {} }) {
  const L = { ...LIMITS, ...limits };
  const htmlRaw = `${n}-hangul.raw.html`;
  const imgDir = `${n}-img`;
  try {
    await hwpjs(["export-html", src, "--output", htmlRaw, "--embed-images", "none"], dir, L);
    const st = await stat(join(dir, htmlRaw));
    if (st.size > L.rawHtmlBytes) throw new HangulError(`변환 결과가 너무 큽니다(${Math.round(st.size / 1024 / 1024)}MB)`);
    const raw = await readFile(join(dir, htmlRaw), "utf8");

    // 그림: 본문에 그림 자리가 있을 때만 꺼낸다
    let images = new Map(); // "hwp5/s0/image/10" → {path, ct} | {skip: 이유}
    const warnings = [];
    if (/class="image"/.test(raw)) {
      try {
        const out = await hwpjs(["extract-images", src, "--output", imgDir], dir, L);
        images = await pickImages(out, dir, L);
      } catch (e) {
        warnings.push(`${name}: 문서 안 그림을 꺼내지 못했습니다(${e.message.slice(0, 80)}) — 그림 속 글씨는 빠졌습니다`);
      }
    }

    const r = cleanHtml(raw, images, name);
    let html = r.html;
    if (Buffer.byteLength(html) > L.htmlBytes) {
      html = Buffer.from(html).subarray(0, L.htmlBytes).toString("utf8").replace(/�+$/, "") + "\n<p>[……문서가 너무 길어 여기서 잘랐습니다]</p>";
      warnings.push(`${name}: 문서가 길어 앞부분(${Math.round(L.htmlBytes / 1000)}KB)만 읽었습니다`);
    }
    const path = `${n}-hangul.html`;
    await writeFile(join(dir, path), html, { mode: 0o600 });

    if (r.unavailable) warnings.push(`${name}: 변환기가 읽지 못한 개체 ${r.unavailable}개(글상자·도형·수식 등)가 있습니다 — 그 안의 글은 빠졌을 수 있으니 원본과 대조해 주세요`);
    if (r.unplaced) warnings.push(`${name}: 위치를 확인하지 못한 글(글상자·캡션 등)이 문서 끝에 따로 모여 있습니다 — 순서가 원본과 다를 수 있습니다`);
    if (r.skippedImages.length) warnings.push(`${name}: 그림 ${r.skippedImages.length}개를 넘기지 못했습니다(${[...new Set(r.skippedImages)].join(", ")}) — 그림 속 글씨는 빠졌습니다`);

    const files = [{ path, name, content_type: "text/html", converted_from: HANGUL_TYPES_BY_EXT[src.split(".").pop()] ?? "hwp" }];
    for (const im of r.usedImages) files.push({ path: im.path, name: `${name} 안의 그림 ${im.k}`, content_type: im.ct, converted_from: "hwp-image" });
    return { files, warnings };
  } finally {
    await rm(join(dir, src), { force: true });
    await rm(join(dir, htmlRaw), { force: true });
  }
}
const HANGUL_TYPES_BY_EXT = { hwp: "hwp", hwpx: "hwpx" };

/** extract-images 출력("publishedImages.0.id: hwp5:s0:i10" / ".path: …") → 쓸 그림 고르기 */
async function pickImages(out, dir, L) {
  const rows = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^publishedImages\.(\d+)\.(id|path|bytes|published):\s*(.*)$/);
    if (m) (rows[m[1]] ??= {})[m[2]] = m[3].trim();
  }
  const map = new Map();
  let used = 0;
  for (const r of Object.values(rows)) {
    const m = r.id?.match(/^(hwp5|hwpx):s(\d+):i(\d+)$/);
    if (!m || r.published !== "true" || !r.path) continue;
    const key = `${m[1]}/s${m[2]}/image/${m[3]}`;
    // 변환기가 알려 준 경로가 임시 폴더 안인지 확인
    if (!r.path.startsWith(dir + "/")) continue;
    const rel = r.path.slice(dir.length + 1);
    const ext = (rel.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
    const ct = IMAGE_CT[ext];
    if (!ct) map.set(key, { skip: `${ext.slice(1).toUpperCase() || "알 수 없는"} 형식` });
    else if (Number(r.bytes) > L.imageBytes) map.set(key, { skip: "너무 큼" });
    else if (used >= L.images) map.set(key, { skip: `그림이 ${L.images}개를 넘음` });
    else (map.set(key, { path: rel, ct }), used++);
  }
  return map;
}

/**
 * 변환기 HTML → Claude 에게 넘길 간단한 HTML.
 * 머리(head·style)와 변환기 안내 문구를 빼고, 그림 자리는 그림 파일 경로로, 읽지 못한 개체는 [빠진 개체] 표시로 바꾼다.
 */
export function cleanHtml(raw, images = new Map(), name = "") {
  let body = raw.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? raw;
  const usedImages = [];
  const skippedImages = [];
  let k = 0;
  // 그림
  body = body.replace(/<figure class="image"[^>]*data-ref="[^"]*\/((?:hwp5|hwpx)\/s\d+\/image\/\d+)"[^>]*>[\s\S]*?<\/figure>/g, (_, key) => {
    k++;
    const im = images.get(key);
    if (im?.path) {
      usedImages.push({ ...im, k });
      return `<p>[그림 ${k}: 같이 넘긴 파일 ${im.path} — 이 자리에 있던 그림]</p>`;
    }
    skippedImages.push(im?.skip ?? "꺼내지 못함");
    return `<p>[그림 ${k}: 넘기지 못함${im?.skip ? ` — ${im.skip}` : ""}]</p>`;
  });
  // 읽지 못한 개체(글상자·도형·수식·OLE 등)
  let unavailable = 0;
  body = body.replace(/<figure class="object-unavailable"[^>]*data-kind="([^"]*)"[^>]*>[\s\S]*?<\/figure>/g, (_, kind) => {
    unavailable++;
    return `<p>[빠진 개체: ${KIND_KO[kind] ?? kind} — 변환기가 안의 내용을 읽지 못함]</p>`;
  });
  // 위치를 모르는 글
  const unplaced = (body.match(/<section class="unplaced"/g) ?? []).length;
  body = body.replace(/<section class="unplaced"[^>]*>/g, '<section>\n<p>[아래는 원래 위치를 확인하지 못한 글(글상자·캡션 등) — 본문 어딘가에 있던 내용]</p>');
  // 변환기 안내 문구(머리말 상속·개체 재고 등 — 내용과 무관)와 진단 코드
  body = body
    .replace(/<p class="(?:unobserved|diagnostic)">[\s\S]*?<\/p>/g, "")
    .replace(/<caption data-caption-origin="generated-label">[^<]*<\/caption>/g, "")
    .replace(/ data-[a-z-]+="[^"]*"/g, "")
    .replace(/ class="[^"]*"/g, "")
    .replace(/<(header|footer)>\s*<\/\1>/g, "")
    .replace(/￼/g, "") // 개체 자리 표시 글자
    .replace(/<p>\s*<\/p>/g, "")
    .replace(/<\/(p|tr|table|section|div)>(?!\n)/g, "</$1>\n")
    .replace(/<(table|tbody|tr|section|div|article)>(?!\n)/g, "<$1>\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  const html = `<!-- 한글 문서(${String(name).replace(/-->|[<>]/g, "")})에서 변환한 내용. 문단은 <p>, 표는 <table>(rowspan·colspan = 합친 칸). 원래 서식·쪽 배치는 없음 -->\n${body}\n`;
  return { html, usedImages, skippedImages, unavailable, unplaced };
}
const KIND_KO = { drawing: "도형·글상자", equation: "수식", chart: "차트", ole: "OLE 개체", form: "양식 개체", object: "개체" };

/** hwpjs CLI 를 따로 띄운다 — 시간 초과면 프로세스 그룹째 끈다 */
function hwpjs(args, cwd, L) {
  return new Promise((resolve, reject) => {
    const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: cwd, LANG: "C.UTF-8" };
    const p = spawn(process.execPath, [`--max-old-space-size=${L.heapMb}`, hwpjsCli(), ...args], {
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
    p.on("error", (e) => (clearTimeout(t), reject(new HangulError(`변환기를 실행하지 못했습니다: ${e.message}`))));
    p.on("close", (code) => {
      clearTimeout(t);
      if (timedOut) return reject(new HangulError(`변환 시간 초과(${Math.round(L.timeoutMs / 1000)}초)`));
      if (code === 0) return resolve(out);
      const codeName = (errOut + "\n" + out).match(/error:\s*([A-Za-z0-9_:]+)/)?.[1];
      const reason = codeName && (REASONS[codeName] ?? (/^UnsupportedDistribution/.test(codeName) ? REASONS.UnsupportedDistribution : /Encrypt/.test(codeName) ? REASONS.EncryptedDocument : null));
      if (reason) return reject(new HangulError(reason));
      if (/heap out of memory|Allocation failed/i.test(errOut)) return reject(new HangulError("변환 중 메모리 상한을 넘었습니다"));
      reject(new HangulError(`변환하지 못했습니다(${codeName ?? `종료 코드 ${code}`}) — 손상된 파일일 수 있습니다. PDF 로 저장해 올려 주세요`));
    });
  });
}
