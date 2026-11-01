<script lang="ts">
  // 오리알터 앨범 — 사진이 있는 글의 사진을 격자로. 누르면 그 글을 연다(jb:orialter-open).
  // 복원(2026-11-01): 배포본 SSR(CommunityHome 청크)·클라이언트(_astro/AlbumGrid.*.js) 기준.
  import { onMount } from "svelte";
  import { api } from "../../lib/api";

  const PAGE = 30;
  let photos = $state<{ id: string; url: string; key: string }[]>([]);
  let cursor: string | null = null;
  let done = $state(false);
  let loading = $state(false);

  /** 사진을 PAGE 장 더 모은다(글 20개씩 불러와 사진만 뽑는다). */
  async function more() {
    if (loading || done) return;
    loading = true;
    try {
      const want = photos.length + PAGE;
      const next = [...photos];
      while (next.length < want && !done) {
        const r = await api.listPosts({
          board: "orialter",
          has_image: true,
          limit: 20,
          before: cursor ?? undefined,
        });
        for (const p of r.posts)
          p.attachments.forEach((a, i) => {
            if (a.type === "image" && a.url) next.push({ id: p.id, url: a.url, key: `${p.id}:${i}` });
          });
        cursor = r.next;
        if (!r.next) done = true;
      }
      photos = next;
    } finally {
      loading = false;
    }
  }

  onMount(more);

  const openPost = (id: string) =>
    window.dispatchEvent(new CustomEvent("jb:orialter-open", { detail: { id } }));
</script>

{#if !photos.length && done}
  <p class="state">아직 올라온 사진이 없습니다.</p>
{:else}
  <ul class="ag">
    {#each photos as ph (ph.key)}
      <li>
        <button type="button" aria-label="사진이 있는 글 보기" onclick={() => openPost(ph.id)}>
          <img src={ph.url} alt="" loading="lazy" />
        </button>
      </li>
    {/each}
  </ul>
  {#if !done}
    <button type="button" class="btn btn-ghost more" disabled={loading} onclick={more}
      >{loading ? "불러오는 중…" : "더보기"}</button
    >
  {/if}
{/if}

<style>
  .ag {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }
  .ag button {
    display: block;
    width: 100%;
    aspect-ratio: 1;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--color-surface-2);
    cursor: pointer;
  }
  .ag img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .more {
    display: flex;
    width: 100%;
    justify-content: center;
    margin-top: 10px;
  }
  .state {
    margin: 0;
    padding: 24px 0;
    text-align: center;
    color: var(--color-muted);
  }
  @media (min-width: 761px) {
    .ag {
      grid-template-columns: repeat(4, 1fr);
    }
  }
</style>
