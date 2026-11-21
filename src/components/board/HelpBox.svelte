<script lang="ts">
  // 도생광장 오른쪽 '문의' 상자 (2026-11-21) — 최근 문의 3건과 '문의하기'.
  // 공개 문의는 제목과 답변 여부, 비공개 문의는 볼 수 없는 사람에게 배지와 등록일시만(API 가 가려서 준다).
  // 관리자에게는 최근 문의 가운데 답변(댓글)이 없는 글 수를 '답변 대기'로 보인다.
  import { onMount } from "svelte";
  import { LEVEL } from "../../data/levels";
  import { api, boardBase, postHref, type MeUser, type PostSummary } from "../../lib/api";

  /** 제목 id — PC 상자와 모바일 소식 탭에 하나씩 놓이므로 따로 받는다 */
  let { hid = "cm-help-h" }: { hid?: string } = $props();
  const BOARD = "help";
  const SHOW = 3;
  let posts = $state<PostSummary[]>([]);
  let me = $state<MeUser | null>(null);
  let ready = $state(false);
  const isAdmin = $derived((me?.level ?? 0) >= LEVEL.ADMIN);
  /** 관리자: 불러온 최근 문의 가운데 답변이 없는 글 */
  const waiting = $derived(posts.filter((p) => !p.locked && p.comment_count === 0).length);
  const base = boardBase(BOARD);
  const writeHref = $derived(me ? `${base}/write/` : `/login/?next=${encodeURIComponent(`${base}/write/`)}`);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  onMount(async () => {
    try {
      me = (await api.me()).user;
    } catch {}
    try {
      posts = (await api.listPosts({ board: BOARD, limit: isAdmin ? 20 : SHOW })).posts;
    } catch {
      posts = [];
    }
    ready = true;
  });
</script>

<h2 id={hid}>
  <a class="h-link" href={`${base}/`}>문의</a>
  <a class="more" href={`${base}/`}>전체 보기 ›</a>
</h2>
{#if isAdmin && waiting > 0}
  <p class="hb-admin">답변 대기 <strong>{waiting}</strong>건 <small>(최근 {posts.length}건 중)</small></p>
{/if}
{#if ready && posts.length}
  <ul class="hb-list">
    {#each posts.slice(0, SHOW) as p (p.id)}
      <li>
        {#if p.locked}
          <span class="hb-row locked">
            <span class="hb-t"><span class="lock">🔒 비공개</span></span>
            <span class="hb-m">{fmt(p.created_at)}</span>
          </span>
        {:else}
          <a class="hb-row" href={postHref(BOARD, p.id)}>
            <span class="hb-t">
              {#if p.is_private}<span class="lock">🔒</span>{/if}
              {p.title}
            </span>
            <span class="hb-m">
              {#if p.comment_count > 0}<span class="ans">답변 {p.comment_count}</span>{:else}<span class="wait">대기</span>{/if}
              · {fmt(p.created_at)}
            </span>
          </a>
        {/if}
      </li>
    {/each}
  </ul>
{:else if ready}
  <p class="hb-empty">궁금한 점이나 제안을 남겨 주세요. 비공개로 쓰면 글쓴이와 운영자만 봅니다.</p>
{/if}
<a class="btn btn-ghost hb-write" href={writeHref}>문의하기</a>

<style>
  /* astro-island 안이라 .lib-sec > h2 공통 스타일이 닿지 않는다 — 같은 값으로 맞춘다 */
  h2 {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0;
    padding: 13px 0 11px;
    border-bottom: 1px solid var(--color-rule);
    font-size: 1.05rem;
  }
  .h-link {
    color: var(--color-ink);
    font-weight: 700;
  }
  .more {
    margin-left: auto;
    font-family: var(--font-body);
    font-size: 0.82rem;
    font-weight: 400;
    color: var(--color-muted);
  }
  .h-link:hover,
  .more:hover {
    color: var(--color-primary);
    text-decoration: none;
  }
  .hb-admin {
    margin: 12px 0 0;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    background: var(--color-primary-bg);
    color: var(--color-primary);
    font-size: 0.86rem;
  }
  .hb-admin small {
    color: var(--color-muted);
  }
  .hb-list {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
  }
  .hb-list li + li {
    border-top: 1px solid var(--color-rule);
  }
  .hb-row {
    display: grid;
    gap: 2px;
    padding: 9px 0;
    color: var(--color-ink);
  }
  a.hb-row:hover {
    text-decoration: none;
  }
  a.hb-row:hover .hb-t {
    color: var(--color-primary);
  }
  .hb-t {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.95rem;
  }
  .hb-m {
    color: var(--color-muted);
    font-size: 0.8rem;
  }
  .ans {
    color: var(--color-accent, #1f6f6a);
    font-weight: 600;
  }
  .wait {
    font-weight: 600;
  }
  .lock {
    display: inline-block;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-muted);
    font-size: 0.72rem;
    font-weight: 600;
  }
  .hb-empty {
    margin: 0;
    padding: 14px 0 6px;
    color: var(--color-muted);
    font-size: 0.9rem;
  }
  .hb-write {
    display: block;
    margin: 10px 0 8px;
    text-align: center;
  }
</style>
