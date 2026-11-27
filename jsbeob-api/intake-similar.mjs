// 올림함 중복 경고 — 일정 이름 글자 겹침 비교 (2026-11-27, docs/design/ai-intake.md 7장 '같은 행사 중복 감지' ②)
// intake.ts(서버)와 scripts/test-intake.mjs(시험)가 같이 쓴다 — 그래서 .mjs.
/** 비교 전에 빼는 흔한 말 — 이것만 겹쳐서는 '비슷하다'고 보지 않는다 */
const TITLE_STOPWORDS = ["안내", "개최", "행사", "일정", "알림", "공지", "참석", "요청", "모임", "계획", "증산법종교", "법종교"];
/** 제목 비교용으로 다듬기 — 숫자(연도·회차)·띄어쓰기·문장부호·흔한 말을 뺀다 */
export function titleKey(t) {
  let s = String(t ?? "").toLowerCase().replace(/제?\d+(회|차|년|월|일)?/g, "");
  for (const w of TITLE_STOPWORDS) s = s.split(w).join("");
  return s.replace(/[^\p{L}]/gu, "");
}
/** 글자 겹침 비교(처음 방식, 설계 7장) — 한쪽이 다른 쪽을 품으면 1, 아니면 두 글자 묶음의 Dice 계수 */
export function titleSimilarity(a, b) {
  const x = titleKey(a), y = titleKey(b);
  if (x.length < 2 || y.length < 2) return 0;
  if (x.includes(y) || y.includes(x)) return 1;
  const grams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const gx = grams(x), gy = grams(y);
  let both = 0;
  for (const [g, n] of gx) both += Math.min(n, gy.get(g) ?? 0);
  return (2 * both) / (x.length - 1 + (y.length - 1));
}
