<script lang="ts">
  import { onMount } from "svelte";
  import { api, BOARDS, type PostDetail, type MeUser } from "../../lib/api";
  import YouTubeEmbed from "./YouTubeEmbed.svelte";

  let { id, board }: { id: string; board: string } = $props();
  const meta = BOARDS[board];

  let post = $state<PostDetail | null>(null);
  let me = $state<MeUser | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // 댓글
  let comments = $state<any[]>([]);
  let commentText = $state("");
  let posting = $state(false);

  const canEdit = $derived(
    !!me && !!post && (me.id === post.author_id || (me.level ?? 0) >= 4),
  );
  const canComment = $derived(!!me && !!me.display_name);

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
      window.location.href = `/community/${board}/`;
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
    <nav class="crumbs">
      <a href="/community/">소식·커뮤니티</a><span>/</span>
      <a href={`/community/${board}/`}>{meta?.label ?? board}</a>
    </nav>

    <header class="post-head">
      <h1>{post.title}</h1>
      <div class="byline">
        <span class="author">{post.author.display_name ?? "회원"}</span>
        <span>{fmt(post.created_at)}</span>
        <span>조회 {post.view_count}</span>
      </div>
      {#if canEdit}
        <div class="actions">
          <a class="btn btn-ghost" href={`/community/${board}/${id}/edit/`}>수정</a>
          <button class="btn btn-ghost danger" onclick={remove}>삭제</button>
        </div>
      {/if}
    </header>

    <div class="prose">{@html post.body_html}</div>

    {#if post.attachments.length}
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
    margin-inline: auto;
  }
  .crumbs {
    display: flex;
    gap: 8px;
    font-size: 0.86rem;
    color: var(--color-muted);
    margin-bottom: 12px;
  }
  .post-head {
    border-bottom: 2px solid var(--color-ink);
    padding-bottom: 16px;
    margin-bottom: 24px;
  }
  .post-head h1 {
    font-size: 1.9rem;
    margin: 0 0 10px;
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
