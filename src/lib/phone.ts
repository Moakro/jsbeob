// 전화번호 표시 — DB 에는 숫자만 저장하고(지부·분원 등) 보여 줄 때 하이픈을 넣는다.
/** "0212345678" → "02-1234-5678", "01012345678" → "010-1234-5678", "15881234" → "1588-1234" */
export function formatPhone(digits: string | null | undefined): string {
  const d = (digits ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 8 && /^1[5-9]/.test(d)) return `${d.slice(0, 4)}-${d.slice(4)}`;
  if (d.startsWith("02")) {
    if (d.length === 9) return `02-${d.slice(2, 5)}-${d.slice(5)}`;
    if (d.length === 10) return `02-${d.slice(2, 6)}-${d.slice(6)}`;
  }
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  return d;
}

/** tel: 링크용 */
export const telHref = (digits: string | null | undefined) => `tel:${(digits ?? "").replace(/\D/g, "")}`;
