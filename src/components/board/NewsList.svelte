<script lang="ts">
  import { LEVEL } from "../../data/levels";
  // 소식 목록(쪽 번호) — 공지(고정)·일정 표시. 고르면 onpick(id).
  // 복원(2026-11-01): 배포본 SSR(NewsRows 청크)·클라이언트(_astro/NewsList.*.js) 기준.
  import { onMount } from "svelte";
  import { api, fmtPeriodFull, fmtPostDate, type MeUser, type PostSummary } from "../../lib/api";

  let {
    current = null,
    onpick,
    size = 10,
    showWrite = true,
  }: { current?: string | null; onpick: (id: string) => void; size?: number; showWrite?: boolean } = $props();

  let rows = $state<PostSummary[]>([]);
  let page = $state(1);
  let pages = $state(1);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let me = $state<MeUser | null>(null);

  async function load(p: number) {
    loading = true;
    error = null;
    try {
      const r = await api.listPosts({ board: "news", page: p, limit: size, with_hidden: true });
      rows = r.posts;
      page = r.page ?? p;
      pages = r.pages ?? 1;
    } catch (e) {
      error = e instanceof Error ? e.message : "불러오지 못했습니다";
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    load(1);
    api
      .me()
      .then((r) => (me = r.user))
      .catch(() => {});
  });

  /** 현재 쪽 주변 최대 5쪽 */
  const nums = $derived.by(() => {
    const from = Math.max(1, Math.min(page - 2, pages - 4));
    const to = Math.min(pages, from + 4);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  });
</script>

<div class="nl">
  {#if showWrite && (me?.level ?? 0) >= LEVEL.ADMIN}
    <div class="nl-tools"><a class="btn btn-ghost sm" href="/community/news/write/">＋ 소식 쓰기</a></div>
  {/if}
  {#if error}
    <p class="state err">{error}</p>
  {:else if !loading && !rows.length}
    <p class="state">아직 올라온 소식이 없습니다.</p>
  {:else}
    <ul class:dim={loading}>
      {#each rows as n (n.id)}
        <li class:on={n.id === current} class:is-hidden={n.is_hidden}>
          <button
            type="button"
            aria-current={n.id === current ? "true" : undefined}
            onclick={() => onpick(n.id)}
          >
            {#if n.is_pinned}<span class="tag notice">공지</span>{/if}
            {#if n.period}<span class="tag sched">일정</span>{/if}
            {#if !n.is_pinned && !n.period}<span class="tag">소식</span>{/if}
            {#if n.is_hidden}<span class="hidden-tag">{n.is_pending ? "대기" : "숨겨짐"}</span>{/if}
            <span class="t">{n.title}</span>
            {#if n.period}
              <small class="period">{fmtPeriodFull(n.period)}</small>
            {:else}
              <small>{fmtPostDate(n.created_at)}</small>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
    {#if pages > 1}
      <nav class="pg" aria-label="소식 쪽">
        <button
          type="button"
          aria-label="이전 쪽"
          disabled={page <= 1 || loading}
          onclick={() => load(page - 1)}>‹</button
        >
        {#each nums as n}
          <button
            type="button"
            class:on={n === page}
            aria-current={n === page ? "page" : undefined}
            disabled={loading}
            onclick={() => load(n)}>{n}</button
          >
        {/each}
        <button
          type="button"
          aria-label="다음 쪽"
          disabled={page >= pages || loading}
          onclick={() => load(page + 1)}>›</button
        >
      </nav>
    {/if}
  {/if}
</div>

<style>
  .nl-tools {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 6px;
  }
  .sm {
    padding: 5px 12px;
    font-size: 0.85rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    container-type: inline-size;
  }
  ul.dim {
    opacity: 0.55;
  }
  li + li {
    border-top: 1px solid var(--color-rule);
  }
  li button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 46px;
    padding: 8px 4px;
    border: 0;
    background: none;
    font: inherit;
    text-align: left;
    color: var(--color-ink);
    cursor: pointer;
  }
  li button:hover .t {
    color: var(--color-primary);
  }
  li.on button {
    background: var(--color-primary-bg);
  }
  li.on .t {
    color: var(--color-primary);
  }
  .t {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    font-size: 1rem;
  }
  /* 배지: 메인 '공지·일정·소식'(NewsRows)과 같은 모양 — 둥근 테두리형, 바탕 없음 (2026-11-16) */
  .tag {
    flex: none;
    font-size: 0.8rem;
    line-height: 1.35;
    padding: 0 7px;
    border: 1px solid currentColor;
    border-radius: 999px;
    background: transparent;
    color: var(--color-primary);
    font-weight: 600;
    white-space: nowrap;
  }
  .sched {
    color: var(--color-secondary);
  }
  small {
    flex: none;
    color: var(--color-muted);
    font-size: 0.88rem;
  }
  small.period {
    color: var(--color-secondary);
    font-weight: 700;
  }
  /* 숨긴 글 — 오리알터 피드(OrialterFeed .post.is-hidden·.hidden-tag)와 같은 표시 (2026-11-28) */
  .is-hidden {
    opacity: 0.72;
    outline: 2px dashed var(--color-rule);
    outline-offset: -2px;
  }
  .hidden-tag {
    flex: none;
    display: inline-block;
    padding: 0 7px;
    border-radius: 999px;
    background: var(--color-ink);
    color: #fff;
    font-size: 0.72rem;
    font-weight: 700;
    line-height: 18px;
    vertical-align: 1px;
  }
  .state {
    margin: 0;
    padding: 20px 0;
    color: var(--color-muted);
    text-align: center;
  }
  .state.err {
    color: var(--color-primary);
  }
  .pg {
    display: flex;
    justify-content: center;
    gap: 4px;
    padding: 12px 0 4px;
  }
  .pg button {
    min-width: 32px;
    height: 32px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: none;
    font: inherit;
    font-size: 0.9rem;
    color: var(--color-fg);
    cursor: pointer;
  }
  .pg button:hover:not(:disabled) {
    border-color: var(--color-rule);
  }
  .pg button.on {
    border-color: var(--color-ink);
    font-weight: 700;
  }
  .pg button:disabled:not(.on) {
    color: var(--color-faint);
    cursor: default;
  }
  /* 좁은 폭(모바일 소식 탭·좁은 팝업): 요일 붙은 날짜가 제목을 밀어내지 않게 날짜를 아랫줄로 (2026-11-27) */
  @container (max-width: 520px) {
    li button {
      flex-wrap: wrap;
      row-gap: 2px;
    }
    .t {
      flex: 1 1 0;
    }
    small {
      flex-basis: 100%;
      padding-left: 2px;
    }
  }
</style>
