<script lang="ts">
  // 시리즈 목차 상자 — 자료실 게시물이 시리즈에 속하면 글 위·아래에 보인다.
  // 복원(2026-11-01): 배포본 클라이언트(_astro/PostView.*.js 안에 함께 묶인 컴포넌트) 기준. 파일 이름은 추정.
  import { SERIES_ICON_PATH } from "../../lib/library";

  let {
    title,
    items,
    where = "top",
  }: {
    title: string;
    items: { id: string; title: string; href: string; on?: boolean }[];
    where?: "top" | "bottom";
  } = $props();

  const at = $derived(items.findIndex((i) => i.on));
</script>

<nav class="series-box" class:bottom={where === "bottom"} aria-label={`시리즈 ${title}`}>
  <div class="sb-head">
    <svg class="sb-icon" viewBox="0 -960 960 960" width="18" height="18" aria-hidden="true"
      ><path fill="currentColor" d={SERIES_ICON_PATH}></path></svg
    >
    <strong>{title}</strong>
    <span class="sb-pos">{at >= 0 ? `${at + 1} / ${items.length}` : `${items.length}편`}</span>
  </div>
  <ol>
    {#each items as it, i (it.id)}
      <li>
        <a href={it.href} aria-current={it.on ? "page" : undefined} class:on={it.on}>
          <span class="no">{i + 1}</span>
          <span class="t">{it.title}</span>
        </a>
      </li>
    {/each}
  </ol>
</nav>

<style>
  .series-box {
    margin: 0 0 22px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    overflow: hidden;
  }
  .series-box.bottom {
    margin: 26px 0 0;
  }
  .sb-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: var(--color-surface-2);
    border-bottom: 1px solid var(--color-rule);
  }
  .sb-icon {
    flex: none;
    color: var(--color-primary);
  }
  .sb-head strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sb-pos {
    margin-left: auto;
    flex: none;
    color: var(--color-muted);
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li + li {
    border-top: 1px solid var(--color-rule);
  }
  a {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 42px;
    padding: 0 14px;
    color: var(--color-ink);
  }
  a:hover .t {
    color: var(--color-primary);
  }
  a.on {
    background: var(--color-primary-bg);
    box-shadow: inset 3px 0 0 var(--color-primary);
    color: var(--color-primary);
  }
  a.on .t {
    font-weight: 700;
  }
  .no {
    flex: none;
    min-width: 1.6em;
    color: var(--color-muted);
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }
  a.on .no {
    color: inherit;
  }
  .t {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
