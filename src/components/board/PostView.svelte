<script lang="ts">
  // 게시글 보기 + 댓글. 자료실 게시물이면 시리즈 목차 상자를 위·아래에 보인다.
  // 복원(2026-11-01): 9월 버전을 배포본 클라이언트(_astro/PostView.*.js) 기준으로 갱신.
  import { onMount } from "svelte";
  import { api, BOARDS, boardBase, postHref, type PostDetail, type MeUser } from "../../lib/api";
  import YouTubeEmbed from "./YouTubeEmbed.svelte";
  import SeriesBox from "./SeriesBox.svelte";

  let {
    id,
    board,
    crumbs = true,
    series = null,
  }: {
    id: string;
    board: string;
    crumbs?: boolean;
    series?: { title: string; items: { id: string; title: string; href: string; on?: boolean }[] } | null;
  } = $props();
  const meta = BOARDS[board];

  let post = $state<PostDetail | null>(null);
  let me = $state<MeUser | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // 댓글
  let comments = $state<any[]>([]);
  let commentText = $state("");
  let posting = $state(false);

  const canEdit = $derived(!!me && !!post && (me.id === post.author_id || (me.level ?? 0) >= 4));
  const canComment = $derived(!!me && !!me.display_name);
  /** 상단 고정은 운영자가 탭 보드(소식·오리알터)에서만 */
  const canPin = $derived(!!me && (me.level ?? 0) >= 4 && !!meta?.tab);

  let pinning = $state(false);
  async function togglePin() {
    if (!post) return;
    pinning = true;
    try {
      const r = await api.pinPost(id);
      post = { ...post, is_pinned: r.is_pinned };
    } catch (e) {
      alert(e instanceof Error ? e.message : "고정 실패");
    } finally {
      pinning = false;
    }
  }

  function fmt(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  async function loadComments() {
    try {
      const res = await fetch(`/api/comments?target=post:${id}`, { credentials: "same-origin" });
      const data = await res.json();
      comments = data.comments ?? [];
    } catch {
      comments = [];
    }
  }

  onMount(async () => {
    try {
      me = (await api.me()).user;
    } catch {}
    try {
      post = (await api.getPost(id)).post;
      await loadComments();
    } catch (e) {
      error = e instanceof Error ? e.message : "불러오기 실패";
    } finally {
      loading = false;
    }
  });

  async function submitComment(e: Event) {
    e.preventDefault();
    const text = commentText.trim();
    if (!text) return;
    posting = true;
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: `post:${id}`, body: text, type: "memo" }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "댓글 등록 실패");
      }
      commentText = "";
      await loadComments();
    } catch (err) {
      alert(err instanceof Error ? err.message : "댓글 등록 실패");
    } finally {
      posting = false;
    }
  }

  async function remove() {
    if (!confirm("이 글을 삭제하시겠습니까?")) return;
    try {
      await api.deletePost(id);
      window.location.href = `${boardBase(board, post?.category)}/`;
    } catch (e) {
      alert(e instanceof Error ? e.message : "삭제 실패");
    }
  }
</script>

{#if loading}
  <p class="state">불러오는 중…</p>
{:else if error || !post}
  <p class="state err">{error ?? "글을 찾을 수 없습니다."}</p>
{:else}
  <article class="post">
    {#if crumbs}
      <nav class="crumbs">
        <a href={meta?.parent?.href ?? "/community/"}>{meta?.parent?.label ?? "도생광장"}</a><span>/</span>
        <a href={`${boardBase(board, post.category)}/`}>{meta?.label ?? board}</a>
      </nav>
    {/if}
    <header class="post-head">
      <h1>{post.title}</h1>
      <div class="byline">
        <span class="author">{post.author.display_name ?? "회원"}</span>
        <span>{fmt(post.created_at)}</span>
        <span>조회 {post.view_count}</span>
      </div>
      {#if canEdit || canPin}
        <div class="actions">
          {#if canPin}
            <button
              class="btn btn-ghost"
              class:on={post.is_pinned}
              disabled={pinning}
              aria-pressed={post.is_pinned}
              onclick={togglePin}>{post.is_pinned ? "상단 고정 해제" : "상단 고정"}</button
            >
          {/if}
          {#if canEdit}
            <a class="btn btn-ghost" href={`${postHref(board, id, post.category)}edit/`}>수정</a>
            <button class="btn btn-ghost danger" onclick={remove}>삭제</button>
          {/if}
        </div>
      {/if}
    </header>

    {#if series && series.items.length}
      <SeriesBox title={series.title} items={series.items} />
    {/if}

    <div class="prose">{@html post.body_html}</div>

    <!-- 블록 본문(has_blocks)은 사진·영상이 본문 안에 있다 — 예전 글만 첨부를 따로 보인다 -->
    {#if post.attachments.length && !post.has_blocks}
      <div class="attachments">
        {#each post.attachments as a}
          {#if a.type === "image" && a.url}
            <img src={a.url} alt="" loading="lazy" />
          {:else if a.type === "video" && a.videoId}
            <YouTubeEmbed videoId={a.videoId} title={post.title} />
          {/if}
        {/each}
      </div>
    {/if}

    {#if series && series.items.length}
      <SeriesBox title={series.title} items={series.items} where="bottom" />
    {/if}

    <!-- 댓글 -->
    <section class="comments">
      <h2>댓글 <span>{comments.length}</span></h2>
      {#if canComment}
        <form class="comment-form" onsubmit={submitComment}>
          <textarea bind:value={commentText} placeholder="댓글을 남겨보세요" rows="2"></textarea>
          <button class="btn btn-primary" disabled={posting || !commentText.trim()}>
            {posting ? "등록 중…" : "등록"}
          </button>
        </form>
      {:else}
        <p class="login-hint">댓글을 쓰려면 로그인하세요.</p>
      {/if}
      <ul class="comment-list">
        {#each comments as c (c.id)}
          <li>
            <div class="c-head">
              <strong>{c.author?.display_name ?? "회원"}</strong>
              <span>{fmt(c.created_at)}</span>
            </div>
            <div class="c-body">{@html c.body_html}</div>
          </li>
        {/each}
      </ul>
    </section>
  </article>
{/if}

<style>
  .state {
    color: var(--color-muted);
    text-align: center;
    padding: 40px 0;
  }
  .state.err {
    color: var(--color-primary);
  }
  .post {
    max-width: 760px;
  }
  .crumbs {
    display: flex;
    gap: 8px;
    font-size: 0.86rem;
    color: var(--color-muted);
    margin-bottom: 12px;
  }
  .post-head {
    margin: 0 0 20px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--color-rule);
  }
  .post-head h1 {
    font-size: 1.6rem;
    line-height: 1.3;
    margin: 0 0 8px;
  }
  .byline {
    display: flex;
    gap: 14px;
    color: var(--color-muted);
    font-size: 0.88rem;
  }
  .byline .author {
    color: var(--color-fg);
    font-weight: 600;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
  .actions .on {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }
  .actions .danger:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }
  .prose :global(p) {
    margin: 0 0 1em;
    line-height: 1.9;
  }
  .attachments {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin: 24px 0;
  }
  .attachments img {
    width: 100%;
    border-radius: var(--radius-md);
  }
  .comments {
    margin-top: 40px;
    border-top: 1px solid var(--color-rule);
    padding-top: 24px;
  }
  .comments h2 {
    font-size: 1.2rem;
  }
  .comments h2 span {
    color: var(--color-primary);
  }
  .comment-form {
    display: flex;
    gap: 10px;
    align-items: flex-end;
    margin-bottom: 20px;
  }
  .comment-form textarea {
    flex: 1;
    padding: 10px 14px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    font-family: inherit;
    font-size: 0.95rem;
    resize: vertical;
  }
  .login-hint {
    color: var(--color-muted);
    background: var(--color-surface-2);
    padding: 14px;
    border-radius: var(--radius-md);
  }
  .comment-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .comment-list li {
    border-bottom: 1px solid var(--color-rule);
    padding-bottom: 14px;
  }
  .c-head {
    display: flex;
    gap: 10px;
    align-items: baseline;
    margin-bottom: 4px;
  }
  .c-head span {
    color: var(--color-muted);
    font-size: 0.8rem;
  }
  .c-body :global(p) {
    margin: 0;
  }
</style>
