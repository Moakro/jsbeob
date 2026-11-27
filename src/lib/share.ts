// 글 공유 — 휴대폰(터치)은 Web Share API(카카오톡 등 공유 시트), 그 밖(데스크톱)은 주소 복사 (2026-11-27)
// 오리알터 카드·소식 팝업이 함께 쓴다.

export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

/** 공유 시트를 쓸 기기인가 — 데스크톱 브라우저도 navigator.share 가 있지만 거기서는 복사가 낫다 */
const useSheet = () =>
  typeof navigator !== "undefined" &&
  typeof navigator.share === "function" &&
  matchMedia("(pointer: coarse)").matches;

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // http(보안 연결 아님) 등에서 clipboard 가 막히면 옛 방식으로
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {}
    ta.remove();
    return ok;
  }
}

export async function shareLink(opts: { url: string; title: string; text?: string }): Promise<ShareResult> {
  const url = new URL(opts.url, location.origin).href;
  if (useSheet()) {
    try {
      await navigator.share({ title: opts.title, text: opts.text, url });
      return "shared";
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return "cancelled";
      // 공유 시트가 실패하면 복사로
    }
  }
  return (await copyText(url)) ? "copied" : "failed";
}
