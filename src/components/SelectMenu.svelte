<svelte:options css="injected" />

<script lang="ts" module>
  export interface SelectOption {
    value: string;
    label: string;
  }
  export interface SelectGroup {
    label?: string;
    options: SelectOption[];
  }
</script>

<script lang="ts">
  // 접근성 있는 드롭다운(listbox) — 네이티브 <select> 대신. 키보드(↑↓ Home End Enter Esc, 첫 글자 이동) 지원.
  // 복원(2026-11-01): 배포본 클라이언트(_astro/SelectMenu.*.js) 기준. 원본은 css="injected" 로 컴파일됐다.
  import { onMount } from "svelte";

  let {
    groups,
    value = $bindable(""),
    placeholder = "선택하세요",
    invalid = false,
    labelledby,
  }: {
    groups: SelectGroup[];
    value?: string;
    placeholder?: string;
    invalid?: boolean;
    labelledby?: string;
  } = $props();

  const uid = `sm-${Math.random().toString(36).slice(2, 8)}`;
  const flat = $derived(groups.flatMap((g) => g.options));
  const selected = $derived(flat.find((o) => o.value === value) ?? null);

  let open = $state(false);
  let up = $state(false);
  let active = $state(-1);
  let root = $state<HTMLElement | null>(null);
  let button = $state<HTMLButtonElement | null>(null);
  let list = $state<HTMLElement | null>(null);
  const MAX_H = 288;
  let maxH = $state(MAX_H);

  function openList() {
    if (!button) return;
    const r = button.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 16;
    const above = r.top - 16;
    // 아래 공간이 좁고 위가 더 넓으면 위로 연다
    up = below < 200 && above > below;
    maxH = Math.max(160, Math.min(MAX_H, up ? above : below));
    active = Math.max(
      0,
      flat.findIndex((o) => o.value === value),
    );
    open = true;
    requestAnimationFrame(scrollActive);
  }

  function close(focus = true) {
    open = false;
    if (focus) button?.focus();
  }

  function pick(i: number) {
    const o = flat[i];
    if (!o) return;
    value = o.value;
    close();
  }

  function scrollActive() {
    const el = list?.querySelector<HTMLElement>(`#${uid}-opt-${active}`);
    if (!list || !el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top - 6;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 6;
  }

  function move(i: number) {
    active = Math.max(0, Math.min(flat.length - 1, i));
    requestAnimationFrame(scrollActive);
  }

  function onKeydown(e: KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(active + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(active - 1);
        break;
      case "Home":
        e.preventDefault();
        move(0);
        break;
      case "End":
        e.preventDefault();
        move(flat.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        pick(active);
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Tab":
        close(false);
        break;
      default:
        // 첫 글자로 다음 항목 찾기
        if (e.key.length === 1) {
          const n = flat.length;
          for (let s = 1; s <= n; s++) {
            const i = (active + s) % n;
            if (flat[i].label.startsWith(e.key)) {
              move(i);
              break;
            }
          }
        }
    }
  }

  onMount(() => {
    const onDown = (e: MouseEvent) => {
      if (open && root && !root.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });

  /** 그룹마다 첫 옵션의 전체 인덱스 */
  const groupStart = $derived(
    groups.reduce<number[]>((acc, _g, gi) => {
      acc.push(gi === 0 ? 0 : acc[gi - 1] + groups[gi - 1].options.length);
      return acc;
    }, []),
  );
</script>

<div class="sm" bind:this={root}>
  <button
    type="button"
    class="sm-btn"
    class:is-open={open}
    class:is-invalid={invalid}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls={`${uid}-list`}
    aria-labelledby={labelledby ? `${labelledby} ${uid}-val` : undefined}
    aria-activedescendant={open && active >= 0 ? `${uid}-opt-${active}` : undefined}
    bind:this={button}
    onclick={() => (open ? close() : openList())}
    onkeydown={onKeydown}
  >
    <span id={`${uid}-val`} class:placeholder={!selected}>{selected?.label ?? placeholder}</span>
    <svg class="chev" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"
      ><path
        d="M5 7.5l5 5 5-5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></path></svg
    >
  </button>
  {#if open}
    <div
      class="sm-list"
      class:up
      role="listbox"
      id={`${uid}-list`}
      aria-labelledby={labelledby}
      style={`max-height:${maxH}px`}
      bind:this={list}
    >
      {#each groups as g, gi}
        {#if g.label}
          <div class="sm-group" role="presentation">{g.label}</div>
        {/if}
        {#each g.options as o, oi}
          {@const idx = groupStart[gi] + oi}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="sm-opt"
            class:is-active={idx === active}
            class:is-selected={o.value === value}
            role="option"
            tabindex="-1"
            id={`${uid}-opt-${idx}`}
            aria-selected={o.value === value}
            onmousemove={() => (active = idx)}
            onmousedown={(e) => e.preventDefault()}
            onclick={() => pick(idx)}
            onkeydown={onKeydown}
          >
            <span>{o.label}</span>
            {#if o.value === value}
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"
                ><path
                  d="M4.5 10.5l3.5 3.5 7.5-8"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                ></path></svg
              >
            {/if}
          </div>
        {/each}
      {/each}
    </div>
  {/if}
</div>

<style>
  .sm {
    position: relative;
  }
  .sm-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 11px 14px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-fg);
    font: inherit;
    font-size: 1rem;
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }
  .sm-btn:hover {
    border-color: var(--color-faint);
  }
  .sm-btn:focus-visible,
  .sm-btn.is-open {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px var(--color-primary-bg);
  }
  .sm-btn.is-invalid {
    border-color: var(--color-primary);
  }
  .placeholder {
    color: var(--color-muted);
  }
  .chev {
    flex: none;
    color: var(--color-muted);
    transition: transform 0.18s ease;
  }
  .is-open .chev {
    transform: rotate(180deg);
  }
  .sm-list {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + 6px);
    z-index: 40;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 6px;
    background: var(--color-surface);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    animation: sm-in 0.12s ease-out;
  }
  .sm-list.up {
    top: auto;
    bottom: calc(100% + 6px);
  }
  .sm-group {
    padding: 8px 10px 4px;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--color-muted);
  }
  .sm-opt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 10px;
    border-radius: var(--radius-md);
    font-size: 0.95rem;
    cursor: pointer;
  }
  .sm-opt.is-active {
    background: var(--color-surface-2);
  }
  .sm-opt.is-selected {
    color: var(--color-primary);
    font-weight: 700;
    background: var(--color-primary-bg);
  }
  @keyframes sm-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sm-list {
      animation: none;
    }
  }
</style>
