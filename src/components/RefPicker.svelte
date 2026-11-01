<svelte:options css="injected" />

<script lang="ts">
  // 자료 고르기 — 제목으로 사이트 자료를 찾아 고른다(링크·인용·이미지 참조 블록).
  // 복원(2026-11-01): 배포본 _astro/BlockEditor.*.js 에 함께 묶인 컴포넌트. 파일 이름은 추정.
  import { onMount } from "svelte";
  import { searchContent } from "../lib/blocks";

  let {
    placeholder = "자료 제목으로 찾기 (예: 영대, 연혁)",
    kinds,
    onpick,
    oncancel,
  }: {
    placeholder?: string;
    kinds?: string[];
    onpick: (item: any) => void;
    oncancel?: () => void;
  } = $props();

  let q = $state("");
  let items = $state<any[]>([]);
  let loading = $state(false);
  let input = $state<HTMLInputElement | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function find() {
    loading = true;
    try {
      items = await searchContent(q.trim(), kinds);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    input?.focus();
    find();
  });

  function onInput() {
    clearTimeout(timer);
    timer = setTimeout(find, 250);
  }
</script>

<div class="rp">
  <div class="bar">
    <input
      {placeholder}
      bind:value={q}
      bind:this={input}
      oninput={onInput}
      onkeydown={(e) => e.key === "Escape" && oncancel?.()}
    />
    <button type="button" class="close" onclick={() => oncancel?.()}>닫기</button>
  </div>
  {#if loading && !items.length}
    <p class="dim">찾는 중…</p>
  {:else if items.length}
    <ul>
      {#each items as it (it.kind + it.id)}
        <li>
          <button type="button" onclick={() => onpick(it)}
            ><span class="kind">{it.label}</span> <span class="t">{it.title}</span></button
          >
        </li>
      {/each}
    </ul>
  {:else}
    <p class="dim">찾는 자료가 없습니다.</p>
  {/if}
</div>

<style>
  .rp {
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    padding: 8px;
    background: var(--color-surface);
  }
  .bar {
    display: flex;
    gap: 6px;
  }
  input {
    flex: 1;
    padding: 7px 9px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    font: inherit;
    font-size: 0.9rem;
  }
  .close {
    border: 0;
    background: none;
    color: var(--color-muted);
    cursor: pointer;
    font-size: 0.82rem;
  }
  ul {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    max-height: 240px;
    overflow: auto;
  }
  li button {
    display: flex;
    gap: 8px;
    align-items: center;
    width: 100%;
    text-align: left;
    padding: 6px 8px;
    border: 0;
    background: none;
    cursor: pointer;
    border-radius: var(--radius-sm);
    font: inherit;
    font-size: 0.9rem;
  }
  li button:hover {
    background: var(--color-surface-2);
  }
  .kind {
    flex: none;
    font-size: 0.7rem;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-muted);
  }
  .dim {
    margin: 6px 0 0;
    font-size: 0.82rem;
    color: var(--color-muted);
  }
</style>
