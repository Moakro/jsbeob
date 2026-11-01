<script lang="ts">
  // AI 대화 서랍(오른쪽) — [data-ai-open] 버튼이나 'jb:ai-open' 이벤트로 연다. 로그인 회원만.
  // 지금은 준비 중 안내만 답한다. 모바일은 빈 입력일 때 보내기 버튼이 음성 입력이 된다.
  // 복원(2026-11-01): 배포본 SSR(Base 청크)·클라이언트(_astro/AiChatDrawer.*.js) 기준.
  import { onMount, tick } from "svelte";
  import { canUseVoice, startVoice } from "../lib/speech";

  const SPARK =
    "m760-600-50-110-110-50 110-50 50-110 50 110 110 50-110 50-50 110Zm0 560-50-110-110-50 110-50 50-110 50 110 110 50-110 50-50 110ZM360-160 260-380 40-480l220-100 100-220 100 220 220 100-220 100-100 220Zm0-194 40-86 86-40-86-40-40-86-40 86-86 40 86 40 40 86Zm0-126Z";

  interface Msg {
    id: number;
    role: "user" | "assistant";
    text: string;
    pending?: boolean;
  }

  let open = $state(false);
  const messages = $state<Msg[]>([
    { id: 0, role: "assistant", text: "무엇이 궁금하세요? 경전·전각·교리에 대해 편하게 물어보세요." },
  ]);
  let draft = $state("");
  let focused = $state(false);
  let listening = $state(false);
  let interim = $state("");
  let voice = $state(false);
  let busy = $state(false);
  /** undefined = 확인 중, null = 비로그인 */
  let user = $state<any>(undefined);
  let panel = $state<HTMLElement | undefined>(undefined);
  let log = $state<HTMLElement | undefined>(undefined);
  let input = $state<HTMLTextAreaElement | undefined>(undefined);
  let opener: HTMLElement | null = null;
  let rec: { stop(): void; abort(): void } | null = null;
  let seq = 1;

  /** 보내기 버튼 모드 — 빈 입력·비포커스·음성 가능이면 마이크 */
  const mode = $derived(listening ? "listening" : !draft.trim() && !focused && voice ? "mic" : "send");

  function setExpanded(v: boolean) {
    document.querySelectorAll("[data-ai-open]").forEach((b) => b.setAttribute("aria-expanded", String(v)));
  }

  function show(from?: HTMLElement | null) {
    opener = from ?? (document.activeElement as HTMLElement | null);
    voice = canUseVoice();
    open = true;
    setExpanded(true);
    document.documentElement.style.overflow = "hidden";
    fitViewport();
    if (user === undefined) loadMe();
    tick().then(scrollDown);
  }

  function hide() {
    if (!open) return;
    rec?.abort();
    open = false;
    focused = false;
    setExpanded(false);
    document.documentElement.style.overflow = "";
    resetViewport();
    opener?.focus?.({ preventScroll: true });
  }

  async function loadMe() {
    try {
      const r = await fetch("/api/me", { credentials: "same-origin" });
      user = r.ok ? ((await r.json()).user ?? null) : null;
    } catch {
      user = null;
    }
  }

  function login() {
    window.dispatchEvent(new CustomEvent("jb:login"));
  }

  async function scrollDown() {
    await tick();
    if (log) log.scrollTop = log.scrollHeight;
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    busy = true;
    draft = "";
    messages.push({ id: seq++, role: "user", text });
    const id = seq++;
    messages.push({ id, role: "assistant", text: "…", pending: true });
    scrollDown();
    await new Promise((r) => setTimeout(r, 600));
    const i = messages.findIndex((m) => m.id === id);
    if (i >= 0)
      messages[i] = {
        id,
        role: "assistant",
        text: "AI 대화는 준비 중입니다. 곧 사이트 자료를 바탕으로 답해 드릴게요.",
      };
    busy = false;
    scrollDown();
  }

  function submit(e: Event) {
    e.preventDefault();
    if (mode === "mic") return listen();
    if (mode === "listening") return rec?.stop();
    send();
  }

  function listen() {
    interim = "";
    const r = startVoice({
      onText: (t) => (interim = t),
      onEnd: async (t) => {
        rec = null;
        listening = false;
        interim = "";
        if (t) draft = t;
      },
      onFatal: () => {
        voice = false;
      },
    });
    if (r) {
      rec = r;
      listening = true;
    }
  }

  // 모바일 키보드가 올라오면 보이는 영역(visualViewport)에 맞춘다
  function fitViewport() {
    const vv = window.visualViewport;
    if (!vv || !panel || !open) return;
    panel.style.height = `${Math.round(vv.height)}px`;
    panel.style.top = `${Math.max(0, Math.round(vv.offsetTop))}px`;
  }
  function resetViewport() {
    if (!panel) return;
    panel.style.height = "";
    panel.style.top = "";
  }

  onMount(() => {
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as Element | null)?.closest?.("[data-ai-open]") as HTMLElement | null;
      if (!btn) return;
      e.preventDefault();
      if (open) hide();
      else show(btn);
    };
    const onOpen = () => show();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open && !document.querySelector("dialog[open]")) hide();
    };
    document.addEventListener("click", onClick);
    window.addEventListener("jb:ai-open", onOpen);
    document.addEventListener("keydown", onKey);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", fitViewport);
    vv?.addEventListener("scroll", fitViewport);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("jb:ai-open", onOpen);
      document.removeEventListener("keydown", onKey);
      vv?.removeEventListener("resize", fitViewport);
      vv?.removeEventListener("scroll", fitViewport);
      rec?.abort();
      document.documentElement.style.overflow = "";
    };
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="ai-scrim" class:on={open} aria-hidden="true" onclick={hide}></div>
<div
  class="ai"
  class:on={open}
  role="dialog"
  aria-label="AI 대화"
  aria-modal="true"
  inert={!open}
  bind:this={panel}
>
  <header class="ai-head">
    <span class="ai-spark" aria-hidden="true"
      ><svg viewBox="0 -960 960 960"><path d={SPARK}></path></svg></span
    >
    <h2>AI 대화</h2>
    <button type="button" class="ai-close" aria-label="닫기" onclick={hide}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>
    </button>
  </header>
  {#if user === undefined}
    <div class="ai-gate"><p class="dim">확인 중…</p></div>
  {:else if user === null}
    <div class="ai-gate">
      <span class="ai-orb" aria-hidden="true"
        ><svg viewBox="0 -960 960 960"><path d={SPARK}></path></svg></span
      >
      <p>AI 대화는 로그인 후 이용할 수 있습니다.</p>
      <button type="button" class="ai-login" onclick={login}>로그인</button>
    </div>
  {:else}
    <div class="ai-log" role="log" aria-live="polite" bind:this={log}>
      {#each messages as m (m.id)}
        <div class="row" class:mine={m.role === "user"}>
          <div class="bubble" class:pending={m.pending} aria-label={m.pending ? "응답 작성 중" : undefined}>
            {m.text}
          </div>
        </div>
      {/each}
    </div>
    <div class="ai-composer">
      {#if listening}
        <div class="ai-listening" aria-live="polite">
          <span class="pulse" aria-hidden="true"></span>
          <strong>듣는 중…</strong>
          <span class="interim">{interim}</span>
        </div>
      {/if}
      <form onsubmit={submit}>
        <textarea
          rows="2"
          aria-label="메시지"
          placeholder="무엇이든 물어보세요"
          enterkeyhint="enter"
          bind:value={draft}
          bind:this={input}
          onfocus={() => (focused = true)}
          onblur={() => (focused = false)}></textarea>
        <button
          type="submit"
          class="ai-send"
          data-mode={mode}
          aria-label={mode === "mic" ? "음성 입력" : mode === "listening" ? "음성 입력 중지" : "보내기"}
          disabled={mode === "send" && (!draft.trim() || busy)}
        >
          {#if mode === "mic"}
            <svg viewBox="0 0 24 24" aria-hidden="true"
              ><rect x="9" y="3" width="6" height="11" rx="3"></rect><path
                d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
              ></path></svg
            >
          {:else if mode === "listening"}
            <svg viewBox="0 0 24 24" aria-hidden="true"
              ><rect x="7" y="7" width="10" height="10" rx="2" class="fill"></rect></svg
            >
          {:else}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-6 16-2.5-6.5z"></path></svg>
          {/if}
        </button>
      </form>
    </div>
  {/if}
</div>

<style>
  .ai-scrim {
    position: fixed;
    inset: 0;
    z-index: 110;
    background: #0006;
    opacity: 0;
    visibility: hidden;
    transition:
      opacity 0.2s ease,
      visibility 0s linear 0.2s;
  }
  .ai-scrim.on {
    opacity: 1;
    visibility: visible;
    transition: opacity 0.2s ease;
  }
  .ai {
    position: fixed;
    top: 0;
    right: 0;
    z-index: 120;
    height: 100dvh;
    width: min(92vw, 420px);
    display: flex;
    flex-direction: column;
    background: var(--color-surface);
    border-left: 1px solid var(--color-rule);
    box-shadow: -10px 0 30px #28190f38;
    transform: translate(100%);
    visibility: hidden;
    transition:
      transform 0.22s ease,
      visibility 0s linear 0.22s;
  }
  .ai.on {
    transform: none;
    visibility: visible;
    transition: transform 0.22s ease;
  }
  .ai-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px 14px 20px;
    border-bottom: 1px solid var(--color-rule);
  }
  .ai-head h2 {
    margin: 0;
    font-size: 1.02rem;
    font-weight: 700;
    color: var(--color-ink);
  }
  .ai-spark svg {
    display: block;
    width: 20px;
    height: 20px;
    fill: #e0a91b;
  }
  .ai-close {
    margin-left: auto;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--color-muted);
    cursor: pointer;
  }
  .ai-close:hover {
    background: var(--color-surface-2);
  }
  .ai-close svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
  .ai-log {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overscroll-behavior: contain;
  }
  .row {
    display: flex;
    justify-content: flex-start;
  }
  .row.mine {
    justify-content: flex-end;
  }
  .bubble {
    max-width: 85%;
    padding: 10px 14px;
    border-radius: var(--radius-md) var(--radius-md) var(--radius-md) 0;
    background: var(--color-surface-2);
    border: 1px solid var(--color-rule);
    color: var(--color-ink);
    font-size: 0.9rem;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .row.mine .bubble {
    border-radius: var(--radius-md) var(--radius-md) 0 var(--radius-md);
    background: #2a241f;
    border-color: #2a241f;
    color: #fff;
  }
  .bubble.pending {
    color: var(--color-muted);
  }
  .ai-gate {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 32px;
    text-align: center;
  }
  .ai-gate p {
    margin: 0;
    font-size: 0.95rem;
    color: var(--color-ink);
  }
  .ai-gate .dim {
    color: var(--color-muted);
  }
  .ai-orb {
    width: 72px;
    height: 72px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background-image: linear-gradient(
      135deg,
      var(--color-primary-deep) 0%,
      var(--color-primary) 38%,
      var(--color-primary-soft) 68%,
      var(--color-primary-deep) 100%
    );
    background-size: 220% 220%;
    box-shadow:
      0 10px 26px -8px #7e241c80,
      inset 0 0 0 1px #ffffff1f;
    animation: ai-shift 6s ease-in-out infinite;
  }
  .ai-orb svg {
    width: 34px;
    height: 34px;
    fill: #fff;
  }
  @keyframes ai-shift {
    from,
    to {
      background-position: 0% 50%;
    }
    50% {
      background-position: 100% 50%;
    }
  }
  .ai-login {
    padding: 11px 28px;
    border: 0;
    border-radius: var(--radius-md);
    background: #2a241f;
    color: #fff;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .ai-login:hover {
    filter: brightness(1.2);
  }
  .ai-composer {
    border-top: 1px solid var(--color-rule);
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  }
  .ai-listening {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    padding: 8px 12px;
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    font-size: 0.8rem;
    min-width: 0;
  }
  .ai-listening strong {
    color: #b3860f;
    flex: none;
  }
  .ai-listening .interim {
    color: var(--color-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pulse {
    position: relative;
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #e0a91b;
  }
  .pulse:after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: #e0a91b;
    animation: ai-ping 1.4s cubic-bezier(0, 0, 0.2, 1) infinite;
  }
  @keyframes ai-ping {
    from {
      transform: scale(1);
      opacity: 0.7;
    }
    75%,
    to {
      transform: scale(2.6);
      opacity: 0;
    }
  }
  form {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  textarea {
    flex: 1;
    min-width: 0;
    resize: none;
    overflow-y: auto;
    height: calc(2.9em + 26px);
    padding: 12px 14px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-rule);
    background: var(--color-surface-2);
    font: inherit;
    font-size: 16px;
    line-height: 1.45;
    color: var(--color-ink);
  }
  textarea:focus {
    outline: none;
    border-color: #c9a227;
  }
  .ai-send {
    flex: none;
    width: 48px;
    height: 48px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: var(--radius-md);
    background: #2a241f;
    color: #f5c84c;
    cursor: pointer;
    transition:
      filter 0.15s,
      opacity 0.15s;
  }
  .ai-send:hover {
    filter: brightness(1.15);
  }
  .ai-send:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .ai-send svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .ai-send svg .fill {
    fill: currentColor;
    stroke: none;
  }
  .ai-send[data-mode="listening"] {
    animation: ai-breathe 1.4s ease-in-out infinite;
  }
  @keyframes ai-breathe {
    from,
    to {
      box-shadow: 0 0 #e0a91b80;
    }
    50% {
      box-shadow: 0 0 0 8px #e0a91b00;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ai,
    .ai-scrim {
      transition: none;
    }
    .pulse:after,
    .ai-orb,
    .ai-send[data-mode="listening"] {
      animation: none;
    }
  }
</style>
