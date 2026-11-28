<script lang="ts">
  import { LEVEL } from "../../data/levels";
  // 게시글 보기 + 댓글. 자료실 게시물이면 시리즈 목차 상자를 위·아래에 보인다.
  // 복원(2026-11-01): 9월 버전을 배포본 클라이언트(_astro/PostView.*.js) 기준으로 갱신.
  import { onMount, tick } from "svelte";
  import { api, BOARDS, boardBase, postHref, type BoardConfig, type PostDetail, type MeUser } from "../../lib/api";
  import YouTubeEmbed from "./YouTubeEmbed.svelte";
  import SeriesBox from "./SeriesBox.svelte";
  import PublishToggle from "./PublishToggle.svelte";

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

  // 수정·삭제·댓글 권한은 게시판 설정에서 (2026-11-16 게시판 관리)
  let cfg = $state<BoardConfig | null>(null);
  const lv = $derived(me?.level ?? 0);
  const isAdmin = $derived(lv >= LEVEL.ADMIN);
  const canEdit = $derived(
    !!me && !!post && (isAdmin || (!!cfg && ((cfg.edit_own && me.id === post.author_id) || lv >= cfg.edit_level))),
  );
  const canDelete = $derived(
    !!me && !!post && (isAdmin || (!!cfg && ((cfg.delete_own && me.id === post.author_id) || lv >= cfg.delete_level))),
  );
  const commentsOn = $derived(!cfg || cfg.comment_level !== null);
  const canComment = $derived(
    !!me && !!me.display_name && !!cfg && cfg.comment_level !== null && (isAdmin || lv >= cfg.comment_level),
  );
  /** 상단 고정은 관리자가 공지를 쓰는 게시판(소식 등)·탭 보드에서만 */
  const canPin = $derived(isAdmin && (!!cfg?.options?.notice || !!meta?.tab));

  // ── 글마다 비공개 (2026-11-21) ──
  /** 볼 수 없는 비공개 글 — 등록일시만 */
  let locked = $state<{ created_at: string } | null>(null);
  const privateOn = $derived(!!cfg?.options?.private_posts);
  const isAuthor = $derived(!!me && !!post && me.id === post.author_id);
  /** 상단 비공개 상자: 글쓴이는 양쪽으로, 관리자는 남의 공개 글을 비공개로만 */
  const showPrivacyBox = $derived(privateOn && !!post && (isAuthor || isAdmin));
  const canTogglePrivate = $derived(!!post && (isAuthor || (isAdmin && !post.is_private)));
  let savingPrivate = $state(false);
  let privateError = $state<string | null>(null);
  async function togglePrivate(e: Event) {
    if (!post) return;
    const box = e.currentTarget as HTMLInputElement;
    const want = box.checked;
    const before = !!post.is_private;
    post = { ...post, is_private: want }; // 먼저 바꿔 보이고, 실패하면 되돌린다
    savingPrivate = true;
    privateError = null;
    try {
      const r = await api.setPostPrivate(id, want);
      post = { ...post, is_private: r.is_private };
    } catch (err) {
      post = { ...post, is_private: before };
      box.checked = before;
      privateError = err instanceof Error ? err.message : "저장하지 못했습니다";
    } finally {
      savingPrivate = false;
    }
  }

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
      cfg = (await api.board(board)).board;
    } catch {}
    try {
      const r = await api.getPostOrLocked(id);
      if ("locked" in r) locked = r.locked;
      else {
        post = r.post;
        await loadComments();
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "불러오기 실패";
    } finally {
      loading = false;
    }
    // 달력·다가오는 날에서 일정을 눌러 #b-블록번호 로 들어오면 그 일정 카드로 이동·강조 (2026-11-16)
    if (post && location.hash.startsWith("#b-")) {
      await tick();
      const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (el) {
        el.scrollIntoView({ block: "center" });
        if (el.classList.contains("blk-schedule")) el.classList.add("hl");
      }
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
{:else if locked}
  <div class="locked-post">
    <p class="lock-title"><span class="lock">🔒 비공개</span> 비공개 글입니다.</p>
    <p class="dim">글쓴이와 운영자만 볼 수 있습니다.{locked.created_at ? ` · 등록 ${fmt(locked.created_at)}` : ""}</p>
    {#if !me}
      <p class="dim"><a href={`/login/?next=${encodeURIComponent(location.pathname)}`}>로그인</a>하면 내가 쓴 글을 볼 수 있습니다.</p>
    {/if}
    <p><a href={`${boardBase(board)}/`}>← {cfg?.label ?? meta?.label ?? "목록"}으로</a></p>
  </div>
{:else if error || !post}
  <p class="state err">{error ?? "글을 찾을 수 없습니다."}</p>
{:else}
  <article class="post">
    {#if crumbs}
      <nav class="crumbs">
        <a href={meta?.parent?.href ?? "/community/"}>{meta?.parent?.label ?? "도생광장"}</a><span>/</span>
        <a href={`${boardBase(board, post.category)}/`}>{cfg?.label ?? meta?.label ?? board}</a>
      </nav>
    {/if}
    {#if showPrivacyBox}
      <!-- 비공개 전환 — 글쓴이(양쪽)·관리자(비공개로만). 바로 저장 (2026-11-21) -->
      <div class="privacy" class:is-private={post.is_private} role="group" aria-label="공개 설정">
        <p class="pv-state">
          {#if post.is_private}
            🔒 비공개 글입니다. {isAuthor ? "나와" : "글쓴이와"} 운영자만 봅니다.
          {:else}
            🌐 이 글은 모두에게 공개되어 있습니다.
          {/if}
        </p>
        <label class="pv-check" class:disabled={!canTogglePrivate}>
          <input
            type="checkbox"
            checked={post.is_private}
            disabled={!canTogglePrivate || savingPrivate}
            onchange={togglePrivate}
          />
          비공개로 하기 — {isAuthor ? "나와" : "글쓴이와"} 운영자만 볼 수 있습니다
          {#if savingPrivate}<small>저장 중…</small>{/if}
        </label>
        {#if isAdmin && !isAuthor && post.is_private}
          <small class="pv-note">비공개 글은 글쓴이만 공개로 되돌릴 수 있습니다.</small>
        {/if}
        {#if privateError}<small class="pv-err">{privateError}</small>{/if}
      </div>
    {/if}
    <header class="post-head">
      <h1>{#if post.is_private && !showPrivacyBox}<span class="lock">🔒 비공개</span> {/if}{post.title}</h1>
      <div class="byline">
        <span class="author">{post.author.display_name ?? "회원"}</span>
        {#if post.registered_by}<span class="reg" title="권한자에게만 보입니다">등록 {post.registered_by}</span>{/if}
        <span>{fmt(post.created_at)}</span>
        <span>조회 {post.view_count}</span>
      </div>
      {#if canEdit || canDelete || canPin}
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
          {/if}
          {#if canDelete}
            <button class="btn btn-ghost danger" onclick={remove}>삭제</button>
          {/if}
        </div>
      {/if}
    </header>
    <PublishToggle {post} {me} onchange={(h) => post && (post = { ...post, is_hidden: h })} />

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

    <!-- 댓글 (게시판 설정에서 댓글을 끄면 숨긴다) -->
    <section class="comments" hidden={!commentsOn}>
      <h2>댓글 <span>{comments.length}</span></h2>
      {#if canComment}
        {#if privateOn && isAdmin && !post.is_private}
          <!-- 공개 문의의 답변은 누구나 본다 — 운영자가 개인 정보를 적지 않도록 -->
          <p class="pv-note">공개 글입니다. 답변도 모두에게 보입니다.</p>
        {/if}
        <form class="comment-form" onsubmit={submitComment}>
          <textarea bind:value={commentText} placeholder="댓글을 남겨보세요" rows="2"></textarea>
          <button class="btn btn-primary" disabled={posting || !commentText.trim()}>
            {posting ? "등록 중…" : "등록"}
          </button>
        </form>
      {:else}
        <p class="login-hint">{me ? "이 게시판에 댓글을 쓸 권한이 없습니다." : "댓글을 쓰려면 로그인하세요."}</p>
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
  .lock {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-muted);
    font-size: 0.72rem;
    font-weight: 600;
    vertical-align: 3px;
  }
  .locked-post {
    max-width: 760px;
    padding: 48px 0;
    text-align: center;
  }
  .locked-post .lock-title {
    font-size: 1.1rem;
    font-weight: 700;
  }
  .locked-post .dim {
    color: var(--color-muted);
  }
  .privacy {
    display: grid;
    gap: 6px;
    margin: 0 0 18px;
    padding: 14px 16px;
    border: 2px solid var(--color-primary);
    border-radius: var(--radius-md);
    background: var(--color-primary-bg);
  }
  .privacy.is-private {
    border-color: var(--color-rule);
    background: var(--color-surface-2);
  }
  .pv-state {
    margin: 0;
    font-weight: 700;
  }
  .pv-check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.95rem;
    cursor: pointer;
  }
  .pv-check input {
    width: 20px;
    height: 20px;
    accent-color: var(--color-primary);
  }
  .pv-check.disabled {
    cursor: default;
    color: var(--color-muted);
  }
  .pv-note {
    color: var(--color-muted);
    font-size: 0.85rem;
  }
  .pv-err {
    color: var(--color-primary);
    font-size: 0.85rem;
  }
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
  /* 공식 글 실제 등록자 (권한자에게만) */
  .reg {
    color: var(--color-muted);
    font-size: 0.85em;
  }
</style>
