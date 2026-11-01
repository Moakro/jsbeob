<svelte:options css="injected" />

<script lang="ts">
  // 지도 장소 고르기(지도 블록) — 이름으로 찾아 고른다. 관리자는 새 지도 장소를 여기서 만들어 바로 넣을 수 있다.
  // 복원(2026-11-01): 배포본 _astro/BlockEditor.*.js 에 함께 묶인 컴포넌트. 파일 이름은 추정.
  import { onMount } from "svelte";
  import { adminApi } from "../lib/blocks";
  import { hasKakaoKey } from "../lib/kakao-maps";
  import { iconPath } from "../lib/map-categories";
  import PointLocationPicker from "./PointLocationPicker.svelte";

  interface Pt {
    id: string;
    name: string;
    name_hanja?: string | null;
    lat: number;
    lng: number;
    color: string;
    icon: string;
    status: string;
  }

  let {
    mode = "member",
    onpick,
    oncancel,
  }: { mode?: "member" | "admin"; onpick: (p: Pt) => void; oncancel?: () => void } = $props();

  let all = $state<Pt[] | null>(null);
  let error = $state<string | null>(null);
  let q = $state("");
  let input = $state<HTMLInputElement | null>(null);
  const fold = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const shown = $derived.by(() => {
    const f = fold(q);
    const list = all ?? [];
    return (
      f
        ? list.filter(
            (p) => fold(p.name).includes(f) || (p.name_hanja ? fold(p.name_hanja).includes(f) : false),
          )
        : list
    ).slice(0, 40);
  });

  // 새 장소
  let creating = $state(false);
  let draft = $state<{ name: string; lat: number | string; lng: number | string }>({
    name: "",
    lat: "",
    lng: "",
  });
  let saving = $state(false);
  const STATUS: Record<string, string> = { draft: "작성 중", hidden: "숨김" };

  onMount(() => {
    input?.focus();
    (async () => {
      try {
        if (mode === "admin")
          all = (await adminApi.listPoints()).items.map((p: any) => ({
            id: p.id,
            name: p.name,
            name_hanja: p.name_hanja,
            lat: p.lat,
            lng: p.lng,
            color: p.color ?? "#FFFFFF",
            icon: p.icon ?? "doc",
            status: p.status,
          }));
        else {
          // 회원은 공개된 지도 장소만
          const r = await fetch("/api/content/map-points").then((res) => res.json());
          all = (r?.points ?? []).map((p: any) => ({
            id: p.id,
            name: p.name,
            name_hanja: p.name_hanja,
            lat: p.lat,
            lng: p.lng,
            color: p.color ?? "#FFFFFF",
            icon: p.icon ?? "doc",
            status: "published",
          }));
        }
      } catch (e) {
        error = e instanceof Error ? e.message : "지도 장소를 불러오지 못했습니다";
        all = [];
      }
    })();
    // 새 장소 위치(PointLocationPicker 의 지도)
    const onPick = (e: Event) => {
      if (!creating) return;
      const d = (e as CustomEvent).detail;
      draft.lat = Number(d.lat.toFixed(6));
      draft.lng = Number(d.lng.toFixed(6));
    };
    window.addEventListener("jsbooks:coord-pick", onPick);
    return () => window.removeEventListener("jsbooks:coord-pick", onPick);
  });

  function startCreate() {
    creating = true;
    draft = { name: q.trim(), lat: "", lng: "" };
    error = null;
  }

  async function create() {
    error = null;
    if (!draft.name.trim()) return (error = "장소 이름을 입력해 주세요.");
    if (draft.lat === "" || draft.lng === "") return (error = "지도에서 위치를 정해 주세요.");
    saving = true;
    try {
      const it = (
        await adminApi.createPoint({
          kind: "general",
          name: draft.name.trim(),
          lat: Number(draft.lat),
          lng: Number(draft.lng),
          status: "published",
          tags: [],
        })
      ).item;
      onpick({
        id: it.id,
        name: it.name,
        name_hanja: it.name_hanja,
        lat: it.lat,
        lng: it.lng,
        color: "#FFFFFF",
        icon: "doc",
        status: it.status,
      });
    } catch (e) {
      error = e instanceof Error ? e.message : "만들지 못했습니다";
    } finally {
      saving = false;
    }
  }
</script>

<div class="pp">
  {#if creating}
    <div class="nf">
      <strong>새 지도 장소</strong>
      <input bind:value={draft.name} maxlength="200" placeholder="장소 이름" />
      {#if hasKakaoKey()}
        <PointLocationPicker lat={draft.lat} lng={draft.lng} itemId={null} kind="general" />
      {:else}
        <p class="dim">지도 키가 없어 위치를 정할 수 없습니다.</p>
      {/if}
      <p class="dim">
        지도에 보이는 기존 장소와 겹치지 않는지 확인해 주세요. 태그는 지도 탭에서 붙입니다(태그가 없으면 흰색
        문서 마커).
      </p>
      <div class="row">
        <button type="button" class="btn-s primary" disabled={saving} onclick={create}
          >{saving ? "만드는 중…" : "만들고 넣기"}</button
        >
        <button type="button" class="close" onclick={() => (creating = false)}>← 목록으로</button>
      </div>
    </div>
  {:else}
    <div class="bar">
      <input
        bind:value={q}
        bind:this={input}
        placeholder={mode === "admin"
          ? "지도 장소 이름으로 찾기 (예: 영대)"
          : "사이트 지도 장소 이름으로 찾기"}
        onkeydown={(e) => e.key === "Escape" && oncancel?.()}
      />
      <button type="button" class="close" onclick={() => oncancel?.()}>닫기</button>
    </div>
    {#if all === null}
      <p class="dim">불러오는 중…</p>
    {:else if shown.length}
      <ul>
        {#each shown as p (p.id)}
          <li>
            <button type="button" onclick={() => onpick(p)}>
              <span class="mk" class:is-doc={p.icon === "doc"} style:background={p.color}
                ><svg viewBox="0 -960 960 960" width="12" height="12" aria-hidden="true"
                  ><path fill="currentColor" d={iconPath(p.icon)}></path></svg
                ></span
              >
              <span class="t"
                >{p.name}
                {#if p.name_hanja}<small>{p.name_hanja}</small>{/if}</span
              >
              {#if STATUS[p.status]}<span class="st">{STATUS[p.status]}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="dim">{q ? `"${q}"에 맞는 지도 장소가 없습니다.` : "지도 장소가 없습니다."}</p>
    {/if}
    {#if mode === "admin"}
      <div class="new">
        <button type="button" class="btn-s" onclick={startCreate}>+ 새 지도 장소 만들기</button>
        <span class="dim">찾는 곳이 없으면 여기서 만들어 바로 넣습니다. 지도 탭에서 함께 관리됩니다.</span>
      </div>
    {:else}
      <p class="dim">회원 글에는 사이트에 등록된 장소만 넣을 수 있습니다.</p>
    {/if}
  {/if}
  {#if error}<p class="err">{error}</p>{/if}
</div>

<style>
  .pp {
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    padding: 8px;
    background: var(--color-surface);
    display: grid;
    gap: 6px;
  }
  .bar,
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  input {
    flex: 1;
    padding: 7px 9px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    font: inherit;
    font-size: 0.9rem;
    background: #fff;
  }
  .close {
    border: 0;
    background: none;
    color: var(--color-muted);
    cursor: pointer;
    font-size: 0.82rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 260px;
    overflow: auto;
  }
  li button {
    display: flex;
    gap: 8px;
    align-items: center;
    width: 100%;
    text-align: left;
    padding: 6px 8px;
    border: 0;
    background: none;
    cursor: pointer;
    border-radius: var(--radius-sm);
    font: inherit;
    font-size: 0.9rem;
  }
  li button:hover {
    background: var(--color-surface-2);
  }
  .mk {
    flex: none;
    width: 20px;
    height: 20px;
    box-sizing: border-box;
    display: grid;
    place-items: center;
    border: 1.5px solid #fff;
    border-radius: 50%;
    color: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  }
  .mk.is-doc {
    border-color: #4a4038;
    color: #4a4038;
  }
  .t small {
    color: var(--color-muted);
  }
  .st {
    margin-left: auto;
    font-size: 0.72rem;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-muted);
  }
  .new {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    padding-top: 6px;
    border-top: 1px solid var(--color-rule);
  }
  .nf {
    display: grid;
    gap: 8px;
  }
  .btn-s {
    display: inline-flex;
    align-items: center;
    padding: 5px 12px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: #fff;
    font-size: 0.82rem;
    cursor: pointer;
    color: var(--color-fg);
  }
  .btn-s.primary {
    border-color: var(--color-primary);
    background: var(--color-primary);
    color: #fff;
  }
  .btn-s:disabled {
    opacity: 0.5;
  }
  .dim {
    margin: 0;
    font-size: 0.78rem;
    color: var(--color-muted);
  }
  .err {
    margin: 0;
    font-size: 0.82rem;
    color: var(--color-primary);
  }
</style>
