<script lang="ts">
  // 오리알터 회원 — 최근 글을 올린 회원. 고르면 그 회원 글만 보도록 피드에 필터를 건다.
  // mode="box": 사이드 상자(최근 10명 + 전체 보기), mode="list": 모달 목록(더보기).
  // 복원(2026-11-01): 배포본 SSR(CommunityHome 청크)·클라이언트(_astro/OrialterMembers.*.js) 기준.
  import { onMount } from "svelte";
  import { api, ORIALTER_FILTER_EVENT } from "../../lib/api";
  import { BRANCHES } from "../../data/branches";

  let { mode = "list" }: { mode?: "box" | "list" } = $props();

  const PAGE = 10;
  let authors = $state<any[]>([]);
  let hasMore = $state(false);
  let loading = $state(false);
  let current = $state<string | null>(null);

  const branchName = (code: string | null | undefined) => BRANCHES.find((b) => b.code === code)?.name ?? null;

  async function more() {
    loading = true;
    try {
      const r = await api.listAuthors("orialter", authors.length, PAGE);
      authors = [...authors, ...r.authors];
      hasMore = r.has_more;
    } catch {
      hasMore = false;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    current = new URLSearchParams(location.search).get("author");
    more();
    const onFilter = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d.keepAuthor) current = d.author ?? null;
    };
    window.addEventListener(ORIALTER_FILTER_EVENT, onFilter);
    return () => window.removeEventListener(ORIALTER_FILTER_EVENT, onFilter);
  });

  function pick(a: any) {
    const off = current === a.id;
    window.dispatchEvent(
      new CustomEvent(ORIALTER_FILTER_EVENT, {
        detail: off
          ? { author: undefined }
          : { author: a.id, name: a.display_name ?? "회원", avatar: a.avatar_url },
      }),
    );
    if (!off) window.scrollTo({ top: 0, behavior: "smooth" });
  }
</script>

{#snippet rows()}
  <ul>
    {#each authors as a (a.id)}
      <li>
        <button
          type="button"
          aria-pressed={current === a.id}
          class:on={current === a.id}
          onclick={() => pick(a)}
        >
          {#if a.avatar_url}
            <img class="av" src={a.avatar_url} alt="" />
          {:else}
            <span class="av initial" aria-hidden="true">{(a.display_name ?? "회").slice(0, 1)}</span>
          {/if}
          <span class="nm">{a.display_name ?? "회원"}</span>
          {#if branchName(a.branch)}<small>{branchName(a.branch)}</small>{/if}
        </button>
      </li>
    {/each}
  </ul>
{/snippet}

{#if mode === "box"}
  {#if authors.length}
    <section class="lib-sec members" aria-labelledby="om-h">
      <h2 id="om-h">
        회원
        <button
          type="button"
          class="more-link"
          onclick={() =>
            window.dispatchEvent(new CustomEvent("jb:section-open", { detail: { key: "members" } }))}
          >전체 보기 ›</button
        >
      </h2>
      {@render rows()}
    </section>
  {/if}
{:else if authors.length}
  <div class="members list">
    {@render rows()}
    {#if hasMore}
      <button type="button" class="btn btn-ghost more" disabled={loading} onclick={more}
        >{loading ? "불러오는 중…" : "더보기"}</button
      >
    {/if}
  </div>
{:else if !loading}
  <p class="empty">아직 글을 올린 회원이 없습니다.</p>
{/if}

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 6px 0;
  }
  li button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 4px;
    border: 0;
    border-radius: var(--radius-md);
    background: none;
    font: inherit;
    color: var(--color-ink);
    text-align: left;
    cursor: pointer;
  }
  li button:hover {
    background: var(--color-bg);
  }
  li button.on {
    background: var(--color-primary-bg);
    color: var(--color-primary);
  }
  .av {
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    object-fit: cover;
  }
  .initial {
    display: grid;
    place-items: center;
    background: var(--color-secondary-bg);
    color: var(--color-secondary);
    font-weight: 700;
    font-size: 0.9rem;
  }
  .nm {
    font-weight: 600;
    font-size: 0.93rem;
  }
  small {
    color: var(--color-muted);
    font-size: 0.8rem;
  }
  .more-link {
    margin-left: auto;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-family: var(--font-body);
    font-size: 0.82rem;
    font-weight: 400;
    color: var(--color-muted);
    cursor: pointer;
  }
  .more-link:hover {
    color: var(--color-primary);
  }
  .empty {
    margin: 0;
    padding: 24px 0;
    text-align: center;
    color: var(--color-muted);
  }
  .more {
    width: 100%;
    justify-content: center;
    margin: 4px 0 8px;
    padding: 7px 0;
  }
</style>
