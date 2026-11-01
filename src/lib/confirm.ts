// 사이트 공용 확인 대화상자(<dialog>) — window.confirm 대신 쓴다.
// 복원(2026-11-01): 배포본 _astro/confirm.*.js 기준(export 이름이 원본 그대로 남아 있음).

let seq = 0;

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: "default" | "danger";
}

/** 확인 대화상자를 띄우고 확인=true / 취소·바깥 클릭=false 로 끝난다. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const { title, message, confirmText = "확인", cancelText = "취소", tone = "default" } = opts;
  if (typeof document === "undefined") return Promise.resolve(false);
  const dialog = document.createElement("dialog");
  // <dialog> 미지원 브라우저는 기본 confirm 으로
  if (typeof dialog.showModal !== "function")
    return Promise.resolve(window.confirm(title ? `${title}\n\n${message}` : message));

  const id = `site-confirm-${++seq}`;
  dialog.className = `site-confirm${tone === "danger" ? " is-danger" : ""}`;
  dialog.setAttribute("aria-describedby", `${id}-msg`);
  if (title) dialog.setAttribute("aria-labelledby", `${id}-title`);

  const body = document.createElement("div");
  body.className = "site-confirm__body";
  if (title) {
    const h = document.createElement("h2");
    h.className = "site-confirm__title";
    h.id = `${id}-title`;
    h.textContent = title;
    body.append(h);
  }
  const msg = document.createElement("p");
  msg.className = "site-confirm__msg";
  msg.id = `${id}-msg`;
  msg.textContent = message;
  body.append(msg);

  const actions = document.createElement("div");
  actions.className = "site-confirm__actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn btn-ghost";
  cancel.textContent = cancelText;
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "btn btn-primary";
  ok.textContent = confirmText;
  actions.append(cancel, ok);
  dialog.append(body, actions);
  document.body.append(dialog);

  const prevFocus = document.activeElement as HTMLElement | null;
  return new Promise((resolve) => {
    let result = false;
    const finish = (v: boolean) => {
      result = v;
      dialog.close();
    };
    ok.addEventListener("click", () => finish(true));
    cancel.addEventListener("click", () => finish(false));
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) finish(false); // 바깥(backdrop) 클릭
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (prevFocus?.isConnected) prevFocus.focus({ preventScroll: true });
      resolve(result);
    });
    dialog.showModal();
    // 위험한 동작이면 취소에 기본 포커스
    (tone === "danger" ? cancel : ok).focus();
  });
}

/** 페이지 이동 전 확인 */
export async function confirmNavigate(href: string, label?: string) {
  if (
    await confirmDialog({
      title: "페이지 이동",
      message: label ? `"${label}" 페이지로 이동할까요?` : "이 페이지로 이동할까요?",
      confirmText: "이동",
    })
  )
    window.location.href = href;
}
