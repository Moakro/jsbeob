/**
 * 화은당실기 등 sentence-anchor 경전 본문 렌더러 (jsbeob Phase 1).
 *
 * 본문 형식:
 *   # 제N장 제목            ← 프론트매터로 대체하므로 렌더에서 제외
 *   ## N절
 *   문장 ... ^권-장-절       ← 문장 끝 anchor
 *
 * [[대상]] / [[대상|별칭]] 위키링크는 현재 카드 시스템이 없으므로
 * 별칭(또는 대상) 텍스트로만 표시한다. (카드 도입 시 링크로 승격 예정)
 */

export interface ParsedVerse {
  /** 절 번호 라벨 (예: "1절", "서문"). */
  label: string;
  /** anchor id (예: "1-1-1") — 없으면 null. */
  anchor: string | null;
  /** 렌더된 문단 HTML 배열. */
  paragraphs: string[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** [[a|b]] → b, [[a]] → a (위키링크를 텍스트로). */
function stripWikilinks(s: string): string {
  return s.replace(/\[\[([^\]]+)\]\]/g, (_, inner: string) => {
    const alias = inner.includes("|") ? inner.split("|").pop()! : inner;
    return `<span class="wikiref">${escapeHtml(alias.trim())}</span>`;
  });
}

/** 한 문장/문단 줄을 HTML로. 끝의 ^anchor 토큰은 제거. */
function renderLine(line: string): { html: string; anchor: string | null } {
  const m = line.match(/\s*\^([\w-]+)\s*$/);
  const anchor = m ? m[1] : null;
  const text = m ? line.slice(0, m.index) : line;
  return { html: stripWikilinks(escapeHtml(text.trim())), anchor };
}

/**
 * 장(章) 본문 markdown을 절 배열로 파싱.
 * 서문/부록(절 헤더 없는 본문)은 전체를 단일 블록으로 반환.
 */
export function parseChapter(body: string): ParsedVerse[] {
  // 최상위 제목(# ...) 줄 제거
  const lines = body.replace(/^#\s.*$/m, "").split("\n");
  const verses: ParsedVerse[] = [];
  let current: ParsedVerse | null = null;
  let buffer: string[] = [];

  const flushParagraph = () => {
    const joined = buffer.join(" ").trim();
    buffer = [];
    if (!joined || !current) return;
    const { html, anchor } = renderLine(joined);
    if (anchor && !current.anchor) current.anchor = anchor;
    if (html) current.paragraphs.push(html);
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const head = line.match(/^##\s+(.+?)\s*$/);
    if (head) {
      flushParagraph();
      // 절 헤더의 뒤따르는 ^anchor 도 흡수
      const { anchor } = renderLine(head[1]);
      const label = head[1].replace(/\s*\^[\w-]+\s*$/, "").trim();
      current = { label, anchor, paragraphs: [] };
      verses.push(current);
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    buffer.push(line);
  }
  flushParagraph();

  // 절 헤더가 전혀 없는 본문(서문/부록): 단일 블록으로
  if (verses.length === 0) {
    const block: ParsedVerse = { label: "", anchor: null, paragraphs: [] };
    for (const raw of body.replace(/^#\s.*$/m, "").split(/\n\s*\n/)) {
      const t = raw.trim();
      if (!t) continue;
      const { html } = renderLine(t.replace(/\n/g, " "));
      if (html) block.paragraphs.push(html);
    }
    return block.paragraphs.length ? [block] : [];
  }
  return verses;
}
