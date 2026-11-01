<script lang="ts">
  // 관리자 — 지도 장소 목록(분류 묶음별).
  // 복원(2026-11-01): 배포본 _astro/AdminApp.*.js 에 함께 묶인 컴포넌트. 파일 이름은 추정.
  import { adminApi, fmtKst } from "../../lib/blocks";
  import { MAP_KIND_GROUPS } from "../../lib/content-types";
  import { markerForKind } from "../../lib/map-categories";

  let items = $state<any[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  const STATUS: Record<string, string> = { published: "공개", draft: "작성 중", hidden: "숨김" };

  $effect(() => {
    adminApi
      .listPoints()
      .then((r: any) => (items = r.items))
      .catch((e: any) => (error = e instanceof Error ? e.message : "불러오기 실패"))
      .finally(() => (loading = false));
  });

  const groups = $derived(
    MAP_KIND_GROUPS.map((g) => ({
      label: g.label,
      kinds: g.kinds
        .map((k) => ({ ...k, items: items.filter((i) => i.kind === k.value) }))
        .filter((k) => k.items.length),
    })).filter((g) => g.kinds.length),
  );
</script>

<div class="head">
  <p class="dim">지도 장소 {items.length}곳</p>
  <a class="btn btn-primary" href="#point/new">＋ 새 지도 장소</a>
</div>
{#if loading}
  <p class="dim">불러오는 중…</p>
{:else if error}
  <p class="err">{error}</p>
{:else if items.length}
  {#each groups as g (g.label)}
    <h2>{g.label}</h2>
    {#each g.kinds as k (k.value)}
      <section>
        <h3>
          <i style:background={markerForKind(k.value).color}></i>
          {k.label} <small>{k.items.length}</small>
        </h3>
        <ul>
          {#each k.items as it (it.id)}
            <li>
              <a class="main" href={`#point/${it.id}`}
                ><span class="t"
                  >{it.name}
                  {#if it.name_hanja}<span class="hanja">{it.name_hanja}</span>{/if}</span
                ></a
              >
              <span class="link" class:none={!it.place}
                >{it.place ? `전각 · ${it.place.name}` : "지도에만"}</span
              >
              <span class={`badge ${it.status}`}>{STATUS[it.status] ?? it.status}</span>
              <span class="meta">순서 {it.sort_order}</span>
              <span class="meta">{fmtKst(it.updated_at)}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/each}
{:else}
  <p class="dim">아직 없습니다.</p>
{/if}

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  h2 {
    font-size: 1.05rem;
    margin: 22px 0 0;
    color: var(--color-primary);
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 0.95rem;
    margin: 12px 0 8px;
  }
  h3 i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: none;
  }
  h3 small {
    color: var(--color-muted);
    font-weight: 500;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-top: 1px solid var(--color-rule);
  }
  li:first-child {
    border-top: 0;
  }
  .main {
    flex: 1;
    min-width: 0;
    color: var(--color-fg);
  }
  .t {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .hanja {
    color: var(--color-muted);
    font-weight: 400;
  }
  .link {
    font-size: 0.8rem;
    color: var(--color-secondary);
    flex: none;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .link.none {
    color: var(--color-muted);
  }
  .badge {
    font-size: 0.74rem;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-muted);
    flex: none;
  }
  .badge.published {
    background: var(--color-secondary-bg);
    color: var(--color-secondary);
  }
  .badge.hidden {
    background: #eee;
  }
  .meta {
    font-size: 0.78rem;
    color: var(--color-muted);
    flex: none;
  }
  .dim {
    color: var(--color-muted);
    font-size: 0.88rem;
    margin: 0;
  }
  .err {
    color: var(--color-primary);
  }
  @media (max-width: 640px) {
    .meta {
      display: none;
    }
  }
</style>
