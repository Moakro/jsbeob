<script lang="ts" module>
  // 열린 모달 스택 — 맨 위 모달만 Esc 로 닫히고, 하나라도 열려 있으면 body 스크롤을 막는다.
  const stack: symbol[] = [];
  function syncScrollLock() {
    document.body.style.overflow = stack.length ? "hidden" : "";
  }
</script>

<script lang="ts">
  // 공용 모달 틀 — body 끝으로 옮겨 그린다(portal).
  // 복원(2026-11-01): 배포본 SSR(Base 청크)·클라이언트(_astro/ModalFrame.*.js) 기준.
  import type { Snippet } from "svelte";

  let {
    open,
    onclose,
    label,
    title = null,
    wide = false,
    children,
  }: {
    open: boolean;
    onclose: () => void;
    label: string;
    title?: string | null;
    wide?: boolean;
    children: Snippet;
  } = $props();

  const id = Symbol("modal");

  $effect(() => {
    if (!open) return;
    stack.push(id);
    syncScrollLock();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stack[stack.length - 1] === id) onclose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      syncScrollLock();
    };
  });

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="mf-back" use:portal onclick={onclose}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <div
      class="mf"
      class:wide
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="mf-head" class:bare={!title}>
        {#if title}
          <h2>{title}</h2>
        {/if}
        <button type="button" class="mf-x" aria-label="닫기" title="닫기" onclick={onclose}>
          <svg viewBox="0 0 24 24" aria-hidden="true"
            ><path
              d="M6 6l12 12M18 6 6 18"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
            ></path></svg
          >
        </button>
      </div>
      {@render children()}
    </div>
  </div>
{/if}

<style>
  .mf-back {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 32px 16px;
    overflow-y: auto;
    background: var(--color-overlay);
    overscroll-behavior: contain;
  }
  .mf {
    position: relative;
    width: min(640px, 100%);
    margin-bottom: 32px;
    background: var(--color-surface);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
  }
  .mf.wide {
    width: min(880px, 100%);
  }
  .mf-head {
    position: sticky;
    top: 0;
    z-index: 3;
    display: flex;
    align-items: center;
    min-height: 52px;
    padding: 0 8px 0 20px;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-rule);
    border-radius: var(--radius-md) var(--radius-md) 0 0;
  }
  .mf-head.bare {
    position: sticky;
    top: 0;
    height: 0;
    min-height: 0;
    padding: 0;
    justify-content: flex-end;
    align-items: flex-start;
    overflow: visible;
    background: none;
    border: 0;
  }
  .mf-head.bare .mf-x {
    margin: 10px 10px 0 0;
  }
  .mf-head h2 {
    flex: 1;
    margin: 0;
    font-size: 1.05rem;
  }
  .mf-x {
    flex: none;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    margin-left: auto;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: #1f1c1a8c;
    color: #fff;
    cursor: pointer;
  }
  .mf-x svg {
    width: 20px;
    height: 20px;
  }
  .mf-x:hover {
    background: #1f1c1abf;
  }
  .mf-x:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  @media (max-width: 760px) {
    .mf-back {
      padding: 28px 24px 12px;
      align-items: flex-start;
    }
    .mf {
      margin-bottom: 16px;
    }
  }
</style>
