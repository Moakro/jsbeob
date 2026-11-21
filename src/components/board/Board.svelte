<script lang="ts">
  import { LEVEL } from "../../data/levels";
  // 게시판 목록 — 문의(help)·자료실 기타 자료(etc) 등. 비공개 보드는 로그인해야 자기 글이 보인다.
  // 복원(2026-11-01): 9월 버전을 배포본 클라이언트(_astro/Board.*.js) 기준으로 갱신.
  import { onMount } from "svelte";
  import { api, BOARDS, boardBase, postHref, type BoardConfig, type PostSummary, type MeUser } from "../../lib/api";

  let { board }: { board: string } = $props();
  // 게시판 설정(DB) — 기본 게시판은 BOARDS 표시 정보와 함께 쓴다 (2026-11-16 게시판 관리)
  let cfg = $state<BoardConfig | null>(null);
  const meta = $derived({
    ...(BOARDS[board] ?? {}),
    private: cfg ? cfg.read_scope === "own" : BOARDS[board]?.private,
    photo: cfg ? !!cfg.options?.photo : BOARDS[board]?.photo,
  });

  let posts = $state<PostSummary[]>([]);
  let me = $state<MeUser | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let next = $state<string | null>(null);
  let hasMore = $state(false);
  let q = $state("");
  // '전체 | 내 글' 탭 — 글마다 비공개 게시판(문의)에서. 주소 ?mine=1 (계정 메뉴 '내 문의'가 쓴다, 2026-11-21)
  const hasMineTab = $derived(!!cfg?.options?.private_posts);
  let mine = $state(false);
  const tabLabel = $derived(cfg?.label ?? BOARDS[board]?.label ?? "글");

  const canWrite = $derived(
    !!me &&
      !!me.display_name &&
      !!cfg &&
      ((me.level ?? 0) >= LEVEL.ADMIN || (cfg.status === "active" && (me.level ?? 0) >= cfg.create_level)),
  );

  function fmtDate(iso: string): string {
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "방금";
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  }

  async function load(reset = true) {
    loading = true;
    error = null;
    try {
      const r = await api.listPosts({
        board,
        author: mine && me ? me.id : undefined,
        q: q || undefined,
        before: reset ? undefined : next || undefined,
        has_image: meta?.photo || undefined,
      });
      posts = reset ? r.posts : [...posts, ...r.posts];
      next = r.next;
      hasMore = r.has_more;
    } catch (e) {
      error = e instanceof Error ? e.message : "불러오기 실패";
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    try {
      me = (await api.me()).user;
    } catch {}
    try {
      cfg = (await api.board(board)).board;
    } catch {}
    mine = hasMineTab && new URLSearchParams(location.search).get("mine") === "1";
    if (mine && !me) {
      loading = false;
      return;
    }
    await load();
  });

  function setMine(v: boolean) {
    if (mine === v) return;
    mine = v;
    const u = new URL(location.href);
    if (v) u.searchParams.set("mine", "1");
    else u.searchParams.delete("mine");
    history.replaceState(history.state, "", u);
    posts = [];
    if (v && !me) return;
    load(true);
  }

  function search(e: Event) {
    e.preventDefault();
    load(true);
  }
</script>

<div class="board">
  {#if hasMineTab}
    <div class="tabs" role="tablist" aria-label={`${tabLabel} 보기`}>
      <button type="button" role="tab" aria-selected={!mine} class:on={!mine} onclick={() => setMine(false)}
        >전체 {tabLabel}</button
      >
      <button type="button" role="tab" aria-selected={mine} class:on={mine} onclick={() => setMine(true)}
        >내 {tabLabel}</button
      >
    </div>
  {/if}
  <div class="toolbar">
    <form class="search" onsubmit={search} hidden={meta?.private && !me}>
      <input type="search" bind:value={q} placeholder="검색" aria-label="게시글 검색" />
    </form>
    {#if canWrite}
      <a class="btn btn-primary write" href={`${boardBase(board)}/write/`}>＋ 글쓰기</a>
    {:else if !me && cfg && cfg.status === "active" && cfg.create_level < LEVEL.ADMIN}
      <!-- 비회원: 회원이 쓸 수 있는 게시판(문의 등)이면 로그인으로 안내 (2026-11-21) -->
      <a class="btn btn-ghost write" href={`/login/?next=${encodeURIComponent(`${boardBase(board)}/write/`)}`}>로그인하고 글쓰기</a>
    {/if}
  </div>

  {#if loading && posts.length === 0}
    <p class="state">불러오는 중…</p>
  {:else if error}
    <p class="state err">{error}</p>
  {:else if mine && !me}
    <p class="state">
      <a href={`/login/?next=${encodeURIComponent(`${boardBase(board)}/?mine=1`)}`}>로그인</a>하면 내가 남긴 {tabLabel}를 볼 수 있습니다.
    </p>
  {:else if meta?.private && !me}
    <p class="state">
      <a href={`/login/?next=${encodeURIComponent(`${boardBase(board)}/`)}`}>로그인</a>하면 문의를 남기고 답변을 볼 수 있습니다.
    </p>
  {:else if posts.length === 0 && mine}
    <p class="state">
      아직 남긴 {tabLabel}가 없습니다.
      {#if canWrite}<a href={`${boardBase(board)}/write/`}>{tabLabel}하기</a>{/if}
    </p>
  {:else if posts.length === 0}
    <p class="state">
      {meta?.private
        ? "남긴 문의가 없습니다."
        : `아직 글이 없습니다.${canWrite ? " 첫 글을 남겨보세요." : ""}`}
    </p>
  {:else if meta?.photo}
    <!-- 사진 피드 / 갤러리 그리드 -->
    <div class="photo-grid">
      {#each posts as p (p.id)}
        <a class="photo-card" href={postHref(board, p.id)}>
          {#if p.cover_image}
            <img src={p.cover_image} alt={p.title} loading="lazy" />
          {:else}
            <span class="no-img">{p.title.slice(0, 1)}</span>
          {/if}
          <span class="overlay">
            <strong>{p.title}</strong>
            <small>{p.author.display_name} · ♥ {p.comment_count}</small>
          </span>
        </a>
      {/each}
    </div>
  {:else}
    <!-- 목록형 -->
    <ul class="list">
      {#each posts as p (p.id)}
        {#if p.locked}
          <!-- 볼 수 없는 비공개 글 — 제목·글쓴이 없이 배지와 등록일시만 (2026-11-21) -->
          <li class="locked">
            <div class="row">
              <span class="title"><span class="lock">🔒 비공개</span> <span class="dim">비공개 글입니다</span></span>
              <span class="meta"><span>{fmtDate(p.created_at)}</span></span>
            </div>
          </li>
        {:else}
        <li class:pinned={p.is_pinned}>
          <a href={postHref(board, p.id)}>
            <span class="title">
              {#if p.is_pinned}<span class="pin">공지</span>{/if}
              {#if p.is_private}<span class="lock">🔒 비공개</span>{/if}
              {p.title}
              {#if p.comment_count > 0}<span class="cc">[{p.comment_count}]</span>{/if}
            </span>
            <span class="meta">
              <span>{p.author.display_name}</span>
              <span>{fmtDate(p.created_at)}</span>
              <span>조회 {p.view_count}</span>
            </span>
          </a>
        </li>
        {/if}
      {/each}
    </ul>
  {/if}

  {#if hasMore}
    <button class="btn btn-ghost more" onclick={() => load(false)} disabled={loading}>
      {loading ? "불러오는 중…" : "더 보기"}
    </button>
  {/if}
</div>

<style>
  .tabs {
    display: flex;
    gap: 0;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--color-rule);
  }
  .tabs button {
    padding: 10px 16px;
    border: 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    background: none;
    color: var(--color-muted);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .tabs button.on {
    color: var(--color-primary);
    border-bottom-color: var(--color-primary);
  }
  .toolbar {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 18px;
  }
  .search {
    flex: 1;
  }
  .search input {
    width: 100%;
    max-width: 280px;
    padding: 9px 14px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    font-size: 0.92rem;
  }
  .write {
    white-space: nowrap;
  }
  .state {
    color: var(--color-muted);
    padding: 32px 0;
    text-align: center;
  }
  .state.err {
    color: var(--color-primary);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--color-rule);
  }
  .list li {
    border-bottom: 1px solid var(--color-rule);
  }
  .list li.pinned {
    background: var(--color-primary-bg);
  }
  .list a {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    padding: 14px 12px;
    color: var(--color-ink);
  }
  .list a:hover {
    text-decoration: none;
    background: var(--color-surface);
  }
  .title {
    font-weight: 600;
  }
  .pin {
    color: var(--color-primary);
    font-weight: 700;
    font-size: 0.8rem;
    margin-right: 6px;
  }
  .lock {
    display: inline-block;
    margin-right: 4px;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-muted);
    font-size: 0.72rem;
    font-weight: 600;
    vertical-align: 1px;
  }
  .list li.locked .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 4px;
    color: var(--color-muted);
  }
  .list li.locked .dim {
    font-size: 0.92rem;
  }
  .cc {
    color: var(--color-primary);
    font-size: 0.85rem;
    margin-left: 4px;
  }
  .meta {
    display: flex;
    gap: 12px;
    color: var(--color-muted);
    font-size: 0.82rem;
    white-space: nowrap;
  }
  .photo-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 10px;
  }
  .photo-card {
    position: relative;
    aspect-ratio: 1;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--color-surface-2);
  }
  .photo-card img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .no-img {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    font-family: var(--font-display);
    font-size: 2rem;
    color: var(--color-faint);
  }
  .overlay {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: linear-gradient(transparent, #000000b3);
    color: #fff;
  }
  .overlay strong {
    font-size: 0.92rem;
  }
  .overlay small {
    font-size: 0.78rem;
    opacity: 0.85;
  }
  .more {
    display: block;
    margin: 22px auto 0;
  }
</style>
