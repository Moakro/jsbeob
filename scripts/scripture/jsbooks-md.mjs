// jsbooks 형식 경전 마크다운 읽기 — import-scripture.mjs(마크다운 → DB)와
// library-export-scripture.mjs(DB → 마크다운, 되읽기 검사)가 함께 쓴다.

export function parseFront(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  const data = {};
  if (m) {
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^([^:]+):\s*(.*)$/);
      if (!kv) continue;
      const v = kv[2].trim();
      const k = kv[1].trim();
      data[k] = k === "meta" && v.startsWith("{") ? JSON.parse(v) : /^\d+$/.test(v) ? Number(v) : v;
    }
  }
  return { data, body: m ? src.slice(m[0].length) : src };
}

/** 본문 → 블록. 절 머리가 없으면 문단마다 `${fallback}-N` 위치 */
export function toBlocks(body, fallback) {
  const lines = body.replace(/\r\n/g, "\n").replace(/^#\s.*$/m, "").split("\n");
  const blocks = [];
  let cur = null;
  let buf = [];
  let seq = 0;
  let noAnchor = 0;
  const flush = () => {
    const joined = buf.join(" ").trim();
    buf = [];
    if (!joined) return;
    const m = joined.match(/\s*\^([\w-]+)\s*$/);
    let a = m ? m[1] : "";
    const t = m ? joined.slice(0, m.index).trim() : joined;
    if (!a && fallback) a = `${fallback}-${++seq}`;
    if (!a) noAnchor++;
    if (!cur) {
      cur = { type: "verse", lines: [] };
      blocks.push(cur);
    }
    cur.lines.push({ a, t });
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const head = line.match(/^(#{2,6})\s+(.+?)\s*$/);
    if (head) {
      flush();
      const label = head[2].replace(/\s*\^[\w-]+\s*$/, "").trim();
      if (head[1] === "##" && !fallback) {
        cur = { type: "verse", label, lines: [] };
        blocks.push(cur);
      } else {
        blocks.push({ type: "heading", text: label });
        cur = null;
      }
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    buf.push(line.trim());
  }
  flush();
  // 절 블록 id 는 첫 문장 위치로 고정(관련링크·이미지 참조가 블록 id 를 가리킬 때 안정적)
  const used = new Set();
  for (const b of blocks) {
    if (b.type !== "verse" || !b.lines[0]?.a) continue;
    let id = `v-${b.lines[0].a}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 22);
    if (id.length < 6) id = id.padEnd(6, "0");
    if (!used.has(id)) {
      b.id = id;
      used.add(id);
    }
  }
  return { blocks: blocks.filter((b) => b.type !== "verse" || b.lines.length), noAnchor };
}
