// 옛 홈페이지(jsbeob.com, dothome) 주소 → 새 사이트 주소 (2026-11-21, 공식 도메인 이전).
// 검색 결과·카톡에 공유된 옛 링크가 끊기지 않게 src/middleware.ts 가 301 로 넘긴다.
// 옛 주소 체계(2026-11-21 옛 사이트에서 수집):
//   /_ort/ /_notice/ /_study/ /_servant/   게시판 목록 (?seCate=분류, ?cId=글번호)
//   /_jsbeob/?sePage=페이지이름             교단 소개
//   /_jeongac/?sePage=전각이름              전각
//   /bbs/board.php|write.php?bo_table=…     그누보드 게시판
// 옛 글은 보관함(legacy_posts)에 같은 번호(cid)로 옮겨 두었다 — /legacy/<board>/<cid>/
// 도움방(servant)은 옮기지 않았다 — 같은 역할인 문의 게시판으로 보낸다.

/** 보관함으로 옮긴 옛 게시판 */
const LEGACY = new Set(["ort", "study", "notice"]);

/** 옛 소개 페이지 이름 → 새 소개 글 주소 이름 */
const ABOUT: Record<string, string> = {
  증산상제님: "jeungsan-sangje",
  정씨대모님: "jeongssi-daemo",
  "화은당 선사님": "hwaeundang",
  "구암 정사님": "guam",
  "법종교 연혁": "history",
  "법종교 조직표": "organization",
  "전국지부/지회": "branches",
  "찾아오시는 길": "directions",
  "교기/교지/교리": "doctrine",
  증산법종교가: "anthem",
};

/** 옛 전각 페이지 이름 → 새 전각 주소 이름 ('전각 개요'는 전각 목록으로) */
const JEONGAK: Record<string, string> = {
  영대: "yeongdae",
  삼청전: "samcheongjeon",
  천하전: "cheonhajeon",
  태평전: "taepyeongjeon",
  대령전: "daeryeongjeon",
  만고종각: "mangojonggak",
  숭도묘: "sungdomyo",
  성신사: "seongsinsa",
  경춘대: "gyeongchundae",
  구룡사: "guryongsa",
  호국사: "hoguksa",
  화은당: "hwaeundang",
};

const norm = (s: string | null) => (s ?? "").replace(/\+/g, " ").trim();

/**
 * 옛 주소면 새 주소(경로+쿼리)를, 아니면 null 을 돌려준다.
 * 옛 사이트에는 '/_ort/&cId=1' 처럼 ? 대신 & 로 붙은 링크도 있어 함께 받는다.
 */
export function oldUrlTarget(url: URL): string | null {
  const path = url.pathname;
  if (path === "/index.php") return "/";

  // 그누보드 게시판 — 글 번호 체계가 달라 게시판 목록으로
  const bbs = /^\/bbs\/(?:board|write)\.php$/.exec(path);
  if (bbs) {
    const t = url.searchParams.get("bo_table") ?? "";
    if (t === "servant") return "/community/help/";
    return LEGACY.has(t) ? `/legacy/?board=${t}` : "/legacy/";
  }

  const m = /^\/_([a-zA-Z]+)\/?(?:&(.*))?$/.exec(path);
  if (!m) return null;
  const mod = m[1];
  // '/_ort/&cId=1&seCate=…' 의 & 뒤도 쿼리로 읽는다
  const sp = new URLSearchParams(url.search);
  if (m[2]) for (const [k, v] of new URLSearchParams(m[2])) if (!sp.has(k)) sp.set(k, v);
  const cid = /^\d+$/.test(sp.get("cId") ?? "") ? sp.get("cId") : null;
  const cate = norm(sp.get("seCate"));
  const page = norm(sp.get("sePage"));

  if (LEGACY.has(mod)) {
    if (cid) return `/legacy/${mod}/${cid}/`;
    return cate ? `/legacy/?category=${encodeURIComponent(cate)}` : `/legacy/?board=${mod}`;
  }
  if (mod === "servant") return "/community/help/";
  if (mod === "jsbeob") return ABOUT[page] ? `/about/${ABOUT[page]}/` : "/about/";
  if (mod === "jeongac") return JEONGAK[page] ? `/jeongak/${JEONGAK[page]}/` : "/jeongak/";
  // 그 밖의 옛 모듈(_fullScreen 등)은 홈으로
  return "/";
}
