// 날짜 표기 공용 규칙 — 사이트(src/)와 API(jsbeob-api/blocks.ts)가 함께 쓴다 (2026-11-27)
//   하루:  2026.12.01(화)
//   기간:  2026.12.04(금) ~ 12.13(일)   해가 바뀌면 끝에도 연도: 2026.12.30(수) ~ 2027.01.02(토)

export const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

/** "YYYY-MM-DD…" → "2026.12.01(화)" (withYear=false 면 "12.01(화)") */
export function ymdWeekday(d: string, withYear = true) {
  const [y, m, dd] = d.slice(0, 10).split("-");
  const w = WEEKDAY_KO[new Date(Date.UTC(+y, +m - 1, +dd)).getUTCDay()];
  return `${withYear ? `${y}.` : ""}${m}.${dd}(${w})`;
}

/** 일정 기간 → "2026.12.04(금) ~ 12.13(일)". 끝이 없거나 시작과 같으면 하루만 */
export function periodText(p: { start: string; end?: string | null }) {
  const start = ymdWeekday(p.start);
  if (!p.end || p.end.slice(0, 10) === p.start.slice(0, 10)) return start;
  return `${start} ~ ${ymdWeekday(p.end, p.end.slice(0, 4) !== p.start.slice(0, 4))}`;
}

/** 시각(ISO, UTC) → 한국 날짜 "2026.11.27(금)" */
export function kstDateText(iso: string) {
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso.replace(" ", "T")}Z`;
  const k = new Date(new Date(s).getTime() + 9 * 3600e3);
  return ymdWeekday(k.toISOString());
}
