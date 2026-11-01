<script lang="ts">
  // 본문 지도 블록(.blk-map) — 썸네일(정적 지도·마커)을 그리고, 누르면 본문의 장소들을 묶어 큰 지도(KakaoMap)로 연다.
  // 카카오맵 컴포넌트는 처음 열 때 동적으로 불러온다.
  // 복원(2026-11-01): 배포본 클라이언트(_astro/MapBundle.*.js) 기준.
  import { onMount, tick, type Component } from "svelte";
  import { hasKakaoKey, loadKakaoMaps } from "../lib/kakao-maps";
  import { iconPath, MAP_HOME } from "../lib/map-categories";

  interface Place {
    id: string;
    slug: string;
    name: string;
    name_hanja?: string;
    coord: [number, number];
    kind?: string;
    color?: string;
    icon?: string;
    href?: string;
  }

  let open = $state(false);
  let bundle = $state<string[]>([]);
  let active = $state("");
  let places = $state<Place[]>([]);
  let box = $state<HTMLElement | null>(null);
  let KakaoMap = $state<Component<any> | null>(null);
  let drawerOpen = $state(false);
  let wide = $state(true);
  let allPoints: Place[] | null = null;

  /** 블록 요소의 data-* → 장소 */
  function fromBlock(el: HTMLElement): Place | null {
    const id = el.dataset.mapPoint ?? "";
    const lat = Number(el.dataset.lat);
    const lng = Number(el.dataset.lng);
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const icon = el.dataset.icon || "doc";
    return {
      id,
      slug: id,
      name: el.dataset.name ?? "",
      name_hanja: el.dataset.hanja || undefined,
      coord: [lat, lng],
      color: icon === "doc" ? undefined : el.dataset.color,
      icon,
    };
  }

  /** 참고 서랍(.sd) 안의 블록은 서랍이 따로 처리한다 */
  const inDrawer = (el: Element) => !!el.closest(".sd");

  /** 썸네일 위 마커 아이콘 */
  function paintMarker(el: HTMLElement) {
    const mk = el.querySelector<HTMLElement>(".map-thumb-mk");
    if (!mk || mk.dataset.painted) return;
    const icon = el.dataset.icon || "doc";
    mk.dataset.painted = "1";
    if (icon === "doc") mk.classList.add("is-doc");
    mk.style.background = icon === "doc" ? "#fff" : (el.dataset.color ?? "#7A8592");
    mk.innerHTML = `<svg viewBox="0 -960 960 960" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="${iconPath(icon)}"/></svg>`;
  }

  let io: IntersectionObserver | null = null;

  /** 썸네일 배경 — 카카오 정적 지도(위성) */
  function paintStatic(el: HTMLElement) {
    const img = el.querySelector<HTMLElement>(".map-thumb-img");
    if (!img || img.dataset.painted || !hasKakaoKey()) return;
    img.dataset.painted = "1";
    const lat = Number(el.dataset.lat);
    const lng = Number(el.dataset.lng);
    loadKakaoMaps()
      .then((kakao) => {
        const center = new kakao.maps.LatLng(lat, lng);
        img.innerHTML = "";
        img.dataset.w = String(img.clientWidth);
        img.dataset.h = String(img.clientHeight);
        new kakao.maps.StaticMap(img, { center, level: 3, mapTypeId: kakao.maps.MapTypeId.HYBRID });
        img.classList.add("is-ready");
      })
      .catch(() => {
        img.dataset.painted = "";
      });
  }

  // 크기가 바뀐 썸네일은(8px 이상) 잠시 뒤 다시 그린다
  let ro: ResizeObserver | null = null;
  const repaintTimers = new Map<Element, number>();
  function onResized(entries: ResizeObserverEntry[]) {
    for (const en of entries) {
      const img = en.target as HTMLElement;
      if (!img.dataset.painted || !img.dataset.w) continue;
      const dw = Math.abs(img.clientWidth - Number(img.dataset.w));
      const dh = Math.abs(img.clientHeight - Number(img.dataset.h));
      if (dw < 8 && dh < 8) continue;
      clearTimeout(repaintTimers.get(img));
      repaintTimers.set(
        img,
        window.setTimeout(() => {
          const blk = img.closest<HTMLElement>(".blk-map[data-map-point]");
          if (blk) {
            img.dataset.painted = "";
            paintStatic(blk);
          }
        }, 250),
      );
    }
  }

  function scan() {
    document.querySelectorAll<HTMLElement>(".blk-map[data-map-point]").forEach((el) => {
      if (el.dataset.mbInit) return;
      el.dataset.mbInit = "1";
      paintMarker(el);
      const img = el.querySelector(".map-thumb-img");
      if (img && ro) ro.observe(img);
      if (io) io.observe(el);
      else paintStatic(el);
    });
  }

  async function openAt(el: HTMLElement) {
    // 본문(서랍 밖)의 지도 블록 장소들을 한 묶음으로
    const blocks = [...document.querySelectorAll<HTMLElement>(".blk-map[data-map-point]")].filter(
      (b) => !inDrawer(b),
    );
    const inBody: Place[] = [];
    for (const b of blocks) {
      const p = fromBlock(b);
      if (p && !inBody.some((x) => x.id === p.id)) inBody.push(p);
    }
    const here = fromBlock(el);
    if (!here || !inBody.length || !hasKakaoKey()) return;
    const [mod, points] = await Promise.all([import("./KakaoMap.svelte"), loadAllPoints()]);
    KakaoMap = mod.default;
    const byId = new Map(points.map((p) => [p.id, p]));
    for (const p of inBody) byId.set(p.id, { ...(byId.get(p.id) ?? {}), ...p });
    places = [...byId.values()];
    bundle = inBody.map((p) => p.id);
    active = here.id;
    document.documentElement.style.overflow = "hidden";
    open = true;
    await tick();
    syncInsets();
  }

  /** 전체 지도 장소(한 번만 받는다) */
  async function loadAllPoints(): Promise<Place[]> {
    if (allPoints) return allPoints;
    try {
      allPoints = ((await fetch("/api/content/map-points").then((r) => r.json()))?.points ?? []).map(
        (p: any) => ({
          id: p.id,
          slug: p.id,
          name: p.name,
          name_hanja: p.name_hanja ?? undefined,
          coord: [p.lat, p.lng],
          kind: p.kind,
          color: p.icon === "doc" ? undefined : p.color,
          icon: p.icon,
          href: p.place?.href ?? "",
        }),
      );
    } catch {
      allPoints = [];
    }
    return allPoints!;
  }

  /** 지도 상자 위치를 CSS 변수로 — 참고 서랍이 지도 옆에 붙는다 */
  function syncInsets() {
    const root = document.documentElement;
    if (!box) return;
    const r = box.getBoundingClientRect();
    root.style.setProperty("--jb-sd-top", `${Math.max(0, r.top)}px`);
    root.style.setProperty("--jb-sd-right", `${Math.max(0, window.innerWidth - r.right)}px`);
    root.style.setProperty("--jb-sd-bottom", `${Math.max(0, window.innerHeight - r.bottom)}px`);
  }

  function clearInsets() {
    const root = document.documentElement;
    for (const k of ["--jb-sd-top", "--jb-sd-right", "--jb-sd-bottom"]) root.style.removeProperty(k);
  }

  function close() {
    if (!open) return;
    open = false;
    document.documentElement.style.overflow = "";
    clearInsets();
    window.dispatchEvent(new CustomEvent("jb:drawer-modal-end"));
  }

  onMount(() => {
    if ("IntersectionObserver" in window)
      io = new IntersectionObserver(
        (entries) => {
          for (const en of entries)
            if (en.isIntersecting) {
              io?.unobserve(en.target);
              paintStatic(en.target as HTMLElement);
            }
        },
        { rootMargin: "200px" },
      );
    if ("ResizeObserver" in window) ro = new ResizeObserver(onResized);
    scan();
    // 본문이 나중에 그려져도(모달 등) 지도 블록을 찾는다
    let raf = 0;
    const mo = new MutationObserver(() => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          scan();
        });
    });
    mo.observe(document.body, { childList: true, subtree: true });

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const thumb = (e.target as Element | null)?.closest?.(".blk-map .map-thumb");
      if (!thumb || inDrawer(thumb)) return;
      e.preventDefault();
      const blk = thumb.closest<HTMLElement>(".blk-map[data-map-point]");
      if (blk) openAt(blk);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open && !document.querySelector("dialog[open]")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      }
    };
    const onResize = () => {
      wide = window.innerWidth > 760;
      if (open) syncInsets();
    };
    onResize();
    const onDrawer = (e: Event) => (drawerOpen = !!(e as CustomEvent).detail?.open);
    window.addEventListener("jb:drawer-state", onDrawer);
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      mo.disconnect();
      io?.disconnect();
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("jb:drawer-state", onDrawer);
      if (open) close();
    };
  });

  const initial = $derived(places.find((p) => p.id === active)?.coord ?? MAP_HOME.center);
</script>

{#if open && KakaoMap}
  <div class="mb-layer" role="dialog" aria-modal="true" aria-label="본문 장소 지도">
    <button type="button" class="mb-dim" aria-label="지도 닫기" tabindex="-1" onclick={close}></button>
    <div class="mb-box" bind:this={box} style:--km-right-inset={drawerOpen && wide ? "420px" : "0px"}>
      <KakaoMap
        mode="display"
        height="100%"
        level={MAP_HOME.level}
        {initial}
        mapType="hybrid"
        fitBounds={false}
        {places}
        hrefPrefix=""
        drawerKind="point"
        htmlMarkers
        {bundle}
        bundleActive={active}
        controls
        controlsTop="12px"
        onClose={close}
      />
    </div>
  </div>
{/if}

<style>
  .mb-layer {
    position: fixed;
    inset: 0;
    z-index: 90;
    display: grid;
    place-items: center;
  }
  .mb-dim {
    position: absolute;
    inset: 0;
    border: 0;
    padding: 0;
    background: #140e0a9e;
    cursor: default;
  }
  .mb-box {
    position: relative;
    width: min(1280px, calc(100vw - 64px));
    height: calc(100dvh - 64px);
    border-radius: var(--radius-lg, 12px);
    overflow: hidden;
    background: #1b1714;
    box-shadow: 0 24px 60px #00000073;
  }
  .mb-box :global(.km-top),
  .mb-box :global(.km-bottom) {
    transition: right 0.18s ease-out;
  }
  .mb-box :global(.map-container) {
    border: 0;
    border-radius: 0;
  }
  @media (max-width: 760px) {
    .mb-box {
      width: 100vw;
      height: 100dvh;
      border-radius: 0;
    }
  }
</style>
