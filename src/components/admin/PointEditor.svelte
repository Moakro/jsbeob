<script lang="ts">
  // 관리자 — 지도 장소 편집기(이름·위치·분류·연결 전각·태그·공개 상태).
  // 위치는 PointLocationPicker 지도에서 찍으면 'jsbooks:coord-pick' 이벤트로 받는다.
  // 복원(2026-11-01): 배포본 _astro/AdminApp.*.js 에 함께 묶인 컴포넌트. 파일 이름은 추정.
  import { onMount } from "svelte";
  import { adminApi } from "../../lib/blocks";
  import { MAP_KIND_GROUPS } from "../../lib/content-types";
  import { BRANCHES } from "../../data/branches";
  import { iconPath } from "../../lib/map-categories";
  import { hasKakaoKey } from "../../lib/kakao-maps";
  import { confirmDialog } from "../../lib/confirm";
  import SelectMenu from "../SelectMenu.svelte";
  import PointLocationPicker from "../PointLocationPicker.svelte";

  let { id = null, placeId = null }: { id?: string | null; placeId?: string | null } = $props();

  let currentId = $state<string | null>(id);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let saving = $state(false);
  let msg = $state<{ tone: string; text: string } | null>(null);
  let savedJson = $state("");
  const f = $state({
    kind: "",
    name: "",
    name_hanja: "",
    summary: "",
    lat: "" as number | string,
    lng: "" as number | string,
    place_id: "",
    branch_code: "",
    sort_order: 0 as number | string,
    status: "draft",
    tags: [] as string[],
  });
  let allTags = $state<any[]>([]);
  /** 삭제가 막혔을 때 이 장소를 쓰는 글 목록 */
  let usage = $state<any[]>([]);

  function toggleTag(tid: string) {
    f.tags = f.tags.includes(tid) ? f.tags.filter((t) => t !== tid) : [...f.tags, tid];
  }
  /** 지도 버튼에 잡히는 태그가 하나라도 붙었나 */
  const onMap = $derived(allTags.some((t) => t.on_map && t.status === "active" && f.tags.includes(t.id)));

  let places = $state<any[]>([]);
  /** 전각 id → 이미 연결된 지도 장소 id */
  let linked = $state<Record<string, string>>({});
  const kindGroups = MAP_KIND_GROUPS.map((g) => ({ label: g.label, options: g.kinds }));
  const branchGroups = [
    {
      label: "지부",
      options: BRANCHES.filter((b) => b.kind === "지부").map((b) => ({ value: b.code, label: b.name })),
    },
    {
      label: "분원",
      options: BRANCHES.filter((b) => b.kind === "분원").map((b) => ({ value: b.code, label: b.name })),
    },
  ];
  // 다른 지도 장소에 이미 연결된 전각은 고를 수 없다
  const placeGroups = $derived([
    {
      options: [
        { value: "", label: "연결 안 함 (지도에만)" },
        ...places
          .filter((p) => !linked[p.id] || linked[p.id] === currentId)
          .map((p) => ({ value: p.id, label: p.name_hanja ? `${p.name} ${p.name_hanja}` : p.name })),
      ],
    },
  ]);

  function payload() {
    return {
      kind: f.kind,
      name: f.name,
      name_hanja: f.name_hanja,
      summary: f.summary,
      lat: f.lat === "" ? null : Number(f.lat),
      lng: f.lng === "" ? null : Number(f.lng),
      place_id: f.place_id || null,
      branch_code: f.kind === "branch" && f.branch_code ? f.branch_code : null,
      sort_order: f.sort_order === "" ? 0 : Number(f.sort_order),
      status: f.status,
      tags: [...f.tags].sort(),
    };
  }
  const dirty = $derived(!loading && JSON.stringify(payload()) !== savedJson);
  $effect(() => {
    (window as any).__jbAdminDirty = dirty;
  });

  function fill(it: any) {
    f.kind = it.kind;
    f.name = it.name;
    f.name_hanja = it.name_hanja ?? "";
    f.summary = it.summary ?? "";
    f.lat = it.lat;
    f.lng = it.lng;
    f.place_id = it.place?.id ?? "";
    f.branch_code = it.branch_code ?? "";
    f.sort_order = it.sort_order ?? 0;
    f.status = it.status;
    f.tags = [...(it.tags ?? [])];
  }

  onMount(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if ((window as any).__jbAdminDirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    const onPick = (e: Event) => {
      const c = (e as CustomEvent).detail;
      f.lat = Number(c.lat.toFixed(6));
      f.lng = Number(c.lng.toFixed(6));
    };
    window.addEventListener("jsbooks:coord-pick", onPick);
    (async () => {
      try {
        const [pl, pts, tg] = await Promise.all([
          adminApi.list("place"),
          adminApi.listPoints(),
          adminApi.listTags(),
        ]);
        allTags = tg.items;
        places = pl.items.filter((p: any) => p.kind === "jeongak");
        linked = Object.fromEntries(
          pts.items.filter((p: any) => p.place).map((p: any) => [p.place.id, p.id]),
        );
        if (currentId) fill((await adminApi.getPoint(currentId)).item);
        else if (placeId) {
          // 전각 화면에서 "지도에 올리기"로 들어온 경우
          const p = places.find((x) => x.id === placeId);
          if (p) {
            f.kind = "jeongak";
            f.name = p.name;
            f.name_hanja = p.name_hanja ?? "";
            f.place_id = linked[p.id] ? "" : p.id;
            f.status = p.status === "published" ? "published" : "draft";
          }
        }
        loading = false;
        savedJson = JSON.stringify(payload());
      } catch (e) {
        loadError = e instanceof Error ? e.message : "불러오기 실패";
        loading = false;
      }
    })();
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("jsbooks:coord-pick", onPick);
      (window as any).__jbAdminDirty = false;
    };
  });

  async function save() {
    msg = null;
    if (!f.name.trim()) return (msg = { tone: "err", text: "이름을 입력해 주세요." });
    if (!f.kind) return (msg = { tone: "err", text: "분류를 골라 주세요." });
    if (f.lat === "" || f.lng === "") return (msg = { tone: "err", text: "지도에서 위치를 정해 주세요." });
    saving = true;
    try {
      const body = payload();
      const it = currentId
        ? (await adminApi.updatePoint(currentId, body)).item
        : (await adminApi.createPoint(body)).item;
      const created = !currentId;
      currentId = it.id;
      fill(it);
      savedJson = JSON.stringify(payload());
      if (it.place) linked = { ...linked, [it.place.id]: it.id };
      msg = {
        tone: "ok",
        text: `저장했습니다 (${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })})`,
      };
      if (created) history.replaceState(null, "", `#point/${it.id}`);
    } catch (e) {
      msg = { tone: "err", text: e instanceof Error ? e.message : "저장 실패" };
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (
      !currentId ||
      !(await confirmDialog({
        title: "삭제",
        message: `지도 장소 "${f.name}"을(를) 삭제할까요? 지도에서 바로 사라집니다. 연결된 전각 자료는 그대로 남습니다.`,
        confirmText: "삭제",
        tone: "danger",
      }))
    )
      return;
    try {
      usage = [];
      await adminApi.removePoint(currentId);
      (window as any).__jbAdminDirty = false;
      location.hash = "#map";
    } catch (e: any) {
      usage = e?.data?.usage ?? [];
      msg = { tone: "err", text: e instanceof Error ? e.message : "삭제 실패" };
    }
  }

  const STATUSES = [
    { v: "draft", l: "작성 중", d: "나만 보임" },
    { v: "published", l: "공개", d: "지도에 보임" },
    { v: "hidden", l: "숨김", d: "공개했다가 내림" },
  ];
</script>

{#if loading}
  <p class="dim">불러오는 중…</p>
{:else if loadError}
  <p class="err">{loadError}</p>
  <a href="#map">← 목록으로</a>
{:else}
  <div class="top">
    <a href="#map">← 목록으로</a>
    <button type="button" class="btn btn-primary" disabled={saving} onclick={save}
      >{saving ? "저장 중…" : "저장"}</button
    >
  </div>
  {#if dirty}<p class="dirty">저장하지 않은 변경이 있습니다.</p>{/if}
  {#if msg}<p class={`msg ${msg.tone}`}>{msg.text}</p>{/if}
  {#if usage.length}
    <ul class="usage">
      {#each usage as u (u.type + u.id)}
        <li>
          {#if u.type === "post"}
            {u.title} <small>(게시글)</small>
          {:else}
            <a href={u.type === "place" ? `#place/${u.id}` : `#article/${u.id}`}>{u.title}</a>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  <div class="layout">
    <div class="main">
      <div class="grid2">
        <label><span>이름 *</span><input bind:value={f.name} maxlength="200" /></label>
        <label><span>한자</span><input bind:value={f.name_hanja} maxlength="100" /></label>
      </div>
      <label
        ><span>짧은 설명</span> <textarea bind:value={f.summary} rows="2" maxlength="500"></textarea></label
      >
      <section class="box">
        <strong>위치 *</strong>
        {#if hasKakaoKey()}
          <PointLocationPicker lat={f.lat} lng={f.lng} itemId={currentId} kind={f.kind} />
        {/if}
        <div class="grid2 even">
          <label><span>위도</span><input type="number" step="any" bind:value={f.lat} /></label>
          <label><span>경도</span><input type="number" step="any" bind:value={f.lng} /></label>
        </div>
      </section>
    </div>
    <aside class="side">
      <section class="box">
        <strong>공개 상태</strong>
        {#each STATUSES as s}
          <label class="check"
            ><input type="radio" name="status" value={s.v} bind:group={f.status} />
            {s.l} <small>{s.d}</small></label
          >
        {/each}
      </section>
      <section class="box">
        <strong>태그 <small>새 태그는 태그 탭에서</small></strong>
        {#if allTags.length}
          <div class="tagset" role="group" aria-label="태그">
            {#each allTags as tg (tg.id)}
              <button
                type="button"
                class="tg"
                class:on={f.tags.includes(tg.id)}
                class:hidden-tag={tg.status === "hidden"}
                aria-pressed={f.tags.includes(tg.id)}
                style:--c={tg.color}
                onclick={() => toggleTag(tg.id)}
                ><svg viewBox="0 -960 960 960" width="13" height="13" aria-hidden="true"
                  ><path fill="currentColor" d={iconPath(tg.icon)}></path></svg
                >
                {tg.name}
                {#if tg.on_map}<span class="onmap" title="지도 버튼">◉</span>{/if}</button
              >
            {/each}
          </div>
        {:else}
          <p class="dim">아직 태그가 없습니다. <a href="#tag/new">태그 만들기</a></p>
        {/if}
        <p class="dim">
          {onMap
            ? "지도 버튼에 잡히고, 마커는 앞선 지도 태그의 색·아이콘입니다."
            : "지도 표시 태그가 없어 흰색 문서 마커입니다. 공개된 글이 지도 블록으로 언급할 때만 지도에 나옵니다."}
        </p>
      </section>
      <section class="box">
        <div class="field">
          <span id="pt-kind">분류 *</span>
          <SelectMenu groups={kindGroups} labelledby="pt-kind" bind:value={f.kind} />
        </div>
        {#if f.kind === "branch"}
          <div class="field">
            <span id="pt-branch">지부·분원</span>
            <SelectMenu
              groups={branchGroups}
              labelledby="pt-branch"
              placeholder="선택 안 함"
              bind:value={f.branch_code}
            />
          </div>
        {/if}
        <div class="field">
          <span id="pt-place">연결된 전각</span>
          <SelectMenu groups={placeGroups} labelledby="pt-place" bind:value={f.place_id} />
        </div>
        <label
          ><span>순서 <small>작을수록 앞</small></span>
          <input type="number" step="1" bind:value={f.sort_order} /></label
        >
      </section>
      {#if currentId}
        <button type="button" class="btn btn-ghost danger" onclick={remove}>삭제</button>
      {/if}
    </aside>
  </div>
{/if}

<style>
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    padding: 8px 0;
  }
  .layout {
    display: grid;
    grid-template-columns: 1fr 280px;
    gap: 20px;
    align-items: start;
  }
  .main,
  .side {
    display: grid;
    gap: 14px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 12px;
  }
  .grid2.even {
    grid-template-columns: 1fr 1fr;
  }
  label,
  .field {
    display: grid;
    gap: 4px;
    font-size: 0.86rem;
    font-weight: 600;
  }
  small {
    font-weight: 400;
    color: var(--color-muted);
    font-size: 0.78rem;
  }
  input:not([type="checkbox"]):not([type="radio"]),
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
  .danger {
    color: var(--color-primary);
    justify-self: start;
  }
  .tagset {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tg {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border: 1px solid var(--c);
    border-radius: 999px;
    background: #fff;
    color: var(--c);
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .tg.on {
    background: var(--c);
    color: #fff;
  }
  .tg.hidden-tag {
    opacity: 0.55;
  }
  .onmap {
    font-size: 0.7rem;
    margin-left: 2px;
  }
  .usage {
    margin: 0 0 10px;
    padding-left: 20px;
    font-size: 0.88rem;
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
