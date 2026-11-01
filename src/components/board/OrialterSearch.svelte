<script lang="ts">
  // 오리알터 검색칸 — 검색어를 피드 필터에 더한다(여러 개면 모두 포함하는 글).
  // 복원(2026-11-01): 배포본 SSR(CommunityHome 청크)·클라이언트(_astro/OrialterSearch.*.js) 기준.
  import { ORIALTER_FILTER_EVENT } from "../../lib/api";

  let q = $state("");

  function submit(e: Event) {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    window.dispatchEvent(new CustomEvent(ORIALTER_FILTER_EVENT, { detail: { addQ: v, keepAuthor: true } }));
    q = "";
  }
</script>

<form class="osearch" role="search" onsubmit={submit}>
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
    ><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"></circle><path
      d="M16 16l4.5 4.5"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    ></path></svg
  >
  <input
    type="search"
    bind:value={q}
    placeholder="오리알터 검색"
    aria-label="오리알터 검색(검색어를 더 넣으면 모두 포함하는 글)"
  />
</form>

<style>
  .osearch {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 682px;
    padding: 0 14px;
    height: 42px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-muted);
  }
  .osearch:focus-within {
    border-color: var(--color-primary-soft);
  }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    font: inherit;
    color: var(--color-fg);
    outline: none;
  }
</style>
