<script lang="ts">
  // 신고 목록(관리자, 2026-11-28) — 글·댓글별로 묶어 보여 주고 숨김·되살리기·문제없음으로 처리한다.
  // 숨김 = posts/comments.status 'hidden' — 피드·글 주소·공유 미리보기에서 빠지고 글쓴이·관리자만 본다.
  import { onMount } from "svelte";
  import { api, fullTime, type ReportGroup } from "../../lib/api";

  let { onchange }: { onchange?: (open: number) => void } = $props();

  let list = $state<ReportGroup[]>([]);
  let all = $state(false);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let busy = $state<string | null>(null);

  const RES_LABEL = { hidden: "숨김", restored: "되살림", kept: "문제없음" } as const;

  async function load() {
    loading = true;
    error = null;
    try {
      const r = await api.adminReports(all);
      list = r.reports;
      onchange?.(r.open);
    } catch (e) {
      error = e instanceof Error ? e.message : "불러오지 못했습니다";
    } finally {
      loading = false;
    }
  }
  onMount(load);

  async function act(g: ReportGroup, action: "hide" | "restore" | "keep") {
    busy = `${g.type}:${g.id}`;
    try {
      const r = await api.moderate(g.type, g.id, action);
      onchange?.(r.open);
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : "처리하지 못했습니다";
    } finally {
      busy = null;
    }
  }
</script>

<section class="ra">
  <header class="ra-head">
    <p class="dim">
      회원이 신고한 오리알터 글·댓글입니다. <b>숨김</b>하면 피드·글 주소·공유 미리보기에서 빠지고 글쓴이와 관리자만 봅니다.
    </p>
    <label class="ra-all"><input type="checkbox" bind:checked={all} onchange={load} /> 처리한 것도 보기</label>
  </header>

  {#if loading && !list.length}
    <p class="dim">불러오는 중…</p>
  {:else if error}
    <p class="err">{error}</p>
  {:else if !list.length}
    <p class="empty">{all ? "신고가 없습니다." : "처리할 신고가 없습니다."}</p>
  {/if}

  <ul class="ra-list">
    {#each list as g (g.type + g.id)}
      {@const t = g.target}
      {@const hidden = t?.status === "hidden"}
      <li class:done={!g.open}>
        <div class="ra-top">
          <span class="kind">{g.type === "post" ? "글" : "댓글"}</span>
          {#if g.open}<span class="cnt">신고 {g.open}</span>{:else}<span class="res">{g.resolution ? RES_LABEL[g.resolution] : "처리됨"}</span>{/if}
          {#if hidden}<span class="st hid">숨겨짐</span>{:else if t?.status === "deleted"}<span class="st">삭제됨</span>{/if}
          <span class="when" title={fullTime(g.last_at)}>{fullTime(g.last_at)}</span>
        </div>
        {#if t}
          <div class="ra-body">
            {#if t.cover_image}<img src={t.cover_image} alt="" />{/if}
            <div>
              <p class="who">
                <b>{t.author.name ?? "회원"}</b>
                {#if g.type === "comment" && t.post_title}<span class="dim"> · 글 ‘{t.post_title}’의 댓글</span>{/if}
              </p>
              {#if g.type === "post" && t.title}<p class="ttl">{t.title}</p>{/if}
              <p class="ex">{t.excerpt || "(사진만 있는 글)"}</p>
              {#if t.href}<a class="open" href={t.href} target="_blank" rel="noopener">글 열기 ↗</a>{/if}
            </div>
          </div>
        {:else}
          <p class="dim">대상을 찾을 수 없습니다(지워졌을 수 있음).</p>
        {/if}
        <ul class="reasons">
          {#each g.items as it}
            <li class:old={!it.open}><b>{it.reporter}</b> — {it.reason || "(이유 없음)"} <small>{fullTime(it.created_at)}</small></li>
          {/each}
        </ul>
        {#if (!t || t.status === "deleted") && g.open}
          <div class="ra-btns">
            <button type="button" class="btn btn-ghost" disabled={busy === `${g.type}:${g.id}`} onclick={() => act(g, "keep")}>확인(신고 닫기)</button>
          </div>
        {:else if t && t.status !== "deleted"}
          <div class="ra-btns">
            {#if hidden}
              <button type="button" class="btn btn-ghost" disabled={busy === `${g.type}:${g.id}`} onclick={() => act(g, "restore")}>되살리기</button>
              {#if g.open}<button type="button" class="btn btn-ghost" disabled={busy === `${g.type}:${g.id}`} onclick={() => act(g, "hide")}>숨김 유지</button>{/if}
            {:else}
              <button type="button" class="btn btn-primary" disabled={busy === `${g.type}:${g.id}`} onclick={() => act(g, "hide")}>숨김</button>
              {#if g.open}<button type="button" class="btn btn-ghost" disabled={busy === `${g.type}:${g.id}`} onclick={() => act(g, "keep")}>문제없음</button>{/if}
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  .ra {
    display: grid;
    gap: 14px;
  }
  .ra-head {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    align-items: center;
    justify-content: space-between;
  }
  .ra-head p {
    margin: 0;
  }
  .ra-all {
    font-size: 0.9rem;
    white-space: nowrap;
  }
  .dim {
    color: var(--color-muted);
    font-size: 0.9rem;
  }
  .err {
    color: var(--color-primary);
  }
  .empty {
    padding: 24px;
    text-align: center;
    color: var(--color-muted);
    border: 1px dashed var(--color-rule);
    border-radius: 10px;
  }
  .ra-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 12px;
  }
  .ra-list > li {
    padding: 14px 16px;
    border: 1px solid var(--color-rule);
    border-radius: 12px;
    background: var(--color-surface);
    display: grid;
    gap: 10px;
  }
  .ra-list > li.done {
    opacity: 0.75;
  }
  .ra-top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 0.82rem;
  }
  .ra-top span {
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--color-surface-2);
  }
  .ra-top .cnt {
    background: var(--color-primary);
    color: #fff;
    font-weight: 700;
  }
  .ra-top .st.hid {
    background: var(--color-ink);
    color: #fff;
  }
  .ra-top .when {
    margin-left: auto;
    background: none;
    color: var(--color-muted);
  }
  .ra-body {
    display: flex;
    gap: 12px;
  }
  .ra-body img {
    flex: none;
    width: 72px;
    height: 72px;
    object-fit: cover;
    border-radius: 8px;
  }
  .ra-body p {
    margin: 0 0 4px;
  }
  .ttl {
    font-weight: 700;
  }
  .ex {
    white-space: pre-line;
    font-size: 0.92rem;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .open {
    font-size: 0.85rem;
  }
  .reasons {
    margin: 0;
    padding: 8px 12px;
    list-style: none;
    border-radius: 8px;
    background: var(--color-surface-2);
    font-size: 0.86rem;
    display: grid;
    gap: 4px;
  }
  .reasons li.old {
    color: var(--color-muted);
  }
  .reasons small {
    color: var(--color-muted);
  }
  .ra-btns {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
</style>
