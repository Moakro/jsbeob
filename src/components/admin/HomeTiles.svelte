<script lang="ts">
  // 관리자 — 홈 편성: 모바일 히어로 사진 + 홈 왼쪽 "둘러보기" 카드(추가·편집·순서·삭제).
  // 복원(2026-11-01): 배포본 _astro/AdminApp.*.js 에 함께 묶인 컴포넌트. 파일 이름은 추정.
  import { onMount } from "svelte";
  import { adminApi } from "../../lib/blocks";
  import { library } from "../../lib/library";
  import { PLACE_KINDS, ABOUT_KINDS } from "../../lib/content-types";
  import { confirmDialog } from "../../lib/confirm";
  import MediaLibrary from "../MediaLibrary.svelte";

  let categories = $state<any[]>([]);
  library
    .categories()
    .then((r) => (categories = r.categories.filter((c: any) => c.type === "article")))
    .catch(() => {});

  let tiles = $state<any[]>([]);
  let tags = $state<any[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let msg = $state<{ tone: string; text: string } | null>(null);
  /** 펼친 카드 id, 새 카드면 "new" */
  let editing = $state<string | null>(null);
  let picking = $state<"tile" | "hero" | null>(null);
  let hero = $state<{ id: string; url: string } | null>(null);
  let heroBusy = $state(false);
  let saving = $state(false);

  const blank = () => ({
    title: "",
    subtitle: "",
    href: "",
    glyph: "",
    count_source: "",
    count_unit: "",
    status: "active",
    media_id: null as string | null,
    image_url: null as string | null,
  });
  let form = $state(blank());

  /** 카드에 보일 개수의 출처 */
  const countOptions = $derived([
    { value: "", label: "개수 표시 안 함" },
    ...Object.entries(PLACE_KINDS).map(([k, l]) => ({ value: `places:${k}`, label: `장소 자료 수 — ${l}` })),
    ...Object.entries(ABOUT_KINDS).map(([k, l]) => ({
      value: `articles:about:${k}`,
      label: `소개 글 수 — ${l}`,
    })),
    ...categories.map((c) => ({ value: `articles:library:${c.key}`, label: `자료실 글 수 — ${c.label}` })),
    ...tags.map((t) => ({ value: `tag:${t.slug}`, label: `태그 지도 장소 수 — ${t.name}` })),
  ]);

  async function load() {
    try {
      const [t, tg, h] = await Promise.all([
        adminApi.listHomeTiles(),
        adminApi.listTags(),
        adminApi.getHomeHero(),
      ]);
      tiles = t.items;
      tags = tg.items;
      hero = h.mobile;
    } catch (e) {
      error = e instanceof Error ? e.message : "불러오기 실패";
    } finally {
      loading = false;
    }
  }
  onMount(load);

  function open(t: any | null) {
    msg = null;
    if (!t) {
      editing = "new";
      form = blank();
      return;
    }
    editing = t.id;
    form = {
      title: t.title,
      subtitle: t.subtitle ?? "",
      href: t.href,
      glyph: t.glyph ?? "",
      count_source: t.count_source ?? "",
      count_unit: t.count_unit ?? "",
      status: t.status,
      media_id: t.media_id,
      image_url: t.image?.url ?? null,
    };
  }

  async function save() {
    msg = null;
    if (!form.title.trim()) return (msg = { tone: "err", text: "이름을 입력해 주세요." });
    if (!form.href.trim()) return (msg = { tone: "err", text: "연결 주소를 입력해 주세요 (예: /jeongak/)." });
    saving = true;
    const body = {
      title: form.title,
      subtitle: form.subtitle,
      href: form.href.trim(),
      glyph: form.glyph,
      count_source: form.count_source || null,
      count_unit: form.count_unit,
      status: form.status,
      media_id: form.media_id,
    };
    try {
      if (editing === "new") await adminApi.createHomeTile(body);
      else if (editing) await adminApi.updateHomeTile(editing, body);
      editing = null;
      await load();
      msg = { tone: "ok", text: "저장했습니다. 홈에 바로 반영됩니다." };
    } catch (e) {
      msg = { tone: "err", text: e instanceof Error ? e.message : "저장 실패" };
    } finally {
      saving = false;
    }
  }

  async function remove(t: any) {
    if (
      !(await confirmDialog({
        title: "카드 삭제",
        message: `"${t.title}" 카드를 홈에서 지울까요? 연결된 페이지는 그대로입니다.`,
        confirmText: "삭제",
        tone: "danger",
      }))
    )
      return;
    try {
      await adminApi.removeHomeTile(t.id);
      if (editing === t.id) editing = null;
      await load();
    } catch (e) {
      msg = { tone: "err", text: e instanceof Error ? e.message : "삭제 실패" };
    }
  }

  async function move(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= tiles.length) return;
    const next = [...tiles];
    [next[i], next[j]] = [next[j], next[i]];
    tiles = next;
    try {
      await adminApi.orderHomeTiles(next.map((t) => t.id));
    } catch (e) {
      msg = { tone: "err", text: e instanceof Error ? e.message : "순서를 저장하지 못했습니다" };
      await load();
    }
  }

  async function saveHero(mediaId: string | null) {
    msg = null;
    heroBusy = true;
    try {
      hero = (await adminApi.saveHomeHero(mediaId)).mobile;
      msg = {
        tone: "ok",
        text: mediaId
          ? "모바일 히어로 사진을 바꿨습니다. 홈에 바로 반영됩니다."
          : "모바일 히어로 사진을 뺐습니다.",
      };
    } catch (e) {
      msg = { tone: "err", text: e instanceof Error ? e.message : "저장 실패" };
    } finally {
      heroBusy = false;
    }
  }

  function onPick(list: { id: string; url: string }[]) {
    const m = list[0];
    const target = picking;
    picking = null;
    if (!m) return;
    if (target === "hero") {
      saveHero(m.id);
      return;
    }
    form.media_id = m.id;
    form.image_url = m.url;
  }
</script>

{#snippet tileForm()}
  <div class="form">
    <div class="grid2">
      <label
        ><span>이름 *</span><input
          bind:value={form.title}
          maxlength="40"
          placeholder="예: 법종교 전각"
        /></label
      >
      <label
        ><span>연결 주소 *</span><input
          bind:value={form.href}
          maxlength="300"
          placeholder="예: /jeongak/ · /map/?tag=…"
        /></label
      >
    </div>
    <label
      ><span>한 줄 설명</span><input
        bind:value={form.subtitle}
        maxlength="120"
        placeholder="예: 본부의 전각을 둘러봅니다"
      /></label
    >
    <div class="grid3">
      <label
        ><span>개수</span>
        <select bind:value={form.count_source}
          >{#each countOptions as o (o.value)}<option value={o.value}>{o.label}</option>{/each}</select
        ></label
      >
      <label
        ><span>개수 단위</span><input
          bind:value={form.count_unit}
          maxlength="8"
          placeholder="곳 · 분 · 편"
        /></label
      >
      <label
        ><span>글자 타일 <small>사진이 없을 때</small></span><input
          bind:value={form.glyph}
          maxlength="8"
          placeholder="예: 殿閣"
        /></label
      >
    </div>
    <div class="photo">
      {#if form.image_url}<img src={form.image_url} alt="" />{:else}<span class="ph"
          >{form.glyph || form.title || "사진 없음"}</span
        >{/if}
      <div class="photo-btns">
        <button type="button" class="btn btn-ghost sm" onclick={() => (picking = "tile")}
          >{form.media_id ? "대표 사진 바꾸기" : "대표 사진 고르기"}</button
        >
        {#if form.media_id}
          <button
            type="button"
            class="btn btn-ghost sm"
            onclick={() => {
              form.media_id = null;
              form.image_url = null;
            }}>사진 빼기</button
          >
        {/if}
      </div>
    </div>
    <label class="check"
      ><input
        type="checkbox"
        checked={form.status === "hidden"}
        onchange={(e) => (form.status = e.currentTarget.checked ? "hidden" : "active")}
      />
      숨김 <small>홈에서 빼기(지우지 않음)</small></label
    >
    <div class="row">
      <button type="button" class="btn btn-primary" disabled={saving} onclick={save}
        >{saving ? "저장 중…" : "저장"}</button
      >
      <button type="button" class="btn btn-ghost" onclick={() => (editing = null)}>취소</button>
    </div>
  </div>
{/snippet}

<section class="hero-set">
  <h3>모바일 히어로 사진</h3>
  <div class="photo">
    {#if hero}<img src={hero.url} alt="" />{:else}<span class="ph">영상 첫 컷</span>{/if}
    <div class="photo-btns">
      <button type="button" class="btn btn-ghost sm" disabled={heroBusy} onclick={() => (picking = "hero")}
        >{hero ? "사진 바꾸기" : "사진 고르기"}</button
      >
      {#if hero}<button
          type="button"
          class="btn btn-ghost sm"
          disabled={heroBusy}
          onclick={() => saveHero(null)}>사진 빼기</button
        >{/if}
    </div>
  </div>
</section>
<div class="head">
  <p class="dim">홈 왼쪽 "둘러보기"에 보이는 카드입니다. 섹션 안의 목록 대신 입구 카드 한 장씩 둡니다. 순서는 ↑↓로 바꾸면 바로 저장됩니다.</p>
  <button type="button" class="btn btn-primary" onclick={() => open(null)}>＋ 새 카드</button>
</div>
{#if msg}<p class={`msg ${msg.tone}`}>{msg.text}</p>{/if}
{#if editing === "new"}{@render tileForm()}{/if}
{#if loading}
  <p class="dim">불러오는 중…</p>
{:else if error}
  <p class="err">{error}</p>
{:else if tiles.length}
  <ul class="list">
    {#each tiles as t, i (t.id)}
      <li class:off={t.status === "hidden"}>
        <div class="line">
          {#if t.image}<img class="mini" src={t.image.url} alt="" />{:else}<span class="mini ph"
              >{(t.glyph || t.title).slice(0, 2)}</span
            >{/if}
          <span class="t"
            ><strong>{t.title}</strong>
            <small
              >{t.href}{t.count != null ? ` · ${t.count}${t.count_unit ?? ""}` : ""}{t.status === "hidden"
                ? " · 숨김"
                : ""}</small
            ></span
          >
          <span class="tools"
            ><button type="button" aria-label="위로" disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
            <button
              type="button"
              aria-label="아래로"
              disabled={i === tiles.length - 1}
              onclick={() => move(i, 1)}>↓</button
            >
            <button type="button" class="txt" onclick={() => (editing === t.id ? (editing = null) : open(t))}
              >{editing === t.id ? "닫기" : "편집"}</button
            >
            <button type="button" class="txt danger" onclick={() => remove(t)}>삭제</button></span
          >
        </div>
        {#if editing === t.id}{@render tileForm()}{/if}
      </li>
    {/each}
  </ul>
{:else}
  <p class="dim">아직 카드가 없습니다. 홈의 "둘러보기" 구역은 카드가 생기면 나타납니다.</p>
{/if}
{#if picking}
  <div
    class="overlay"
    role="dialog"
    aria-modal="true"
    aria-label={picking === "hero" ? "모바일 히어로 사진 고르기" : "대표 사진 고르기"}
  >
    <div class="sheet">
      <h3>{picking === "hero" ? "모바일 히어로 사진 고르기" : "카드 대표 사진 고르기"}</h3>
      <MediaLibrary mode="pick" onpick={onPick} oncancel={() => (picking = null)} />
    </div>
  </div>
{/if}

<style>
  .hero-set {
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--color-rule);
  }
  .hero-set h3 {
    margin: 0 0 10px;
    font-size: 1rem;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .list li {
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: #fff;
  }
  .list li.off {
    opacity: 0.6;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
  }
  .mini {
    flex: none;
    width: 72px;
    height: 40px;
    object-fit: cover;
    border-radius: var(--radius-md);
  }
  .ph {
    display: grid;
    place-items: center;
    background: linear-gradient(135deg, #b8860b, #8a6508);
    color: #fff;
    font-weight: 700;
    font-size: 0.9rem;
  }
  .t {
    display: grid;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .t small {
    color: var(--color-muted);
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tools {
    display: flex;
    gap: 4px;
    flex: none;
  }
  .tools button {
    height: 28px;
    min-width: 28px;
    padding: 0 8px;
    border: 1px solid var(--color-rule);
    background: #fff;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    cursor: pointer;
    color: var(--color-muted);
  }
  .tools button:disabled {
    opacity: 0.35;
  }
  .tools .danger {
    color: var(--color-primary);
  }
  .form {
    display: grid;
    gap: 10px;
    padding: 14px;
    border-top: 1px solid var(--color-rule);
    background: var(--color-surface);
  }
  .head + .form,
  .msg + .form {
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    margin-bottom: 12px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .grid3 {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr;
    gap: 10px;
  }
  label {
    display: grid;
    gap: 4px;
    font-size: 0.85rem;
    font-weight: 600;
  }
  label small {
    font-weight: 400;
    color: var(--color-muted);
  }
  input:not([type="checkbox"]),
  select {
    padding: 8px 10px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: #fff;
    font: inherit;
    font-weight: 400;
    width: 100%;
    box-sizing: border-box;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 400;
  }
  .photo {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .photo img,
  .photo .ph {
    width: 176px;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: var(--radius-md);
  }
  .photo-btns,
  .row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .dim {
    color: var(--color-muted);
    font-size: 0.86rem;
    margin: 0;
  }
  .err {
    color: var(--color-primary);
  }
  .msg {
    margin: 0 0 10px;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    font-size: 0.88rem;
  }
  .msg.ok {
    background: var(--color-secondary-bg);
    color: var(--color-secondary);
  }
  .msg.err {
    background: var(--color-primary-bg);
    color: var(--color-primary);
  }
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: var(--color-overlay);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 4vh 16px;
    overflow: auto;
  }
  .sheet {
    width: min(960px, 100%);
    background: var(--color-bg);
    border-radius: var(--radius-lg);
    padding: 18px;
  }
  .sheet h3 {
    margin: 0 0 12px;
  }
  @media (max-width: 760px) {
    .grid2,
    .grid3 {
      grid-template-columns: 1fr;
    }
  }
</style>
