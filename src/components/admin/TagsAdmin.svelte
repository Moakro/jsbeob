<script lang="ts">
  // 관리자 — 태그. id 가 없으면 목록(끌어서/↑↓ 순서 = 지도 버튼 순서), 있으면("new" 포함) 태그 편집기.
  // 복원(2026-11-01): 배포본 _astro/AdminApp.*.js 에 함께 묶인 컴포넌트. 파일 이름은 추정.
  import { onMount } from "svelte";
  import { adminApi } from "../../lib/blocks";
  import { MARKER_ICONS, TAG_COLORS, iconPath } from "../../lib/map-categories";
  import { confirmDialog } from "../../lib/confirm";

  // id: undefined = 목록, null = 새 태그(#tag/new), 문자열 = 기존 태그
  let { id = undefined }: { id?: string | null } = $props();
  const isList = id === undefined;

  // ── 목록
  let tags = $state<any[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let note = $state<string | null>(null);
  let dragTag = $state<string | null>(null);

  async function saveOrder(list: any[]) {
    tags = list;
    note = null;
    try {
      await adminApi.orderTags(list.map((t) => t.id));
      note = "순서를 저장했습니다.";
    } catch (e) {
      note = e instanceof Error ? e.message : "순서를 저장하지 못했습니다";
    }
  }
  function moveTag(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= tags.length) return;
    const next = [...tags];
    [next[i], next[j]] = [next[j], next[i]];
    saveOrder(next);
  }
  function dragOverTag(e: DragEvent, overId: string) {
    if (!dragTag) return;
    e.preventDefault();
    if (overId === dragTag) return;
    const from = tags.findIndex((t) => t.id === dragTag);
    const to = tags.findIndex((t) => t.id === overId);
    if (from < 0 || to < 0) return;
    const next = [...tags];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    tags = next;
  }
  function dropTag() {
    if (!dragTag) return;
    dragTag = null;
    saveOrder(tags);
  }

  // ── 편집기
  let tagId = $state<string | null>(id ?? null);
  let saving = $state(false);
  let msg = $state<{ tone: string; text: string } | null>(null);
  let savedJson = $state("");
  const f = $state({
    name: "",
    slug: "",
    description: "",
    color: TAG_COLORS[0],
    icon: "pin",
    on_map: true,
    status: "active",
  });
  let points = $state<any[]>([]);
  let contents = $state<any[]>([]);
  let allPoints = $state<any[]>([]);
  let q = $state("");
  let dragPoint = $state<string | null>(null);

  const ICONS = Object.entries(MARKER_ICONS).filter(([, v]) => v.pick);
  const STATUS: Record<string, string> = { published: "공개", draft: "작성 중", hidden: "숨김" };
  const payload = () => ({ ...f, points: points.map((p) => p.id) });
  const dirty = $derived(!isList && !loading && JSON.stringify(payload()) !== savedJson);
  $effect(() => {
    if (!isList) (window as any).__jbAdminDirty = dirty;
  });

  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const hits = $derived.by(() => {
    const k = norm(q);
    if (!k) return [];
    const have = new Set(points.map((p) => p.id));
    return allPoints
      .filter(
        (p) =>
          !have.has(p.id) &&
          (norm(p.name).includes(k) || (p.name_hanja ? norm(p.name_hanja).includes(k) : false)),
      )
      .slice(0, 12);
  });

  function fill(t: any) {
    f.name = t.name;
    f.slug = t.slug;
    f.description = t.description ?? "";
    f.color = t.color;
    f.icon = t.icon;
    f.on_map = t.on_map;
    f.status = t.status;
    points = t.points;
    contents = t.contents;
  }

  onMount(() => {
    if (isList) {
      adminApi
        .listTags()
        .then((r: any) => (tags = r.items))
        .catch((e: any) => (error = e instanceof Error ? e.message : "불러오기 실패"))
        .finally(() => (loading = false));
      return;
    }
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if ((window as any).__jbAdminDirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    (async () => {
      try {
        const [pts, t] = await Promise.all([
          adminApi.listPoints(),
          tagId ? adminApi.getTag(tagId) : Promise.resolve(null),
        ]);
        allPoints = pts.items;
        if (t) fill(t.item);
        loading = false;
        savedJson = JSON.stringify(payload());
      } catch (e) {
        error = e instanceof Error ? e.message : "불러오기 실패";
        loading = false;
      }
    })();
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      (window as any).__jbAdminDirty = false;
    };
  });

  function addPoint(p: any) {
    points = [
      ...points,
      { id: p.id, name: p.name, name_hanja: p.name_hanja, kind: p.kind, status: p.status },
    ];
    q = "";
  }
  function movePoint(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= points.length) return;
    const next = [...points];
    [next[i], next[j]] = [next[j], next[i]];
    points = next;
  }
  function dragOverPoint(e: DragEvent, overId: string) {
    if (!dragPoint) return;
    e.preventDefault();
    if (overId === dragPoint) return;
    const from = points.findIndex((p) => p.id === dragPoint);
    const to = points.findIndex((p) => p.id === overId);
    if (from < 0 || to < 0) return;
    const next = [...points];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    points = next;
  }

  async function save() {
    msg = null;
    if (!f.name.trim()) return (msg = { tone: "err", text: "태그 이름을 입력해 주세요." });
    saving = true;
    try {
      const body = { ...payload(), slug: f.slug.trim() || undefined };
      const created = !tagId;
      const t = tagId ? (await adminApi.updateTag(tagId, body)).item : (await adminApi.createTag(body)).item;
      tagId = t.id;
      fill(t);
      savedJson = JSON.stringify(payload());
      msg = {
        tone: "ok",
        text: `저장했습니다 (${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })})`,
      };
      if (created) history.replaceState(null, "", `#tag/${t.id}`);
    } catch (e) {
      msg = { tone: "err", text: e instanceof Error ? e.message : "저장 실패" };
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (
      !tagId ||
      !(await confirmDialog({
        title: "태그 삭제",
        message: `태그 "${f.name}"을(를) 삭제할까요? 붙어 있던 지도 장소·자료에서 떨어지고${f.on_map ? ", 지도 버튼도 사라집니다" : ""}. 자료와 장소는 그대로 남습니다.`,
        confirmText: "삭제",
        tone: "danger",
      }))
    )
      return;
    try {
      await adminApi.removeTag(tagId);
      (window as any).__jbAdminDirty = false;
      location.hash = "#tags";
    } catch (e) {
      msg = { tone: "err", text: e instanceof Error ? e.message : "삭제 실패" };
    }
  }
</script>

{#snippet marker(color: string, icon: string, size = 22)}
  <span class="mk" style:background={color} style:width={`${size}px`} style:height={`${size}px`}
    ><svg
      viewBox="0 -960 960 960"
      aria-hidden="true"
      width={Math.round(size * 0.58)}
      height={Math.round(size * 0.58)}><path fill="currentColor" d={iconPath(icon)}></path></svg
    ></span
  >
{/snippet}

{#if isList}
  <div class="head">
    <p class="dim">"지도에 표시"가 켜진 태그가 지도 버튼이 됩니다. 목록 순서가 지도 버튼 순서입니다.</p>
    <a class="btn btn-primary" href="#tag/new">＋ 새 태그</a>
  </div>
  {#if loading}
    <p class="dim">불러오는 중…</p>
  {:else if error}
    <p class="err">{error}</p>
  {:else if tags.length}
    {#if note}<p class="dim">{note}</p>{/if}
    <ul class="tags">
      {#each tags as tg, i (tg.id)}
        <li
          class:dragging={dragTag === tg.id}
          class:off={tg.status === "hidden"}
          ondragover={(e) => dragOverTag(e, tg.id)}
          ondrop={(e) => {
            e.preventDefault();
            dropTag();
          }}
        >
          <span
            class="grip"
            draggable="true"
            title="끌어서 순서 바꾸기"
            aria-hidden="true"
            ondragstart={(e) => {
              dragTag = tg.id;
              e.dataTransfer?.setData("text/plain", "");
            }}
            ondragend={dropTag}>⠿</span
          >
          {@render marker(tg.color, tg.icon)}
          <a class="main" href={`#tag/${tg.id}`}>{tg.name}</a>
          {#if tg.on_map}<span class="badge map">지도 버튼</span>{/if}
          {#if tg.status === "hidden"}<span class="badge">숨김</span>{/if}
          <span class="meta">장소 {tg.counts?.point ?? 0} · 자료 {tg.counts?.content ?? 0}</span>
          <span class="tools"
            ><button type="button" aria-label="위로" disabled={i === 0} onclick={() => moveTag(i, -1)}
              >↑</button
            >
            <button
              type="button"
              aria-label="아래로"
              disabled={i === tags.length - 1}
              onclick={() => moveTag(i, 1)}>↓</button
            ></span
          >
        </li>
      {/each}
    </ul>
  {:else}
    <p class="dim">아직 태그가 없습니다.</p>
  {/if}
{:else if loading}
  <p class="dim">불러오는 중…</p>
{:else if error}
  <p class="err">{error}</p>
  <a href="#tags">← 목록으로</a>
{:else}
  <div class="top">
    <a href="#tags">← 목록으로</a>
    <button type="button" class="btn btn-primary" disabled={saving} onclick={save}
      >{saving ? "저장 중…" : "저장"}</button
    >
  </div>
  {#if dirty}<p class="dirty">저장하지 않은 변경이 있습니다.</p>{/if}
  {#if msg}<p class={`msg ${msg.tone}`}>{msg.text}</p>{/if}
  <div class="layout">
    <div class="main-col">
      <div class="grid2">
        <label
          ><span>이름 *</span><input bind:value={f.name} maxlength="40" placeholder="예: 4대성지" /></label
        >
        <label
          ><span>주소 <small>비우면 이름으로</small></span><input
            bind:value={f.slug}
            maxlength="80"
            placeholder="예: 4daeseongji"
          /></label
        >
      </div>
      <label
        ><span>설명 <small>(선택)</small></span><textarea bind:value={f.description} rows="2" maxlength="300"
        ></textarea></label
      >
      <section class="box">
        <strong
          >지도 장소 <small>{points.length}곳 · 순서 = 지도 버튼을 켰을 때 카드 순서·마커 번호</small></strong
        >
        {#if points.length}
          <ol class="pts">
            {#each points as p, i (p.id)}
              <li
                class:dragging={dragPoint === p.id}
                ondragover={(e) => dragOverPoint(e, p.id)}
                ondrop={(e) => {
                  e.preventDefault();
                  dragPoint = null;
                }}
              >
                <span
                  class="grip"
                  draggable="true"
                  aria-hidden="true"
                  title="끌어서 순서 바꾸기"
                  ondragstart={(e) => {
                    dragPoint = p.id;
                    e.dataTransfer?.setData("text/plain", "");
                  }}
                  ondragend={() => (dragPoint = null)}>⠿</span
                >
                <span class="no">{i + 1}</span>
                <a href={`#point/${p.id}`}
                  >{p.name}
                  {#if p.name_hanja}<small>{p.name_hanja}</small>{/if}</a
                >
                {#if p.status !== "published"}<span class="badge">{STATUS[p.status] ?? p.status}</span>{/if}
                <span class="tools"
                  ><button type="button" aria-label="위로" disabled={i === 0} onclick={() => movePoint(i, -1)}
                    >↑</button
                  >
                  <button
                    type="button"
                    aria-label="아래로"
                    disabled={i === points.length - 1}
                    onclick={() => movePoint(i, 1)}>↓</button
                  >
                  <button
                    type="button"
                    class="x"
                    aria-label="이 태그에서 빼기"
                    title="빼기"
                    onclick={() => (points = points.filter((x) => x.id !== p.id))}>✕</button
                  ></span
                >
              </li>
            {/each}
          </ol>
        {:else}
          <p class="dim">아직 붙은 지도 장소가 없습니다.</p>
        {/if}
        <div class="add">
          <input bind:value={q} placeholder="지도 장소 이름으로 찾아 추가" />
          {#if hits.length}
            <ul class="hits">
              {#each hits as p (p.id)}
                <li>
                  <button type="button" onclick={() => addPoint(p)}
                    >+ {p.name}
                    {#if p.name_hanja}<small>{p.name_hanja}</small>{/if}</button
                  >
                </li>
              {/each}
            </ul>
          {:else if q.trim()}
            <p class="dim">맞는 장소가 없거나 이미 붙어 있습니다.</p>
          {/if}
        </div>
      </section>
      {#if contents.length}
        <section class="box">
          <strong>이 태그가 붙은 자료 <small>{contents.length} · 붙이고 떼기는 각 편집기에서</small></strong>
          <ul class="plain">
            {#each contents as c (c.type + c.id)}
              <li>
                <a
                  href={c.type === "place"
                    ? `#place/${c.id}`
                    : `#article/${c.id}${c.section === "library" ? "?section=library" : ""}`}>{c.title}</a
                >
                <span class="dim"
                  >{c.type === "place" ? "전각" : c.section === "library" ? "자료실" : "소개"}</span
                >
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </div>
    <aside class="side">
      <section class="box">
        <label class="check"
          ><input type="checkbox" bind:checked={f.on_map} /> 지도에 표시
          <small>지도 버튼이 됩니다</small></label
        >
        <label class="check"
          ><input
            type="checkbox"
            checked={f.status === "hidden"}
            onchange={(e) => (f.status = e.currentTarget.checked ? "hidden" : "active")}
          />
          숨김 <small>지도 버튼·마커에서 빠짐</small></label
        >
      </section>
      <section class="box">
        <strong>미리보기</strong>
        <div class="preview">
          {@render marker(f.color, f.icon, 30)}
          <span class="chip-pv" style:--c={f.color}><i></i> {f.name || "태그 이름"}</span>
        </div>
        <span class="lbl">색</span>
        <div class="swatches">
          {#each TAG_COLORS as c (c)}<button
              type="button"
              class="sw"
              class:on={f.color.toLowerCase() === c.toLowerCase()}
              aria-label={`색 ${c}`}
              style:background={c}
              onclick={() => (f.color = c)}
            ></button>{/each}
          <input type="color" bind:value={f.color} aria-label="다른 색" />
        </div>
        <span class="lbl">아이콘</span>
        <div class="icons">
          {#each ICONS as [key, ic] (key)}
            <button
              type="button"
              class="ic"
              class:on={f.icon === key}
              title={ic.label}
              aria-label={`아이콘 ${ic.label}`}
              onclick={() => (f.icon = key)}
              ><svg viewBox="0 -960 960 960" width="18" height="18" aria-hidden="true"
                ><path fill="currentColor" d={ic.path}></path></svg
              ></button
            >
          {/each}
        </div>
      </section>
      {#if tagId}
        <button type="button" class="btn btn-ghost danger" onclick={remove}>삭제</button>
      {/if}
    </aside>
  </div>
{/if}

<style>
  .head,
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .top {
    padding: 8px 0;
  }
  .tags,
  .pts,
  .plain,
  .hits {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .tags li,
  .pts li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: #fff;
  }
  .tags li.off {
    opacity: 0.6;
  }
  .dragging {
    opacity: 0.5;
  }
  .grip {
    cursor: grab;
    color: var(--color-muted);
    user-select: none;
  }
  .main {
    font-weight: 700;
    color: var(--color-fg);
  }
  .meta {
    margin-left: auto;
    font-size: 0.8rem;
    color: var(--color-muted);
  }
  .tools {
    display: flex;
    gap: 4px;
  }
  .pts .tools {
    margin-left: auto;
  }
  .tools button {
    width: 26px;
    height: 26px;
    border: 1px solid var(--color-rule);
    background: #fff;
    border-radius: var(--radius-sm);
    font-size: 0.78rem;
    cursor: pointer;
    color: var(--color-muted);
  }
  .tools button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .tools .x {
    color: var(--color-primary);
  }
  .badge {
    font-size: 0.72rem;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-muted);
  }
  .badge.map {
    background: var(--color-secondary-bg);
    color: var(--color-secondary);
  }
  .mk {
    flex: none;
    box-sizing: border-box;
    display: grid;
    place-items: center;
    border: 2px solid #fff;
    border-radius: 50%;
    color: #fff;
    box-shadow: 0 1px 4px #00000059;
  }
  .no {
    flex: none;
    min-width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: 999px;
    background: var(--color-fg);
    color: #fff;
    font-size: 0.74rem;
    font-weight: 700;
  }
  .pts a {
    color: var(--color-fg);
  }
  small {
    font-weight: 400;
    color: var(--color-muted);
    font-size: 0.78rem;
  }
  .layout {
    display: grid;
    grid-template-columns: 1fr 280px;
    gap: 20px;
    align-items: start;
  }
  .main-col,
  .side {
    display: grid;
    gap: 14px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  label {
    display: grid;
    gap: 4px;
    font-size: 0.86rem;
    font-weight: 600;
  }
  input:not([type="checkbox"]):not([type="color"]),
  textarea {
    padding: 8px 10px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: #fff;
    font: inherit;
    font-weight: 400;
    color: var(--color-fg);
    width: 100%;
    box-sizing: border-box;
  }
  .box {
    display: grid;
    gap: 10px;
    padding: 14px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 400;
  }
  .add {
    display: grid;
    gap: 6px;
  }
  .hits button {
    border: 0;
    background: none;
    padding: 4px 6px;
    cursor: pointer;
    font: inherit;
    font-size: 0.9rem;
    text-align: left;
    width: 100%;
    border-radius: var(--radius-sm);
  }
  .hits button:hover {
    background: var(--color-surface-2);
  }
  .plain li {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .lbl {
    font-size: 0.8rem;
    font-weight: 600;
  }
  .preview {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px;
    border-radius: var(--radius-sm);
    background: #2c3328;
  }
  .chip-pv {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border-radius: 999px;
    background: var(--c);
    color: #fff;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .chip-pv i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #fff;
  }
  .swatches,
  .icons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .sw {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px var(--color-rule);
    cursor: pointer;
    padding: 0;
  }
  .sw.on {
    box-shadow: 0 0 0 2px var(--color-fg);
  }
  .icons .ic {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: #fff;
    color: var(--color-muted);
    cursor: pointer;
  }
  .icons .ic.on {
    border-color: var(--color-fg);
    color: var(--color-fg);
    background: var(--color-surface-2);
  }
  .danger {
    color: var(--color-primary);
    justify-self: start;
  }
  .dim {
    color: var(--color-muted);
    font-size: 0.84rem;
    margin: 0;
  }
  .err {
    color: var(--color-primary);
  }
  .dirty {
    margin: 0 0 6px;
    font-size: 0.82rem;
    color: var(--color-gold);
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
  @media (max-width: 860px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
