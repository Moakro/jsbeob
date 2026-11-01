<script lang="ts">
  // 소식 모달 — 'jb:news-open' 이벤트로 열고, 글 + 소식 목록을 함께 보인다. syncUrl 이면 주소를 글 주소로 바꾼다.
  // 복원(2026-11-01): 배포본 SSR(NewsRows 청크)·클라이언트(_astro/NewsModal.*.js) 기준.
  import { onMount, tick } from "svelte";
  import { api, fmtPeriodFull, NEWS_OPEN_EVENT, postHref, type MeUser, type PostDetail } from "../../lib/api";
  import ModalFrame from "../ModalFrame.svelte";
  import NewsList from "./NewsList.svelte";

  let { openId = null, syncUrl = false }: { openId?: string | null; syncUrl?: boolean } = $props();

  let open = $state(false);
  let id = $state<string | null>(null);
  let post = $state<PostDetail | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let me = $state<MeUser | null>(null);
  let returnUrl = "";
  let root = $state<HTMLElement | undefined>(undefined);

  const when = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  };

  async function show(next: string | null) {
    if (!open)
      // 닫을 때 돌아갈 주소. 글 주소로 바로 들어왔거나 PC 의 #news 면 도생광장으로.
      returnUrl =
        (syncUrl && openId && next === openId) ||
        (location.hash === "#news" && matchMedia("(min-width: 861px)").matches)
          ? `/community/${location.search}`
          : location.pathname + location.search + location.hash;
    open = true;
    id = next;
    post = null;
    error = null;
    if (syncUrl) history.replaceState(history.state, "", next ? postHref("news", next) : returnUrl);
    await tick();
    root?.closest(".mf-back")?.scrollTo({ top: 0 });
    if (!next) return;
    loading = true;
    try {
      const r = await api.getPost(next);
      if (id === next) post = r.post;
    } catch (e) {
      if (id === next) error = e instanceof Error ? e.message : "글을 불러오지 못했습니다";
    } finally {
      loading = false;
    }
  }

  function close() {
    open = false;
    if (syncUrl) history.replaceState(history.state, "", returnUrl);
  }

  onMount(() => {
    const onOpen = (e: Event) => show((e as CustomEvent).detail?.id ?? null);
    window.addEventListener(NEWS_OPEN_EVENT, onOpen);
    api
      .me()
      .then((r) => (me = r.user))
      .catch(() => {});
    if (openId) show(openId);
    else if (syncUrl && location.hash === "#news" && matchMedia("(min-width: 861px)").matches) show(null);
    return () => window.removeEventListener(NEWS_OPEN_EVENT, onOpen);
  });
</script>

<ModalFrame {open} onclose={close} label="소식" title="소식">
  <div class="nm" bind:this={root}>
    {#if id}
      {#if loading}
        <p class="state">불러오는 중…</p>
      {:else if error || !post}
        <p class="state err">{error ?? "글을 찾을 수 없습니다."}</p>
      {:else}
        <article class="nv">
          {#if post.period}<p class="period">{fmtPeriodFull(post.period)}</p>{/if}
          <h1>
            {#if post.is_pinned}<span class="tag notice">공지</span>{/if}
            {#if post.period}<span class="tag sched">일정</span>{/if}
            <span class="tt">{post.title}</span>
          </h1>
          <p class="by">
            <span>{when(post.created_at)}</span>
            <span>조회 {post.view_count}</span>
            {#if (me?.level ?? 0) >= 4}<a href={`${postHref("news", post.id)}edit/`}>수정</a>{/if}
          </p>
          <div class="body">{@html post.body_html}</div>
        </article>
      {/if}
    {/if}
    <div class="list" class:under={!!id}>
      <NewsList current={id} onpick={(x) => show(x)} />
    </div>
  </div>
</ModalFrame>

<style>
  .nm {
    --nm-pad: 20px;
    padding: 8px var(--nm-pad) 16px;
  }
  .state {
    margin: 0;
    padding: 24px 0;
    text-align: center;
    color: var(--color-muted);
  }
  .state.err {
    color: var(--color-primary);
  }
  .nv {
    padding: 12px 0 8px;
  }
  .period {
    display: inline-block;
    margin: 0 0 10px;
    padding: 5px 12px;
    border-radius: var(--radius-sm);
    background: var(--color-secondary);
    color: #fff;
    font-size: 1.05rem;
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  h1 {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 0 0 8px;
    font-size: 1.4rem;
    line-height: 1.35;
  }
  .tag {
    flex: none;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
    font-weight: 700;
    line-height: 1.4;
  }
  .notice {
    background: var(--color-primary);
    color: #fff;
  }
  .sched {
    background: var(--color-secondary);
    color: #fff;
  }
  .tt {
    min-width: 0;
  }
  .by {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin: 0 0 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--color-rule);
    color: var(--color-muted);
    font-size: 0.92rem;
  }
  .by a {
    margin-left: auto;
    color: var(--color-muted);
  }
  .body {
    font-size: 1.02rem;
    line-height: 1.8;
    word-break: break-word;
  }
  .nv .body :global(.blk-image),
  .nv .body :global(.blk-video) {
    margin-inline: calc(-1 * var(--nm-pad));
  }
  .nv .body :global(.blk-image:not(.blk-gallery)) > :global(img) {
    width: 100%;
  }
  .nv .body :global(.blk-image) :global(img),
  .nv .body :global(.blk-grid) :global(img),
  .nv .body :global(.blk-video-frame) {
    border-radius: 0;
  }
  .nv .body :global(.blk-image) :global(figcaption),
  .nv .body :global(.blk-video) :global(figcaption) {
    padding-inline: var(--nm-pad);
  }
  .list.under {
    margin-top: 20px;
    padding-top: 8px;
    border-top: 2px solid var(--color-rule);
  }
  @media (max-width: 760px) {
    .nm {
      --nm-pad: 16px;
    }
  }
</style>
