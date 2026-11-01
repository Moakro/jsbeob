<script lang="ts">
  // 관리자 — 문서(소개·자료실 글) / 전각 목록. 종류별로 묶어 보인다.
  // 복원(2026-11-01): 배포본 _astro/AdminApp.*.js 에 함께 묶인 컴포넌트. 파일 이름은 추정.
  import { adminApi, fmtKst } from "../../lib/blocks";
  import { library, articleHref } from "../../lib/library";
  import { PLACE_KINDS, ABOUT_KINDS } from "../../lib/content-types";

  let { type, section = "about" }: { type: "article" | "place"; section?: "about" | "library" } = $props();

  let items = $state<any[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let categories = $state<any[]>([]);

  library
    .categories()
    .then((r) => (categories = r.categories.filter((c: any) => c.type === "article")))
    .catch(() => {});

  /** 종류 → 라벨 */
  const kinds = $derived<Record<string, string>>(
    type === "place"
      ? PLACE_KINDS
      : section === "library"
        ? Object.fromEntries(categories.map((c) => [c.key, c.label]))
        : ABOUT_KINDS,
  );
  const STATUS: Record<string, string> = { published: "공개", draft: "작성 중", hidden: "숨김" };

  function publicHref(it: any) {
    if (type === "place")
      return it.kind === "jeongak" ? `/jeongak/${it.slug}/` : `/archive/places/${it.slug}/`;
    return it.section === "library" ? articleHref(it.kind, it.slug) : `/about/${it.slug}/`;
  }

  $effect(() => {
    const t = type;
    const s = section;
    loading = true;
    error = null;
    adminApi
      .list(t, s)
      .then((r: any) => {
        // 전각 탭은 전각만, 문서는 책의 장(parent_id)을 빼고
        const list =
          t === "place"
            ? r.items.filter((x: any) => x.kind === "jeongak")
            : r.items.filter((x: any) => !x.parent_id);
        items = list.map((x: any) => ({
          id: x.id,
          kind: x.kind,
          title: x.title ?? x.name,
          hanja: x.title_hanja ?? x.name_hanja ?? null,
          status: x.status,
          sort: x.sort_order,
          updated: fmtKst(x.updated_at),
          thumb: x.thumb?.url,
          href: publicHref(x),
          chapters: x.chapter_count ?? 0,
        }));
      })
      .catch((e: any) => (error = e instanceof Error ? e.message : "불러오기 실패"))
      .finally(() => (loading = false));
  });

  const groups = $derived(
    Object.entries(kinds)
      .map(([kind, label]) => ({ kind, label, items: items.filter((i) => i.kind === kind) }))
      .filter((g) => g.items.length),
  );
  const newHref = $derived(type === "place" ? "#place/new" : `#article/new?section=${section}`);
</script>

<div class="head">
  <p class="dim">
    {type === "place" ? "전각" : section === "library" ? "자료실 글" : "소개 글"}
    {items.length}건 · 작성 중·숨김 상태는 방문자에게 보이지 않습니다.
  </p>
  <a class="btn btn-primary" href={newHref}>＋ 새로 만들기</a>
</div>
{#if loading}
  <p class="dim">불러오는 중…</p>
{:else if error}
  <p class="err">{error}</p>
{:else if items.length}
  {#each groups as g (g.kind)}
    <section>
      <h3>{g.label} <small>{g.items.length}</small></h3>
      <ul>
        {#each g.items as it (it.id)}
          <li>
            <a class="main" href={`#${type}/${it.id}`}>
              {#if it.thumb}<img src={it.thumb} alt="" loading="lazy" />{:else}<span class="ph"></span>{/if}
              <span class="t"
                >{it.title}
                {#if it.hanja}<span class="hanja">{it.hanja}</span>{/if}</span
              >
            </a>
            {#if it.chapters}<span class="meta">{it.chapters}장</span>{/if}
            <span class={`badge ${it.status}`}>{STATUS[it.status] ?? it.status}</span>
            <span class="meta">순서 {it.sort}</span>
            <span class="meta">{it.updated}</span>
            <a
              class="view"
              href={it.status === "published" ? it.href : `${it.href}?preview=1`}
              target="_blank"
              rel="noopener">보기</a
            >
          </li>
        {/each}
      </ul>
    </section>
  {/each}
{:else}
  <p class="dim">아직 없습니다. "새로 만들기"로 첫 자료를 올려 보세요.</p>
{/if}

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  h3 {
    font-size: 1rem;
    margin: 18px 0 8px;
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
    padding: 8px 12px;
    border-top: 1px solid var(--color-rule);
  }
  li:first-child {
    border-top: 0;
  }
  .main {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    color: var(--color-fg);
  }
  .main img,
  .ph {
    width: 44px;
    height: 33px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    flex: none;
  }
  .t {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .hanja {
    color: var(--color-muted);
    font-weight: 400;
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
  .view {
    font-size: 0.82rem;
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
