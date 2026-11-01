<script lang="ts">
  // 지도 위치 고르기 — 정적 지도 썸네일을 누르면 <dialog> 안의 카카오맵(input 모드)에서 위치를 고른다.
  // 고른 좌표는 KakaoMap 이 window 'jsbooks:coord-pick' 이벤트로 알린다(받는 쪽이 lat/lng 을 바꾼다).
  // 복원(2026-11-01): 배포본 _astro/BlockEditor.*.js 에 함께 묶인 컴포넌트(export P). 파일 이름은 추정.
  import { onMount, tick } from "svelte";
  import { adminApi } from "../lib/blocks";
  import { loadKakaoMaps } from "../lib/kakao-maps";
  import { MAP_HOME, markerForKind } from "../lib/map-categories";
  import KakaoMap from "./KakaoMap.svelte";

  let {
    lat,
    lng,
    itemId = null,
    kind = "",
  }: {
    lat: number | string | null;
    lng: number | string | null;
    itemId?: string | null;
    kind?: string;
  } = $props();

  const hasCoord = $derived(
    lat !== "" &&
      lng !== "" &&
      lat != null &&
      lng != null &&
      Number.isFinite(Number(lat)) &&
      Number.isFinite(Number(lng)),
  );
  const pickColor = $derived(markerForKind(kind).color);

  let staticEl = $state<HTMLElement | null>(null);
  let dialog = $state<HTMLDialogElement | null>(null);
  let mapOpen = $state(false);
  let failed = $state(false);

  // 썸네일 — 카카오 정적 지도(위성)
  $effect(() => {
    const el = staticEl;
    const la = Number(lat);
    const ln = Number(lng);
    const ok = hasCoord;
    if (!el || !ok) return;
    let gone = false;
    loadKakaoMaps()
      .then((kakao) => {
        if (gone) return;
        el.innerHTML = "";
        const pos = new kakao.maps.LatLng(la, ln);
        new kakao.maps.StaticMap(el, {
          center: pos,
          level: 3,
          mapTypeId: kakao.maps.MapTypeId.HYBRID,
          marker: { position: pos },
        });
        failed = false;
      })
      .catch(() => (failed = true));
    return () => {
      gone = true;
    };
  });

  /** 다른 지도 장소(자기 자신 제외) — 겹치지 않게 보이도록 */
  let points = $state<any[] | null>(null);
  let tags = $state<any[]>([]);
  const others = $derived((points ?? []).filter((p) => p.id !== itemId));
  const onMap = $derived(
    others
      .filter((p) => typeof p.lat === "number" && typeof p.lng === "number")
      .map((p) => ({
        id: p.id,
        slug: p.id,
        name: p.name,
        name_hanja: p.name_hanja ?? undefined,
        kind: p.kind,
        color: p.icon === "doc" ? undefined : p.color,
        icon: p.icon,
        coord: [p.lat, p.lng] as [number, number],
      })),
  );
  const searchable = $derived(
    others.map((p) => ({
      id: p.id,
      slug: p.id,
      name: p.name,
      name_hanja: p.name_hanja ?? undefined,
      kind: p.kind,
      href: "",
      coord:
        typeof p.lat === "number" && typeof p.lng === "number" ? ([p.lat, p.lng] as [number, number]) : null,
    })),
  );
  let start = $state<{ center: [number, number]; pin: boolean }>({ center: MAP_HOME.center, pin: false });

  async function openMap() {
    start = hasCoord
      ? { center: [Number(lat), Number(lng)], pin: true }
      : { center: MAP_HOME.center, pin: false };
    if (points === null) {
      try {
        const [p, t] = await Promise.all([adminApi.listPoints(), adminApi.listTags()]);
        points = p.items ?? [];
        tags = t.items
          .filter((x: any) => x.on_map && x.status === "active")
          .map((x: any) => ({
            key: x.id,
            label: x.name,
            color: x.color,
            icon: x.icon,
            members: (points ?? []).filter((q) => q.id !== itemId && q.tags?.includes(x.id)).map((q) => q.id),
          }))
          .filter((x: any) => x.members.length > 0);
      } catch {
        points = [];
      }
    }
    dialog?.showModal();
    await tick();
    mapOpen = true;
  }

  function closeMap() {
    dialog?.close();
    mapOpen = false;
  }

  onMount(() => () => dialog?.close());
</script>

<button
  type="button"
  class="plp-thumb"
  class:is-empty={!hasCoord}
  aria-label="지도에서 위치 설정"
  onclick={openMap}
>
  {#if hasCoord}
    <div class="plp-static" bind:this={staticEl}></div>
    {#if failed}<span class="plp-err">지도를 불러오지 못했습니다</span>{/if}
    <span class="plp-edit"
      ><svg viewBox="0 -960 960 960" aria-hidden="true"
        ><path
          d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z"
        ></path></svg
      > 위치 변경</span
    >
  {:else}
    <span class="plp-empty"
      ><svg viewBox="0 -960 960 960" aria-hidden="true"
        ><path
          d="M480-480q33 0 56.5-23.5T560-560q0-33-23.5-56.5T480-640q-33 0-56.5 23.5T400-560q0 33 23.5 56.5T480-480Zm0 294q122-112 181-203.5T720-552q0-109-69.5-178.5T480-800q-101 0-170.5 69.5T240-552q0 71 59 162.5T480-186Zm0 106Q319-217 239.5-334.5T160-552q0-150 96.5-239T480-880q127 0 223.5 89T800-552q0 100-79.5 217.5T480-80Z"
        ></path></svg
      > 위치 설정</span
    >
  {/if}
</button>
<dialog
  class="plp-dialog"
  aria-label="위치 설정 지도"
  bind:this={dialog}
  oncancel={(e) => {
    e.preventDefault();
    closeMap();
  }}
>
  {#if mapOpen}
    <KakaoMap
      mode="input"
      height="100%"
      level={MAP_HOME.level}
      initial={start.center}
      pickInitial={start.pin}
      mapType={MAP_HOME.mapType as any}
      fitBounds={false}
      places={onMap}
      hrefPrefix=""
      controls
      controlsTop="12px"
      categories={tags}
      htmlMarkers
      homeLabel={MAP_HOME.label}
      searchPlaceholder="지도 검색"
      searchPlaces={searchable}
      {pickColor}
      onClose={closeMap}
    />
  {/if}
</dialog>

<style>
  .plp-thumb {
    position: relative;
    display: block;
    width: 100%;
    height: 180px;
    padding: 0;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    overflow: hidden;
    background: #1b1714;
    cursor: pointer;
    font: inherit;
  }
  .plp-thumb:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  .plp-static {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .plp-static :global(img) {
    max-width: none;
  }
  .plp-edit {
    position: absolute;
    right: 10px;
    bottom: 10px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 12px;
    border-radius: var(--radius-md);
    background: #0e0b099e;
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
    color: #fff;
    font-size: 0.82rem;
    font-weight: 600;
  }
  .plp-edit svg,
  .plp-empty svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
  }
  .plp-thumb.is-empty {
    background: var(--color-surface-2);
    border-style: dashed;
  }
  .plp-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    color: var(--color-muted);
    font-weight: 600;
  }
  .plp-thumb.is-empty:hover .plp-empty {
    color: var(--color-primary);
  }
  .plp-err {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #ffffffb3;
    font-size: 0.84rem;
  }
  .plp-dialog {
    width: min(1200px, 94vw);
    height: 90vh;
    height: 90dvh;
    max-width: none;
    max-height: none;
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: #1b1714;
    box-shadow: 0 24px 60px #00000073;
  }
  .plp-dialog::backdrop {
    background: #0000008c;
  }
  .plp-dialog :global(.map-container) {
    border: 0;
    border-radius: 0;
  }
  @media (max-width: 760px) {
    .plp-dialog {
      width: 100vw;
      height: 100vh;
      height: 100dvh;
      border-radius: 0;
    }
  }
</style>
