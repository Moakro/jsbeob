<script lang="ts">
  // ＋ 버튼 — 오른쪽 아래 둥근 버튼(모바일은 아래 막대 위).
  // 2026-11-28 오너 결정: 교인(40) 이상에게 보인다.
  //   교인(40~59): 누르면 바로 '오리알터에 올리기' 시트(사진+짧은 글 → 바로 게시, AI 안 씀).
  //   편집진(60) 이상: 두 갈래 — '오리알터에 올리기' / '올림함(공문·AI 초안)' + 올림함 보기. 마지막에 고른 것을 위로.
  // 로그인 정보(api.me, 페이지당 한 번)를 브라우저에서 확인한 뒤에만 그리므로 비회원 페이지 캐시와 부딪히지 않는다.
  // 자료 서랍 버튼(RefDrawer .sd-fab)은 오른쪽 가운데라 겹치지 않는다. 모달·사진 보기·서랍·편집 화면에서는 숨긴다.
  import { onMount } from "svelte";
  import { LEVEL } from "../../data/levels";
  import { api } from "../../lib/api";
  import { INBOX_PATH, INTAKE_CHANGED, INTAKE_LEVEL, INTAKE_OPEN, intakeApi } from "../../lib/intake";
  import IntakeSheet from "./IntakeSheet.svelte";
  import OrialterSheet from "../board/OrialterSheet.svelte";

  type Choice = "orialter" | "intake";
  const LAST_KEY = "jb:fab-last";

  let show = $state(false);
  /** 편집진 이상 — 올림함 갈래까지 */
  let editor = $state(false);
  let count = $state(0);
  let menu = $state(false);
  let sheet = $state(false);
  let osheet = $state(false);
  let last = $state<Choice>("orialter");
  let toast = $state<{ msg: string; href: string } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let root = $state<HTMLElement | null>(null);

  /** 편집 화면(글쓰기·수정·올림 한 건)에서는 버튼을 숨긴다 — 가리지 않게 */
  const editorPage = (p: string) => /\/(write|edit)\/?$/.test(p) || /^\/editor\/inbox\/[^/]+\/?$/.test(p) || p.startsWith("/admin");

  async function refresh() {
    try {
      count = (await intakeApi.count()).open;
    } catch {}
  }

  onMount(() => {
    let alive = true;
    const onChanged = () => refresh();
    const onOpen = () => editor && show && (sheet = true);
    try {
      if (localStorage.getItem(LAST_KEY) === "intake") last = "intake";
    } catch {}
    (async () => {
      try {
        const me = (await api.me()).user;
        if (!alive || !me || !me.display_name || (me.level ?? 0) < LEVEL.BELIEVER) return;
        show = !editorPage(location.pathname);
        if ((me.level ?? 0) < INTAKE_LEVEL) return;
        editor = true;
        window.addEventListener(INTAKE_CHANGED, onChanged);
        window.addEventListener(INTAKE_OPEN, onOpen);
        refresh();
      } catch {}
    })();
    const onDoc = (e: MouseEvent) => {
      if (menu && root && !root.contains(e.target as Node)) menu = false;
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (menu = false);
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener(INTAKE_CHANGED, onChanged);
      window.removeEventListener(INTAKE_OPEN, onOpen);
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  });

  function choose(c: Choice) {
    menu = false;
    last = c;
    try {
      localStorage.setItem(LAST_KEY, c);
    } catch {}
    if (c === "orialter") osheet = true;
    else sheet = true;
  }

  function onFab() {
    if (editor) menu = !menu;
    else osheet = true;
  }

  function done(msg: string, href: string) {
    toast = { msg, href };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 6000);
  }
  const ORDER: Choice[] = $derived(last === "intake" ? ["intake", "orialter"] : ["orialter", "intake"]);
</script>

{#snippet item(c: Choice)}
  {#if c === "orialter"}
    <button type="button" role="menuitem" onclick={() => choose("orialter")}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="m3.5 16 5-5 4 4 3-3 5 5" /><circle cx="15.5" cy="9" r="1.6" /></svg>
      <span class="t">오리알터에 올리기<small>사진·글 바로 게시</small></span>
    </button>
  {:else}
    <button type="button" role="menuitem" onclick={() => choose("intake")}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0-5 5m5-5 5 5M5 20h14" /></svg>
      <span class="t">올림함에 올리기<small>공문·AI 초안</small></span>
    </button>
  {/if}
{/snippet}

{#if show}
  <div class="ifab-wrap" bind:this={root}>
    {#if menu}
      <div class="ifab-menu" role="menu" aria-label="올리기">
        {#each ORDER as c (c)}{@render item(c)}{/each}
        <a role="menuitem" href={INBOX_PATH}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h4l2 3h4l2-3h4M4 13l2-8h12l2 8v6H4z" /></svg>
          올림함 보기{#if count}<span class="n">{count}</span>{/if}
        </a>
      </div>
    {/if}
    <button
      type="button"
      class="ifab"
      class:open={menu}
      aria-label={editor ? (count ? `올리기·올림함 (처리 전 ${count}건)` : "올리기·올림함") : "오리알터에 올리기"}
      aria-haspopup={editor ? "menu" : "dialog"}
      aria-expanded={editor ? menu : osheet}
      title={editor ? "올리기·올림함" : "오리알터에 올리기"}
      onclick={onFab}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      {#if count}<span class="badge">{count > 99 ? "99+" : count}</span>{/if}
    </button>
  </div>
{/if}
{#if editor && (show || sheet)}
  <IntakeSheet open={sheet} onclose={() => (sheet = false)} ondone={done} />
{/if}
{#if show || osheet}
  <OrialterSheet open={osheet} onclose={() => (osheet = false)} />
{/if}
{#if toast}
  <div class="ifab-toast" role="status">
    <span>{toast.msg}</span>
    <a href={toast.href}>보기</a>
    <button type="button" aria-label="닫기" onclick={() => (toast = null)}>✕</button>
  </div>
{/if}

<style>
  .ifab-wrap {
    --ifab-bottom: 24px;
    position: fixed;
    right: 20px;
    bottom: calc(var(--ifab-bottom) + env(safe-area-inset-bottom, 0px));
    z-index: 75;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
    transition: bottom 0.22s ease;
  }
  /* 모바일 아래 막대(RefDrawer .dock)가 떠 있으면 그 위로 */
  @media (max-width: 860px) {
    .ifab-wrap {
      right: 14px;
      --ifab-bottom: 16px;
    }
    :global(body:has(nav.dock:not(.is-hidden))) .ifab-wrap {
      --ifab-bottom: 72px;
    }
  }
  /* 모달·사진 보기·자료 서랍·AI 대화가 열려 있으면 숨김 */
  :global(body:has(.mf-back, .iv, aside.sd, [aria-modal="true"])) .ifab-wrap {
    display: none;
  }
  .ifab {
    position: relative;
    width: 56px;
    height: 56px;
    border: 0;
    border-radius: 50%;
    background: var(--color-primary);
    color: #fff;
    display: grid;
    place-items: center;
    cursor: pointer;
    box-shadow: var(--shadow-lg);
  }
  .ifab:hover {
    background: var(--color-primary-deep);
  }
  .ifab svg {
    width: 28px;
    height: 28px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
    transition: transform 0.18s ease;
  }
  .ifab.open svg {
    transform: rotate(45deg);
  }
  .badge {
    position: absolute;
    top: -2px;
    right: -2px;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--color-gold);
    color: #fff;
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 22px;
    text-align: center;
    box-shadow: 0 0 0 2px var(--color-surface);
  }
  .ifab-menu {
    display: grid;
    min-width: 200px;
    padding: 6px;
    border: 1px solid var(--color-rule);
    border-radius: 12px;
    background: var(--color-surface);
    box-shadow: var(--shadow-lg);
  }
  .ifab-menu button,
  .ifab-menu a {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--color-ink);
    font: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .ifab-menu button:hover,
  .ifab-menu a:hover {
    background: var(--color-surface-2);
  }
  .ifab-menu svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .ifab-menu .t {
    display: grid;
    text-align: left;
    line-height: 1.3;
  }
  .ifab-menu .t small {
    color: var(--color-muted);
    font-size: 0.78rem;
    font-weight: 400;
  }
  .ifab-menu .n {
    margin-left: auto;
    min-width: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--color-gold);
    color: #fff;
    font-size: 0.75rem;
    line-height: 20px;
    text-align: center;
  }
  .ifab-toast {
    position: fixed;
    left: 50%;
    bottom: calc(96px + env(safe-area-inset-bottom, 0px));
    transform: translateX(-50%);
    z-index: 95;
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: calc(100vw - 32px);
    padding: 10px 14px;
    border-radius: 10px;
    background: var(--color-ink);
    color: #fff;
    font-size: 0.9rem;
    box-shadow: var(--shadow-lg);
  }
  .ifab-toast a {
    color: var(--color-gold-soft);
    font-weight: 700;
  }
  .ifab-toast button {
    border: 0;
    background: none;
    color: #fff;
    cursor: pointer;
  }
  @media (prefers-reduced-motion: reduce) {
    .ifab-wrap,
    .ifab svg {
      transition: none;
    }
  }
</style>
