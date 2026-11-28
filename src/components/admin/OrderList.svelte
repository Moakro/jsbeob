<script lang="ts" generics="T extends { id: string }">
  // 관리자 — 순서 바꾸는 목록 (2026-11-28). 데스크톱은 ⠿ 를 끌어서, 폰·키보드는 ▲▼ 버튼으로.
  // 저장은 하지 않는다 — 바뀐 순서를 onchange 로 넘기고, 부모가 '순서 저장' 한 번으로 보낸다.
  import type { Snippet } from "svelte";

  let {
    items,
    onchange,
    row,
    disabled = false,
    label = "항목",
  }: {
    items: T[];
    onchange: (next: T[]) => void;
    row: Snippet<[T, number]>;
    disabled?: boolean;
    label?: string;
  } = $props();

  let dragId = $state<string | null>(null);

  function move(i: number, d: number) {
    const j = i + d;
    if (disabled || j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onchange(next);
  }

  function over(e: DragEvent, overId: string) {
    if (!dragId) return;
    e.preventDefault();
    if (overId === dragId) return;
    const from = items.findIndex((x) => x.id === dragId);
    const to = items.findIndex((x) => x.id === overId);
    if (from < 0 || to < 0) return;
    const next = [...items];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    onchange(next);
  }
</script>

<ol class="order">
  {#each items as it, i (it.id)}
    <li
      class:dragging={dragId === it.id}
      ondragover={(e) => over(e, it.id)}
      ondrop={(e) => {
        e.preventDefault();
        dragId = null;
      }}
    >
      <span
        class="grip"
        draggable={!disabled}
        title="끌어서 순서 바꾸기"
        aria-hidden="true"
        ondragstart={(e) => {
          dragId = it.id;
          e.dataTransfer?.setData("text/plain", "");
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        }}
        ondragend={() => (dragId = null)}>⠿</span
      >
      <span class="no">{i + 1}</span>
      <div class="body">{@render row(it, i)}</div>
      <span class="mv">
        <button
          type="button"
          aria-label={`${i + 1}번째 ${label} 위로`}
          disabled={disabled || i === 0}
          onclick={() => move(i, -1)}>▲</button
        >
        <button
          type="button"
          aria-label={`${i + 1}번째 ${label} 아래로`}
          disabled={disabled || i === items.length - 1}
          onclick={() => move(i, 1)}>▼</button
        >
      </span>
    </li>
  {/each}
</ol>

<style>
  .order {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 6px 8px;
    border-top: 1px solid var(--color-rule);
    background: var(--color-surface);
  }
  li:first-child {
    border-top: 0;
  }
  li.dragging {
    opacity: 0.5;
    background: var(--color-surface-2);
  }
  .grip {
    flex: none;
    width: 18px;
    text-align: center;
    color: var(--color-muted);
    cursor: grab;
    user-select: none;
  }
  .no {
    flex: none;
    min-width: 1.4em;
    color: var(--color-muted);
    font-size: 0.8rem;
    text-align: right;
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
  }
  .mv {
    flex: none;
    display: flex;
    gap: 4px;
  }
  .mv button {
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    color: var(--color-fg);
    font-size: 0.8rem;
    cursor: pointer;
  }
  .mv button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  /* 터치 화면은 끌기 대신 ▲▼ */
  @media (pointer: coarse) {
    .grip {
      display: none;
    }
  }
</style>
