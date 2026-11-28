// 올린 사진의 메타데이터(EXIF — 찍은 위치 GPS·기기·시각, XMP, 글 조각) 지우기 (2026-11-28)
// 사이트 화면은 사진을 브라우저 canvas 로 다시 저장(WebP)해서 올리므로 EXIF 가 이미 없다(실제 파일로 확인).
// 다른 경로(앱·직접 호출)로 원본 JPG·PNG·WebP 가 와도 위치가 남지 않게 서버에서 한 번 더 지운다.
// 픽셀은 건드리지 않고 메타데이터 덩어리만 뺀다. 형식을 못 읽으면 원본 그대로 돌려준다.

/** JPEG — APP1(Exif·XMP)·APP13(IPTC)·COM(주석) 세그먼트를 뺀다. ICC(APP2)는 색 때문에 둔다. */
function stripJpeg(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const out = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++; // 채움 바이트
      continue;
    }
    if (marker === 0xda) {
      out.push(b.subarray(i)); // 영상 데이터 시작 — 나머지는 그대로
      return concat(out);
    }
    if (marker === 0xd9) break;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return null;
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!drop) out.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return null;
}

const tag4 = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

/** WebP — EXIF·XMP 청크를 빼고 VP8X 플래그와 RIFF 크기를 맞춘다. */
function stripWebp(b) {
  if (b.length < 12 || tag4(b, 0) !== "RIFF" || tag4(b, 8) !== "WEBP") return null;
  const out = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const id = tag4(b, i);
    const size = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24);
    const end = i + 8 + size + (size & 1);
    if (size < 0 || end > b.length + 1) return null;
    if (id !== "EXIF" && id !== "XMP ") {
      const chunk = b.slice(i, Math.min(end, b.length));
      if (id === "VP8X" && chunk.length > 8) chunk[8] &= ~(0x08 | 0x04); // EXIF·XMP 있음 표시 끄기
      out.push(chunk);
    }
    i = end;
  }
  const body = concat(out);
  const res = new Uint8Array(12 + body.length);
  res.set(b.subarray(0, 12));
  const riff = 4 + body.length;
  res[4] = riff & 0xff;
  res[5] = (riff >> 8) & 0xff;
  res[6] = (riff >> 16) & 0xff;
  res[7] = (riff >>> 24) & 0xff;
  res.set(body, 12);
  return res;
}

/** PNG — eXIf·tEXt·zTXt·iTXt 청크를 뺀다. */
function stripPng(b) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 8 || sig.some((v, k) => b[k] !== v)) return null;
  const out = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const id = tag4(b, i + 4);
    const end = i + 12 + len;
    if (end > b.length) return null;
    if (!["eXIf", "tEXt", "zTXt", "iTXt"].includes(id)) out.push(b.subarray(i, end));
    i = end;
    if (id === "IEND") return concat(out);
  }
  return null;
}

function concat(parts) {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** content type 에 맞춰 메타데이터를 지운 바이트 — 못 읽으면 원본 */
export function stripImageMeta(buf, contentType) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  try {
    const r =
      contentType === "image/jpeg" ? stripJpeg(b) : contentType === "image/webp" ? stripWebp(b) : contentType === "image/png" ? stripPng(b) : null;
    return r ?? b;
  } catch {
    return b;
  }
}
