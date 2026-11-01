<script lang="ts">
  /**
   * 카카오맵 공유 컴포넌트 (Svelte island).
   *
   * mode="input"  — 어드민 좌표 입력. 지도 클릭/마커 드래그로 좌표를 고르면
   *   window CustomEvent `jsbooks:coord-pick` ({lat,lng}) 을 dispatch.
   *   외부에서 window event `jsbooks:map-goto` ({lat,lng} | {clear:true}) 를 보내면
   *   지도 중심 이동 + 마커 표시/제거.
   *
   * mode="display" — 공개 지도. places 의 좌표마다 마커를 찍는다.
   *   htmlMarkers/categories/bundle 이 있으면 HTML 마커(아이콘·번호·점)로 그리고,
   *   마커를 누르면 참고 서랍(jb:drawer-open)을 연다. 아니면 기본 마커 + 장소 페이지 링크.
   *
   * controls·searchPlaceholder·categories 를 주면 지도 유형/현재 위치/확대·축소 버튼,
   * 장소 검색(사이트 장소 + 카카오 장소 검색), 태그 칩이 붙는다.
   *
   * 키 미설정/로드 실패 시 throw 하지 않고 안내 박스를 렌더한다.
   */
  // 복원(2026-11-01): 9월 버전을 배포본 클라이언트(_astro/KakaoMap.*.js) 기준으로 갱신.
  import { onMount } from "svelte";
  import { loadKakaoMaps } from "../lib/kakao-maps";
  import { iconPath, DOC_MARKER, BRAND_COLOR, MARKER_DEFAULT } from "../lib/map-categories";

  type DisplayPlace = {
    id?: string;
    slug: string;
    name: string;
    name_hanja?: string;
    region?: string;
    coord: [number, number] | null;
    kind?: string;
    color?: string;
    icon?: string;
    href?: string;
  };
  type Category = { key: string; label: string; color: string; icon?: string; members: string[] };

  let {
    mode,
    places = [],
    initial = null,
    level = 8,
    height = "420px",
    hrefPrefix = "/archive/places/",
    controls = false,
    controlsTop = "12px",
    mapType = "roadmap",
    fitBounds = true,
    categories = [],
    htmlMarkers = false,
    bundle = [],
    bundleActive = "",
    initialCat = "",
    searchPlaceholder = "",
    searchPlaces = [],
    aiButton = false,
    homeLabel = "",
    pickColor = "",
    pickInitial = true,
    drawerKind = "place",
    onClose,
  }: {
    mode: "input" | "display";
    places?: DisplayPlace[];
    initial?: [number, number] | null;
    level?: number;
    height?: string;
    hrefPrefix?: string;
    controls?: boolean;
    controlsTop?: string;
    mapType?: "roadmap" | "terrain" | "hybrid";
    fitBounds?: boolean;
    categories?: Category[];
    htmlMarkers?: boolean;
    /** 본문 지도 묶음(MapBundle) — 이 장소들만 번호 마커로 */
    bundle?: string[];
    bundleActive?: string;
    initialCat?: string;
    searchPlaceholder?: string;
    searchPlaces?: DisplayPlace[];
    aiButton?: boolean;
    homeLabel?: string;
    /** input 모드 마커 색 */
    pickColor?: string;
    pickInitial?: boolean;
    /** 참고 서랍에서 여는 종류 */
    drawerKind?: "place" | "point";
    onClose?: () => void;
  } = $props();

  // Material Symbols 경로
  const ICON = {
    map: "m600-120-240-84-186 72q-20 8-37-4.5T120-170v-560q0-13 7.5-23t20.5-15l212-72 240 84 186-72q20-8 37 4.5t17 33.5v560q0 13-7.5 23T812-192l-212 72Zm-40-98v-468l-160-56v468l160 56Zm80 0 120-40v-474l-120 46v468Zm-440-10 120-46v-468l-120 40v474Zm440-458v468-468Zm-320-56v468-468Z",
    terrain:
      "m40-240 240-320 180 240h300L560-586 460-454l-50-66 150-200 360 480H40Zm521-80Zm-361 0h160l-80-107-80 107Zm0 0h160-160Z",
    satellite:
      "M560-32v-80q117 0 198.5-81.5T840-392h80q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T560-32Zm0-160v-80q50 0 85-35t35-85h80q0 83-58.5 141.5T560-192ZM222-57q-15 0-30-6t-27-17L23-222q-11-12-17-27t-6-30q0-16 6-30.5T23-335l127-127q23-23 57-23.5t57 22.5l50 50 28-28-50-50q-23-23-23-56t23-56l57-57q23-23 56.5-23t56.5 23l50 50 28-28-50-50q-23-23-23-56.5t23-56.5l127-127q12-12 27-18t30-6q15 0 29.5 6t26.5 18l142 142q12 11 17.5 25.5T895-730q0 15-5.5 30T872-673L745-546q-23 23-56.5 23T632-546l-50-50-28 28 50 50q23 23 22.5 56.5T603-405l-56 56q-23 23-56.5 23T434-349l-50-50-28 28 50 50q23 23 22.5 57T405-207L278-80q-11 11-25.5 17T222-57Zm0-79 42-42-142-142-42 42 142 142Zm85-85 42-42-142-142-42 42 142 142Zm184-184 56-56-142-142-56 56 142 142Zm198-198 42-42-142-142-42 42 142 142Zm85-85 42-42-142-142-42 42 142 142ZM448-504Z",
    myLocation:
      "M440-42v-80q-125-14-214.5-103.5T122-440H42v-80h80q14-125 103.5-214.5T440-838v-80h80v80q125 14 214.5 103.5T838-520h80v80h-80q-14 125-103.5 214.5T520-122v80h-80Zm238-240q82-82 82-198t-82-198q-82-82-198-82t-198 82q-82 82-82 198t82 198q82 82 198 82t198-82Zm-311-85q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47Zm169.5-56.5Q560-447 560-480t-23.5-56.5Q513-560 480-560t-56.5 23.5Q400-513 400-480t23.5 56.5Q447-400 480-400t56.5-23.5ZM480-480Z",
    add: "M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z",
    search:
      "M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z",
    close:
      "m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z",
    ai: "m760-600-50-110-110-50 110-50 50-110 50 110 110 50-110 50-50 110Zm0 560-50-110-110-50 110-50 50-110 50 110 110 50-110 50-50 110ZM360-160 260-380 40-480l220-100 100-220 100 220 220 100-220 100-100 220Zm0-194 40-86 86-40-86-40-40-86-40 86-86 40 86 40 40 86Zm0-126Z",
    remove: "M200-440v-80h560v80H200Z",
    home: "M160-120v-480l320-240 320 240v480H560v-280H400v280H160Z",
  };
  const MAP_TYPES = [
    { key: "roadmap", icon: ICON.map, label: "일반" },
    { key: "terrain", icon: ICON.terrain, label: "지형" },
    { key: "hybrid", icon: ICON.satellite, label: "위성" },
  ];

  /** input 모드 마커 이미지(pickColor 일 때만) */
  function pickImage(kakao: any) {
    if (!pickColor) return undefined;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 46" width="34" height="46"><path d="M17 44 C 12 34 4 25 4 17 A 13 13 0 1 1 30 17 C 30 25 22 34 17 44 Z" fill="${pickColor}" stroke="#fff" stroke-width="2"/><circle cx="17" cy="17" r="5" fill="#fff"/></svg>`;
    return new kakao.maps.MarkerImage(
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg),
      new kakao.maps.Size(34, 46),
      { offset: new kakao.maps.Point(17, 44) },
    );
  }

  let pickAt: ((lat: number, lng: number) => void) | null = null;
  let container: HTMLDivElement;
  let errorMsg = $state<string | null>(null);
  let ready = $state(false);
  let map: any = null;
  let kakaoNs: any = null;
  let hereOverlay: any = null;
  let typeIdx = $state(0);
  let locating = $state(false);
  let locateSeq = 0;
  let toast = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  const useHtml = htmlMarkers || categories.length > 0 || bundle.length > 0;
  const BUNDLE_KEY = "__bundle";
  const isBundle = bundle.length > 0;
  /** 선택된 칩(태그 key 또는 BUNDLE_KEY) */
  let activeCat = $state<string | null>(null);
  let markers: { place: DisplayPlace; el: HTMLDivElement; overlay: any }[] = [];

  const styleOf = (p: DisplayPlace) =>
    p.color ? { color: p.color, icon: p.icon ?? "pin" } : { color: DOC_MARKER.color, icon: DOC_MARKER.icon };
  const hasCoord = (p: DisplayPlace) =>
    Array.isArray(p.coord) && Number.isFinite(p.coord[0]) && Number.isFinite(p.coord[1]);
  const placedIds = $derived(new Set(places.filter(hasCoord).map((p) => p.id ?? p.slug)));

  /** 칩에 속하고 지도에 위치가 있는 장소 id */
  function membersOf(key: string | null): string[] {
    if (key === null) return [];
    const list = key === BUNDLE_KEY ? bundle : (categories.find((c) => c.key === key)?.members ?? []);
    return list.filter((id) => placedIds.has(id));
  }
  const counts = $derived(Object.fromEntries(categories.map((c) => [c.key, membersOf(c.key).length])));

  // ── 부드러운 이동 ──
  let panRaf = 0;
  function stopPan() {
    if (panRaf) cancelAnimationFrame(panRaf);
    panRaf = 0;
  }
  function panTo(lat: number, lng: number, done?: () => void) {
    if (!map || !kakaoNs) return;
    stopPan();
    const target = new kakaoNs.maps.LatLng(lat, lng);
    const c = map.getCenter();
    const lat0 = c.getLat();
    const lng0 = c.getLng();
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const proj = map.getProjection();
    const a = proj.containerPointFromCoords(c);
    const b = proj.containerPointFromCoords(target);
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (reduce || dist < 1) {
      map.setCenter(target);
      done?.();
      return;
    }
    const dur = Math.min(1100, Math.max(450, 350 + dist * 0.25));
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = ease(k);
      map.setCenter(new kakaoNs.maps.LatLng(lat0 + (lat - lat0) * e, lng0 + (lng - lng0) * e));
      panRaf = k < 1 ? requestAnimationFrame(step) : 0;
      if (k >= 1) done?.();
    };
    panRaf = requestAnimationFrame(step);
  }

  /** 받침이 있으면 "이", 없으면 "가" */
  function josaIga(word: string) {
    const code = word.charCodeAt(word.length - 1) - 44032;
    return code >= 0 && code <= 11171 && code % 28 !== 0 ? "이" : "가";
  }

  function iconSvg(path: string, size: number) {
    return `<svg viewBox="0 -960 960 960" width="${size}" height="${size}" aria-hidden="true"><path fill="currentColor" d="${path}"/></svg>`;
  }

  // ── HTML 마커 그리기 ──
  /** 이 거리(px) 안에 겹친 마커는 점으로 */
  const CROWD_PX = 30;
  let crowded = new Set<string>();
  let selectedId: string | null = null;
  let bounceId: string | null = null;
  const keyOf = (p: DisplayPlace) => p.id ?? p.slug;

  function measureCrowd() {
    const out = new Set<string>();
    if (map && kakaoNs && activeCat === null) {
      const proj = map.getProjection();
      const pts = markers.map((m) => ({
        k: keyOf(m.place),
        p: proj.containerPointFromCoords(m.overlay.getPosition()),
      }));
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++)
          if (Math.hypot(pts[i].p.x - pts[j].p.x, pts[i].p.y - pts[j].p.y) < CROWD_PX) {
            out.add(pts[i].k);
            out.add(pts[j].k);
          }
    }
    crowded = out;
  }

  function paintMarkers() {
    const members = membersOf(activeCat);
    const order = new Map(members.map((id, i) => [id, i + 1]));
    for (const m of markers) {
      const st = styleOf(m.place);
      const doc = st.icon === "doc" ? " is-doc" : "";
      const k = keyOf(m.place);
      const num = order.get(k);
      const faded = activeCat !== null && num === undefined;
      const selected = selectedId === k;
      const inner = num !== undefined ? `<b class="km-num">${num}</b>` : iconSvg(iconPath(st.icon), 16);
      if (selected) {
        const bounce = bounceId === k ? " is-bounce" : "";
        m.el.className = `km-mk is-selected${bounce}${doc}`;
        m.el.innerHTML = `<span class="km-drop"><svg viewBox="0 0 34 46" width="34" height="46" aria-hidden="true"><path d="M17 44 C 12 34 4 25 4 17 A 13 13 0 1 1 30 17 C 30 25 22 34 17 44 Z" fill="${st.color}" stroke="${doc ? "#4a4038" : "#fff"}" stroke-width="2"/></svg><span class="km-drop-icon">${inner}</span></span>`;
        m.overlay.setZIndex(30);
      } else if (faded || crowded.has(k)) {
        m.el.className = (faded ? "km-mk is-dot is-faded" : "km-mk is-dot") + doc;
        m.el.innerHTML = `<span class="km-dot" style="background:${st.color}"></span>`;
        m.overlay.setZIndex(faded ? 1 : 5);
      } else {
        m.el.className = `km-mk${doc}${num !== undefined ? " is-num" : ""}`;
        m.el.innerHTML = `<span class="km-pin" style="background:${st.color}">${inner}</span>`;
        m.overlay.setZIndex(num !== undefined ? 12 : 10);
      }
    }
    bounceId = null;
  }

  function repaint() {
    if (!useHtml) return;
    measureCrowd();
    paintMarkers();
  }

  $effect(() => {
    activeCat;
    if (ready) repaint();
  });

  /** 마커 선택 → 참고 서랍 열기 */
  function selectPlace(p: DisplayPlace) {
    selectedId = keyOf(p);
    bounceId = selectedId;
    repaint();
    if (p.id)
      window.dispatchEvent(new CustomEvent("jb:drawer-open", { detail: { kind: drawerKind, id: p.id } }));
    revealMarker(selectedId, "ifHidden");
  }

  /** 서랍·검색창에 가리지 않는 지도 영역 */
  function visibleArea() {
    const W = container.clientWidth;
    const H = container.clientHeight;
    const rect = container.getBoundingClientRect();
    const sheetH =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--jb-sheet-h")) || 0;
    const side = document.querySelector(".sd:not(.is-sheet)")?.getBoundingClientRect();
    return {
      left: 0,
      right: side && side.left < rect.right && side.left > rect.left ? side.left - rect.left : W,
      top: searchPlaceholder ? 130 : 0,
      bottom: H - sheetH,
      W,
      H,
    };
  }

  /** 선택 마커가 가려져 있으면(또는 how="center") 보이는 영역 가운데로 */
  function revealMarker(id: string | null, how: "ifHidden" | "center") {
    requestAnimationFrame(() => {
      if (!map || !kakaoNs || !container || id === null) return;
      const m = markers.find((x) => keyOf(x.place) === id);
      if (!m) return;
      const area = visibleArea();
      if (how === "ifHidden" && area.bottom === area.H && area.right === area.W) return;
      const proj = map.getProjection();
      const pt = proj.containerPointFromCoords(m.overlay.getPosition());
      const visible =
        pt.y > area.top + 46 && pt.y < area.bottom - 40 && pt.x > area.left + 20 && pt.x < area.right - 20;
      if (how === "ifHidden" && visible) return;
      const cx = (area.left + area.right) / 2;
      const cy = (area.top + area.bottom) / 2;
      const c = proj.coordsFromContainerPoint(
        new kakaoNs.maps.Point(pt.x - cx + area.W / 2, pt.y - cy + area.H / 2),
      );
      panTo(c.getLat(), c.getLng());
    });
  }

  /** 참고 서랍 상태가 바뀌면 선택 마커를 맞춘다 */
  function onDrawerState(e: Event) {
    const d = (e as CustomEvent).detail;
    if (activeCat !== null && !isBundle && d?.count === 0) activeCat = null;
    const id = d?.open && d.key?.startsWith(`${drawerKind}:`) ? d.key.slice(drawerKind.length + 1) : null;
    if (id === selectedId) return;
    selectedId = id && markers.some((m) => keyOf(m.place) === id) ? id : null;
    repaint();
    if (selectedId) revealMarker(selectedId, "center");
  }

  /** 태그 칩 */
  function toggleCat(c: Category, ev: MouseEvent) {
    (ev.currentTarget as HTMLElement | null)?.blur();
    if (activeCat === c.key) {
      activeCat = null;
      if (mode === "input") return repaint();
      selectedId = null;
      repaint();
      window.dispatchEvent(new CustomEvent("jb:drawer-clear"));
      return;
    }
    const ids = membersOf(c.key);
    if (!ids.length) return flash(`지도에 위치가 등록된 ${c.label}${josaIga(c.label)} 아직 없습니다.`);
    openBundle(c.key, ids, ids[0], false);
  }

  const SINGLE_LEVEL = 4;

  /** 칩·본문 묶음 열기 — 서랍에 장소 목록을 넘기고 지도를 그 장소들에 맞춘다 */
  function openBundle(key: string, ids: string[], first: string, modal: boolean) {
    activeCat = key;
    if (mode === "input") {
      repaint();
      fitTo(ids, true);
      return;
    }
    selectedId = first;
    bounceId = first;
    repaint();
    const active = Math.max(0, ids.indexOf(first));
    const send = () =>
      window.dispatchEvent(
        new CustomEvent("jb:drawer-bundle", {
          detail: { items: ids.map((id) => ({ kind: drawerKind, id })), active, modal },
        }),
      );
    if ((window as any).__jbDrawerReady) send();
    else window.addEventListener("jb:drawer-ready", send, { once: true });
    fitTo(ids, !modal);
  }

  let fitSeq = 0;
  /** 장소들이 서랍·칩에 가리지 않게 보이도록 지도를 맞춘다(animate 면 부드럽게) */
  function fitTo(ids: string[], animate = false) {
    if (!map || !kakaoNs) return;
    const pts = ids
      .map((id) => places.find((p) => keyOf(p) === id))
      .filter((p): p is DisplayPlace => !!p && hasCoord(p));
    if (!pts.length) return;
    const narrow = container.clientWidth <= 760;
    const padTop = searchPlaceholder ? 110 : 56;
    const padRight = narrow ? 56 : Math.min(460, container.clientWidth * 0.45);
    const padBottom = narrow ? Math.round(window.innerHeight * 0.3) + 24 : 60;
    const padLeft = categories.length && !narrow ? 150 : 48;
    if (!animate) {
      if (pts.length === 1) {
        map.setLevel(SINGLE_LEVEL);
        map.setCenter(new kakaoNs.maps.LatLng(pts[0].coord![0], pts[0].coord![1]));
        revealMarker(keyOf(pts[0]), "ifHidden");
        return;
      }
      const b = new kakaoNs.maps.LatLngBounds();
      for (const p of pts) b.extend(new kakaoNs.maps.LatLng(p.coord![0], p.coord![1]));
      map.setBounds(b, padTop, padRight, padBottom, padLeft);
      return;
    }
    // 목표 레벨·중심을 직접 계산해 부드럽게 이동
    const W = container.clientWidth;
    const H = container.clientHeight;
    const lv = map.getLevel();
    const proj = map.getProjection();
    const xy = pts.map((p) =>
      proj.containerPointFromCoords(new kakaoNs.maps.LatLng(p.coord![0], p.coord![1])),
    );
    const minX = Math.min(...xy.map((p) => p.x));
    const maxX = Math.max(...xy.map((p) => p.x));
    const minY = Math.min(...xy.map((p) => p.y));
    const maxY = Math.max(...xy.map((p) => p.y));
    const availW = Math.max(60, W - padLeft - padRight - 40);
    const availH = Math.max(60, H - padTop - padBottom - 40 - 46);
    const ratio = Math.max((maxX - minX) / availW, (maxY - minY) / availH);
    const target =
      pts.length === 1 || ratio <= 0
        ? SINGLE_LEVEL
        : Math.min(14, Math.max(1, Math.ceil(lv + Math.log2(ratio) - 1e-6)));
    const scale = Math.pow(2, target - lv);
    const offX = (padLeft - padRight) / 2;
    const offY = (padTop + 46 - padBottom) / 2;
    const cx = (minX + maxX) / 2 - offX * scale;
    const cy = (minY + maxY) / 2 - offY * scale;
    const c = proj.coordsFromContainerPoint(new kakaoNs.maps.Point(cx, cy));
    const lat = c.getLat();
    const lng = c.getLng();
    const seq = ++fitSeq;
    const ZOOM_MS = 380;
    const zoom = (then?: () => void) => {
      if (seq !== fitSeq) return;
      if (target === map.getLevel()) return then?.();
      map.setLevel(target, { animate: { duration: ZOOM_MS } });
      setTimeout(() => seq === fitSeq && then?.(), ZOOM_MS + 60);
    };
    // 확대는 먼저 줌·나중에 이동, 축소는 먼저 이동·나중에 줌
    if (target > lv) zoom(() => panTo(lat, lng));
    else panTo(lat, lng, () => zoom());
  }

  // ── 지도 검색 ──
  let query = $state("");
  let resultsOpen = $state(false);
  let searched = $state("");
  let siteHits = $state<DisplayPlace[]>([]);
  let mapHits = $state<{ id: string; name: string; sub: string; lat: number; lng: number }[]>([]);
  let mapStatus = $state<"idle" | "loading" | "done" | "error">("idle");
  let searchSeq = 0;
  let searchBox = $state<HTMLElement | null>(null);
  let hitOverlay: any = null;
  const fold = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  /** 카카오 검색 결과 색 — 법종교 장소는 대표색 */
  function hitStyle(name: string) {
    return /법종교/.test(name) ? { color: BRAND_COLOR } : MARKER_DEFAULT;
  }

  function search(e?: Event) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    searched = q;
    resultsOpen = true;
    const f = fold(q);
    siteHits = searchPlaces
      .filter((p) => fold(p.name).includes(f) || (p.name_hanja ? fold(p.name_hanja).includes(f) : false))
      .slice(0, 8);
    mapHits = [];
    const svc = kakaoNs?.maps?.services;
    if (!svc || !map) {
      mapStatus = "error";
      return;
    }
    mapStatus = "loading";
    const seq = ++searchSeq;
    const S = svc.Status;
    const toHit = (d: any, i: number) => ({
      id: String(d.id ?? `${d.x},${d.y},${i}`),
      name: d.place_name || d.address_name,
      sub: d.place_name ? d.road_address_name || d.address_name || "" : (d.road_address?.address_name ?? ""),
      lat: Number(d.y),
      lng: Number(d.x),
    });
    // 장소 이름 검색 → 없으면 주소 검색
    new svc.Places().keywordSearch(
      q,
      (data: any[], status: string) => {
        if (seq !== searchSeq) return;
        if (status === S.OK) {
          mapHits = data.slice(0, 6).map(toHit);
          mapStatus = "done";
        } else if (status === S.ZERO_RESULT) {
          new svc.Geocoder().addressSearch(q, (d2: any[], s2: string) => {
            if (seq !== searchSeq) return;
            mapHits = s2 === S.OK ? d2.slice(0, 6).map(toHit) : [];
            mapStatus = s2 === S.OK || s2 === S.ZERO_RESULT ? "done" : "error";
          });
        } else mapStatus = "error";
      },
      { location: map.getCenter(), size: 6 },
    );
  }

  function closeResults() {
    resultsOpen = false;
  }

  function clearSearch() {
    query = "";
    searched = "";
    siteHits = [];
    mapHits = [];
    mapStatus = "idle";
    resultsOpen = false;
    searchSeq++;
    hitOverlay?.setMap(null);
    hitOverlay = null;
  }

  function pickSiteHit(p: DisplayPlace) {
    if (mode === "input") {
      closeResults();
      if (!p.coord) return flash(`${p.name} — 아직 위치가 없는 장소입니다.`);
      pickAt?.(p.coord[0], p.coord[1]);
      panTo(p.coord[0], p.coord[1]);
      return;
    }
    if (!p.coord) {
      window.location.href = p.href!;
      return;
    }
    closeResults();
    hitOverlay?.setMap(null);
    hitOverlay = null;
    selectPlace(p);
    if (map && kakaoNs) panTo(p.coord[0], p.coord[1]);
  }

  function pickMapHit(h: { name: string; lat: number; lng: number }) {
    closeResults();
    if (!map || !kakaoNs) return;
    if (mode === "input") {
      pickAt?.(h.lat, h.lng);
      panTo(h.lat, h.lng);
      return;
    }
    const pos = new kakaoNs.maps.LatLng(h.lat, h.lng);
    hitOverlay?.setMap(null);
    const el = document.createElement("div");
    el.className = "km-hit";
    const color = hitStyle(h.name).color;
    el.innerHTML = `<svg viewBox="0 0 34 46" width="34" height="46" aria-hidden="true"><path d="M17 44 C 12 34 4 25 4 17 A 13 13 0 1 1 30 17 C 30 25 22 34 17 44 Z" fill="${color}" stroke="#fff" stroke-width="2"/><circle cx="17" cy="17" r="5" fill="#fff"/></svg>`;
    const label = document.createElement("span");
    label.className = "km-hit-label";
    label.style.background = color;
    label.textContent = h.name;
    el.appendChild(label);
    hitOverlay = new kakaoNs.maps.CustomOverlay({
      position: pos,
      content: el,
      xAnchor: 0.5,
      yAnchor: 1,
      zIndex: 50,
    });
    hitOverlay.setMap(map);
    panTo(h.lat, h.lng);
  }

  /** 처음 화면(home) 칩 */
  function goHome(ev: MouseEvent) {
    (ev.currentTarget as HTMLElement | null)?.blur();
    if (activeCat !== null) {
      activeCat = null;
      if (mode !== "input") {
        selectedId = null;
        window.dispatchEvent(new CustomEvent("jb:drawer-clear"));
      }
    }
    hitOverlay?.setMap(null);
    hitOverlay = null;
    closeResults();
    if (!map || !kakaoNs) return;
    const c = initial ?? DEFAULT_CENTER;
    panTo(c[0], c[1]);
  }

  function onDocClick(e: MouseEvent) {
    if (resultsOpen && searchBox && !searchBox.contains(e.target as Node)) closeResults();
  }
  function onDocKey(e: KeyboardEvent) {
    if (e.key === "Escape" && resultsOpen && !document.querySelector("dialog[open]")) closeResults();
  }
  $effect(() => {
    if (!searchPlaceholder) return;
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onDocKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onDocKey);
    };
  });

  // 정읍·고부 일대 (장소 다수가 모인 호남권) 기본 중심
  const DEFAULT_CENTER: [number, number] = [35.5703, 126.8557];

  function flash(msg: string) {
    toast = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 2400);
  }

  function cycleType(ev: MouseEvent) {
    (ev.currentTarget as HTMLElement | null)?.blur();
    if (!map || !kakaoNs) return;
    setType((typeIdx + 1) % MAP_TYPES.length);
  }

  function setType(i: number) {
    if (!map || !kakaoNs) return;
    const T = kakaoNs.maps.MapTypeId;
    typeIdx = i;
    const key = MAP_TYPES[typeIdx].key;
    map.removeOverlayMapTypeId(T.TERRAIN);
    if (key === "hybrid") map.setMapTypeId(T.HYBRID);
    else {
      map.setMapTypeId(T.ROADMAP);
      if (key === "terrain") map.addOverlayMapTypeId(T.TERRAIN);
    }
  }

  function zoom(d: number, ev: MouseEvent) {
    (ev.currentTarget as HTMLElement | null)?.blur();
    map?.setLevel(map.getLevel() - d, { animate: { duration: 250 } });
  }

  function locate(ev: MouseEvent) {
    (ev.currentTarget as HTMLElement | null)?.blur();
    if (!navigator.geolocation) return flash("이 브라우저는 위치를 지원하지 않습니다.");
    if (!window.isSecureContext) return flash("보안 연결(https)에서만 현재 위치를 쓸 수 있습니다.");
    locating = true;
    const seq = ++locateSeq;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (seq !== locateSeq) return;
        locating = false;
        if (!map || !kakaoNs) return;
        const here = new kakaoNs.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
        panTo(pos.coords.latitude, pos.coords.longitude);
        hereOverlay?.setMap(null);
        hereOverlay = new kakaoNs.maps.CustomOverlay({
          position: here,
          content:
            '<div class="km-here"><span class="km-here-pulse"></span><span class="km-here-dot"></span></div>',
          xAnchor: 0.5,
          yAnchor: 0.5,
          zIndex: 100,
        });
        hereOverlay.setMap(map);
        flash("현재 위치로 이동했습니다.");
      },
      () => {
        if (seq !== locateSeq) return;
        locating = false;
        flash("위치를 찾지 못했습니다. 권한을 확인해 주세요.");
      },
      { enableHighAccuracy: true, timeout: 8e3, maximumAge: 3e5 },
    );
  }

  onMount(() => {
    let inputMarker: any = null;
    let gotoHandler: ((e: Event) => void) | null = null;
    if (useHtml) window.addEventListener("jb:drawer-state", onDrawerState);

    loadKakaoMaps()
      .then((kakao) => {
        const center = initial ?? DEFAULT_CENTER;
        map = new kakao.maps.Map(container, {
          center: new kakao.maps.LatLng(center[0], center[1]),
          level,
          draggable: true,
          scrollwheel: true,
        });
        kakaoNs = kakao;
        // 사용자가 끌거나 확대하면 진행 중인 이동을 멈춘다
        kakao.maps.event.addListener(map, "dragstart", () => {
          fitSeq++;
          stopPan();
        });
        kakao.maps.event.addListener(map, "zoom_start", stopPan);
        kakao.maps.event.addListener(map, "zoom_changed", repaint);
        if (mapType !== "roadmap")
          setType(
            Math.max(
              0,
              MAP_TYPES.findIndex((t) => t.key === mapType),
            ),
          );
        ready = true;
        if (mode === "input") {
          setupInput(kakao);
          if (useHtml) drawPlaces(kakao);
        } else drawPlaces(kakao);
      })
      .catch((e) => {
        errorMsg = e instanceof Error ? e.message : String(e);
      });

    function emitPick(lat: number, lng: number) {
      window.dispatchEvent(new CustomEvent("jsbooks:coord-pick", { detail: { lat, lng } }));
    }

    function setupInput(kakao: any) {
      function place(lat: number, lng: number) {
        const pos = new kakao.maps.LatLng(lat, lng);
        if (inputMarker) {
          inputMarker.setPosition(pos);
          inputMarker.setMap(map);
        } else {
          inputMarker = new kakao.maps.Marker({
            position: pos,
            draggable: true,
            zIndex: 40,
            image: pickImage(kakao),
          });
          inputMarker.setMap(map);
          kakao.maps.event.addListener(inputMarker, "dragend", () => {
            const p = inputMarker.getPosition();
            emitPick(p.getLat(), p.getLng());
          });
        }
      }
      if (initial && pickInitial) place(initial[0], initial[1]);
      pickAt = (lat, lng) => {
        place(lat, lng);
        emitPick(lat, lng);
      };
      kakao.maps.event.addListener(map, "click", (e: any) => {
        const ll = e.latLng;
        const lat = ll.getLat();
        const lng = ll.getLng();
        place(lat, lng);
        emitPick(lat, lng);
      });
      gotoHandler = (e: Event) => {
        const d = (e as CustomEvent).detail ?? {};
        if (d.clear) {
          inputMarker?.setMap(null);
          return;
        }
        const lat = Number(d.lat);
        const lng = Number(d.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const pos = new kakao.maps.LatLng(lat, lng);
        map.setCenter(pos);
        if (d.recenterLevel) map.setLevel(Number(d.recenterLevel));
        place(lat, lng);
      };
      window.addEventListener("jsbooks:map-goto", gotoHandler);
    }

    function drawPlaces(kakao: any) {
      const valid = places.filter(
        (p) => Array.isArray(p.coord) && Number.isFinite(p.coord[0]) && Number.isFinite(p.coord[1]),
      );
      if (valid.length === 0) return;
      const bounds = new kakao.maps.LatLngBounds();
      for (const p of valid) {
        const pos = new kakao.maps.LatLng(p.coord![0], p.coord![1]);
        bounds.extend(pos);
        if (useHtml) {
          const el = document.createElement("div");
          el.title = p.name;
          el.setAttribute("role", "link");
          el.setAttribute("aria-label", p.name);
          const href = p.href ?? (hrefPrefix ? `${hrefPrefix}${encodeURIComponent(p.slug)}/` : "");
          el.addEventListener("click", () => {
            if (mode === "input") return flash(p.name);
            if (p.id) selectPlace(p);
            else if (href) window.location.href = href;
          });
          el.className = "km-mk";
          const overlay = new kakao.maps.CustomOverlay({
            position: pos,
            content: el,
            xAnchor: 0,
            yAnchor: 0,
            clickable: true,
          });
          overlay.setMap(map);
          markers.push({ place: p, el, overlay });
          continue;
        }
        const marker = new kakao.maps.Marker({ position: pos, map, title: p.name });
        new kakao.maps.CustomOverlay({
          position: pos,
          yAnchor: 2.2,
          content: `<div class="kakao-pin-label">${escapeHtml(p.name)}</div>`,
        }).setMap(map);
        if (hrefPrefix)
          kakao.maps.event.addListener(marker, "click", () => {
            window.location.href = `${hrefPrefix}${encodeURIComponent(p.slug)}/`;
          });
      }
      if (useHtml) repaint();
      // 처음부터 고른 칩(?tag=)
      if (initialCat && !isBundle) {
        const ids = membersOf(initialCat);
        if (ids.length) openBundle(initialCat, ids, ids[0], false);
        return;
      }
      // 본문 지도 묶음
      if (isBundle) {
        const ids = membersOf(BUNDLE_KEY);
        if (ids.length) openBundle(BUNDLE_KEY, ids, ids.includes(bundleActive) ? bundleActive : ids[0], true);
        return;
      }
      if (fitBounds) {
        if (valid.length === 1) {
          map.setCenter(new kakao.maps.LatLng(valid[0].coord![0], valid[0].coord![1]));
          map.setLevel(6);
        } else map.setBounds(bounds);
      }
    }

    return () => {
      if (gotoHandler) window.removeEventListener("jsbooks:map-goto", gotoHandler);
      if (toastTimer) clearTimeout(toastTimer);
      stopPan();
      window.removeEventListener("jb:drawer-state", onDrawerState);
    };
  });

  function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
</script>

{#if errorMsg}
  <div class="map-fallback" style={`height:${height}`}>
    <div class="map-fallback-inner">
      <strong>지도를 표시할 수 없습니다</strong>
      <p>{errorMsg}</p>
      <p class="hint"><code>PUBLIC_KAKAO_JS_KEY</code> 환경변수를 설정하면 지도가 표시됩니다.</p>
    </div>
  </div>
{:else}
  <div class="kmap" class:has-search={!!searchPlaceholder} style={`height:${height};--km-top:${controlsTop}`}>
    <div class="map-container" bind:this={container}></div>
    {#if onClose}
      <button type="button" class="km-close" aria-label="지도 닫기" title="닫기" onclick={onClose}>
        <svg viewBox="0 -960 960 960" aria-hidden="true"><path d={ICON.close}></path></svg>
      </button>
    {/if}
    {#if searchPlaceholder && ready}
      <div class="km-search">
        <div class="km-sbox" bind:this={searchBox}>
          <form class="km-sform" role="search" onsubmit={search}>
            <svg class="km-s-ico" viewBox="0 -960 960 960" aria-hidden="true"
              ><path d={ICON.search}></path></svg
            >
            <input
              type="search"
              bind:value={query}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              enterkeyhint="search"
              autocomplete="off"
              onfocus={() => {
                if (searched && query.trim() === searched) resultsOpen = true;
              }}
            />
            {#if query}
              <button type="button" class="km-s-clear" aria-label="검색어 지우기" onclick={clearSearch}>
                <svg viewBox="0 -960 960 960" aria-hidden="true"><path d={ICON.close}></path></svg>
              </button>
            {/if}
            <button type="submit" class="km-s-go" aria-label="검색">
              <svg viewBox="0 -960 960 960" aria-hidden="true"><path d={ICON.search}></path></svg>
            </button>
          </form>
          {#if resultsOpen}
            <div class="km-results" role="region" aria-label="지도 검색 결과">
              <section>
                <h3>사이트 장소</h3>
                {#if siteHits.length}
                  <ul>
                    {#each siteHits as p (p.slug)}
                      {@const st = styleOf(p)}
                      {@const tag = categories.find((c) => c.members.includes(p.id ?? p.slug))}
                      <li>
                        <button type="button" onclick={() => pickSiteHit(p)}>
                          <span
                            class="km-r-dot"
                            class:is-doc={st.icon === "doc"}
                            style={`background:${st.color}`}
                          ></span>
                          <span class="km-r-main">
                            <strong
                              >{p.name}
                              {#if p.name_hanja}<small>{p.name_hanja}</small>{/if}</strong
                            >
                            <span class="km-r-sub"
                              >{(tag ? tag.label : "장소") +
                                (p.coord ? "" : " · 위치 준비 중(누르면 장소 페이지로)")}</span
                            >
                          </span>
                        </button>
                      </li>
                    {/each}
                  </ul>
                {:else}
                  <p class="km-r-empty">"{searched}"에 맞는 사이트 장소가 없습니다.</p>
                {/if}
              </section>
              <section>
                <h3>지도 검색 결과</h3>
                {#if mapStatus === "loading"}
                  <p class="km-r-empty">찾는 중…</p>
                {:else if mapStatus === "error"}
                  <p class="km-r-empty">지도 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.</p>
                {:else if mapHits.length}
                  <ul>
                    {#each mapHits as h (h.id)}
                      <li>
                        <button type="button" onclick={() => pickMapHit(h)}>
                          <span class="km-r-dot" style={`background:${hitStyle(h.name).color}`}></span>
                          <span class="km-r-main">
                            <strong>{h.name}</strong>
                            {#if h.sub}<span class="km-r-sub">{h.sub}</span>{/if}
                          </span>
                        </button>
                      </li>
                    {/each}
                  </ul>
                {:else}
                  <p class="km-r-empty">검색 결과가 없습니다.</p>
                {/if}
              </section>
            </div>
          {/if}
        </div>
        {#if aiButton}
          <button
            type="button"
            class="km-ai"
            data-ai-open=""
            aria-haspopup="dialog"
            aria-expanded="false"
            aria-label="AI 대화 열기"
            title="AI 대화"
          >
            <svg viewBox="0 -960 960 960" aria-hidden="true"><path d={ICON.ai}></path></svg>
          </button>
        {/if}
      </div>
    {/if}
    {#if (categories.length || homeLabel) && ready}
      <nav class="km-chips" aria-label="지도 버튼">
        {#if homeLabel}
          <button
            type="button"
            class="km-chip km-chip-home"
            title={`${homeLabel} — 처음 화면으로`}
            onclick={goHome}
          >
            <svg viewBox="0 -960 960 960" aria-hidden="true"><path d={ICON.home}></path></svg>
            {homeLabel}
          </button>
        {/if}
        {#each categories as c (c.key)}
          {@const n = counts[c.key] ?? 0}
          <button
            type="button"
            class="km-chip"
            class:is-on={activeCat === c.key}
            class:is-empty={n === 0}
            style={`--chip-color:${c.color}`}
            aria-pressed={activeCat === c.key}
            onclick={(e) => toggleCat(c, e)}
          >
            <span class="km-chip-dot" aria-hidden="true"></span>
            {c.label}
            <span class="km-chip-count">{n}</span>
          </button>
        {/each}
      </nav>
    {/if}
    {#if controls && ready}
      <div class="km-top">
        <button
          type="button"
          class="km-btn"
          aria-label={`지도 유형: ${MAP_TYPES[typeIdx].label} (눌러서 변경)`}
          title={`지도 유형: ${MAP_TYPES[typeIdx].label}`}
          onclick={cycleType}
        >
          <svg viewBox="0 -960 960 960" aria-hidden="true"><path d={MAP_TYPES[typeIdx].icon}></path></svg>
        </button>
      </div>
      <div class="km-bottom">
        <button
          type="button"
          class="km-btn lg"
          class:is-loading={locating}
          aria-label="현재 위치"
          title="현재 위치"
          onclick={locate}
        >
          <svg viewBox="0 -960 960 960" aria-hidden="true"><path d={ICON.myLocation}></path></svg>
        </button>
        <div class="km-zoom">
          <button type="button" aria-label="확대" title="확대" onclick={(e) => zoom(1, e)}>
            <svg viewBox="0 -960 960 960" aria-hidden="true"><path d={ICON.add}></path></svg>
          </button>
          <button type="button" aria-label="축소" title="축소" onclick={(e) => zoom(-1, e)}>
            <svg viewBox="0 -960 960 960" aria-hidden="true"><path d={ICON.remove}></path></svg>
          </button>
        </div>
      </div>
      {#if toast}<div class="km-toast" class:is-raised={!!onClose} role="status">{toast}</div>{/if}
    {/if}
  </div>
{/if}

<style>
  .kmap {
    position: relative;
    width: 100%;
  }
  .map-container {
    width: 100%;
    height: 100%;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .map-fallback {
    width: 100%;
    border: 1px dashed var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 1rem;
    box-sizing: border-box;
  }
  .map-fallback-inner {
    color: var(--color-muted);
    max-width: 28rem;
  }
  .map-fallback-inner strong {
    color: var(--color-fg);
    display: block;
    margin-bottom: 0.4rem;
  }
  .map-fallback-inner p {
    margin: 0.3rem 0;
    font-size: 0.88rem;
  }
  .map-fallback-inner .hint {
    font-size: 0.8rem;
  }
  .map-fallback-inner code {
    font-size: 0.85em;
  }
  .km-top,
  .km-bottom {
    position: absolute;
    right: calc(12px + var(--km-right-inset, 0px));
    z-index: 30;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .km-top {
    top: var(--km-top, 12px);
    right: calc(14px + var(--km-right-inset, 0px));
    gap: 12px;
  }
  @media (max-width: 760px) {
    .kmap.has-search .km-top,
    .kmap.has-search .km-chips {
      top: calc(var(--km-top, 12px) + 56px);
    }
  }
  .km-search {
    position: absolute;
    top: var(--km-top, 12px);
    left: 50%;
    transform: translate(-50%);
    z-index: 35;
    width: min(480px, calc(100% - 360px));
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }
  @media (max-width: 760px) {
    .km-search {
      left: 12px;
      right: 12px;
      width: auto;
      transform: none;
    }
  }
  .km-sbox {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  .km-sform {
    display: flex;
    align-items: center;
    height: 44px;
    padding: 0 4px 0 14px;
    border-radius: 999px;
    background: #0e0b096b;
    border: 1px solid rgba(255, 255, 255, 0.16);
    box-shadow:
      0 10px 28px #00000047,
      inset 0 1px #ffffff14;
    -webkit-backdrop-filter: blur(16px) saturate(1.2);
    backdrop-filter: blur(16px) saturate(1.2);
    color: #fff;
    transition:
      background-color 0.2s,
      border-color 0.2s;
  }
  .km-sform:hover {
    background: #0e0b0980;
  }
  .km-sform:focus-within {
    background: #0e0b0994;
    border-color: #ffffff57;
  }
  .km-s-ico {
    flex: none;
    width: 20px;
    height: 20px;
    fill: #ffffff9e;
  }
  .km-sform input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 8px;
    border: 0;
    outline: 0;
    background: transparent;
    font: inherit;
    font-size: 0.95rem;
    color: #fff;
    caret-color: #f5c84c;
  }
  .km-sform input::placeholder {
    color: #ffffff8c;
  }
  .km-sform input::-webkit-search-cancel-button {
    display: none;
  }
  .km-s-clear,
  .km-s-go {
    flex: none;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .km-s-clear {
    width: 28px;
    height: 28px;
    background: transparent;
    color: #fff9;
  }
  .km-s-clear svg {
    width: 18px;
    height: 18px;
    fill: currentColor;
  }
  .km-s-go {
    width: 36px;
    height: 36px;
    background: #ffffff24;
    color: #fff;
    transition: background-color 0.15s;
  }
  .km-s-go:hover,
  .km-s-go:active {
    background: #ffffff3d;
  }
  .km-s-go svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
  }
  .km-s-clear:focus-visible,
  .km-s-go:focus-visible,
  .km-ai:focus-visible,
  .km-results button:focus-visible {
    outline: 2px solid var(--color-primary, #a8352a);
    outline-offset: 2px;
  }
  .km-ai {
    flex: none;
    width: 44px;
    height: 44px;
    padding: 0;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    cursor: pointer;
    color: #fff;
    background-image: linear-gradient(
      135deg,
      var(--color-primary-deep, #7e241c) 0%,
      var(--color-primary, #a8352a) 38%,
      var(--color-primary-soft, #c4564a) 68%,
      var(--color-primary-deep, #7e241c) 100%
    );
    background-size: 220% 220%;
    box-shadow:
      0 6px 16px -4px #7e241c99,
      inset 0 0 0 1px #ffffff29;
    animation: km-ai-shift 6s ease-in-out infinite;
    -webkit-tap-highlight-color: transparent;
    transition:
      filter 0.18s ease,
      transform 0.12s ease;
  }
  @keyframes km-ai-shift {
    0%,
    to {
      background-position: 0% 50%;
    }
    50% {
      background-position: 100% 50%;
    }
  }
  .km-ai:active {
    transform: scale(0.94);
  }
  .km-ai svg {
    width: 24px;
    height: 24px;
    fill: currentColor;
  }
  .km-results {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    right: 0;
    max-height: min(60vh, 460px);
    overflow-y: auto;
    padding: 6px 0;
    background: #161412f0;
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    color: #f4ece2;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: var(--radius-md);
    box-shadow: 0 18px 40px #0006;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.25) transparent;
  }
  .km-results section + section {
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    margin-top: 4px;
    padding-top: 4px;
  }
  .km-results h3 {
    margin: 6px 14px 4px;
    font-size: 0.74rem;
    font-weight: 700;
    color: #f4ece28c;
    letter-spacing: 0.02em;
  }
  .km-results ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .km-results li button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    border: 0;
    background: transparent;
    font: inherit;
    text-align: left;
    color: #f4ece2;
    cursor: pointer;
  }
  .km-results li button:hover,
  .km-results li button:active {
    background: #ffffff14;
  }
  .km-r-dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    box-shadow: 0 0 0 1.5px #ffffff59;
  }
  .km-r-dot.is-doc {
    box-shadow: 0 0 0 1.5px #4a4038;
  }
  .km-r-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .km-r-main strong {
    font-size: 0.92rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .km-r-main small {
    margin-left: 5px;
    font-weight: 500;
    color: #f4ece299;
  }
  .km-r-sub {
    font-size: 0.78rem;
    color: #f4ece299;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .km-r-empty {
    margin: 4px 14px 8px;
    font-size: 0.84rem;
    color: #f4ece299;
  }
  @media (prefers-reduced-motion: reduce) {
    .km-ai {
      animation: none;
    }
  }
  .km-bottom {
    bottom: 32px;
    gap: 8px;
  }
  .km-btn,
  .km-zoom button {
    display: grid;
    place-items: center;
    padding: 0;
    color: #334155;
    background: #fff;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color 0.15s,
      color 0.15s;
  }
  .km-btn {
    width: 40px;
    height: 40px;
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 50%;
    box-shadow: 0 6px 16px #0000002e;
  }
  .km-btn.lg {
    width: 44px;
    height: 44px;
  }
  .km-btn:active,
  .km-zoom button:active {
    background: #f1f5f9;
  }
  .km-btn:focus-visible,
  .km-zoom button:focus-visible {
    outline: 2px solid var(--color-primary, #a8352a);
    outline-offset: 2px;
  }
  .km-btn svg,
  .km-zoom svg {
    width: 22px;
    height: 22px;
    fill: currentColor;
  }
  .km-btn.is-loading {
    color: #0284c7;
  }
  .km-btn.is-loading svg {
    animation: km-spin 1s linear infinite;
  }
  @keyframes km-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .km-zoom {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 999px;
    overflow: hidden;
    box-shadow: 0 6px 16px #0000002e;
  }
  .km-zoom button {
    width: 44px;
    height: 44px;
    border: 0;
  }
  .km-zoom button + button {
    border-top: 1px solid var(--color-rule, #e8dfd9);
  }
  .km-close {
    position: absolute;
    left: 50%;
    bottom: 28px;
    z-index: 36;
    transform: translate(-50%);
    width: 58px;
    height: 58px;
    padding: 0;
    display: grid;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.28);
    border-radius: 50%;
    background: #0e0b099e;
    -webkit-backdrop-filter: blur(14px);
    backdrop-filter: blur(14px);
    box-shadow: 0 10px 28px #0006;
    color: #fff;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color 0.15s,
      transform 0.12s;
  }
  .km-close:hover {
    background: #0e0b09c7;
  }
  .km-close:active {
    transform: translate(-50%) scale(0.94);
  }
  .km-close:focus-visible {
    outline: 2px solid #f5c84c;
    outline-offset: 3px;
  }
  .km-close svg {
    width: 28px;
    height: 28px;
    fill: currentColor;
  }
  .km-toast.is-raised {
    bottom: 100px;
  }
  .km-toast {
    position: absolute;
    left: 50%;
    bottom: 32px;
    z-index: 31;
    transform: translate(-50%);
    max-width: calc(100% - 140px);
    padding: 9px 16px;
    border-radius: 999px;
    background: #17130fe0;
    color: #fff;
    font-size: 0.86rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: 0 6px 16px #00000040;
    animation: km-toast-in 0.2s ease;
  }
  @keyframes km-toast-in {
    0% {
      opacity: 0;
      transform: translate(-50%, 6px);
    }
  }
  @media (max-width: 760px) {
    .km-bottom,
    .km-toast {
      bottom: calc(32px + min(var(--jb-sheet-h, 0px), 40dvh));
    }
    .km-bottom {
      transition: bottom 0.2s ease-out;
    }
    :global(html[data-sheet-drag]) .km-bottom {
      transition: none;
    }
    .km-close {
      bottom: calc(28px + min(var(--jb-sheet-h, 0px), 40dvh));
      transition: bottom 0.2s ease-out;
    }
    .km-toast.is-raised {
      bottom: calc(100px + min(var(--jb-sheet-h, 0px), 40dvh));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .km-btn.is-loading svg,
    .km-toast {
      animation: none;
    }
  }
  .km-chips {
    position: absolute;
    top: var(--km-top, 12px);
    left: 12px;
    z-index: 30;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    pointer-events: none;
  }
  .km-chip {
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 999px;
    background: #0f172a66;
    -webkit-backdrop-filter: blur(12px);
    backdrop-filter: blur(12px);
    box-shadow: 0 1px 3px #00000040;
    color: #fff;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.4;
    white-space: nowrap;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color 0.15s,
      border-color 0.15s;
  }
  .km-chip-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--chip-color);
    flex: none;
  }
  .km-chip-count {
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    opacity: 0.7;
  }
  .km-chip.is-empty {
    color: #fff9;
  }
  .km-chip.is-on {
    background: var(--chip-color);
    border-color: #ffffff73;
    color: #fff;
  }
  .km-chip.is-on .km-chip-dot {
    background: #fff;
  }
  .km-chip-home svg {
    width: 13px;
    height: 13px;
    fill: #f5c84c;
    flex: none;
  }
  .km-chip:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }

  :global(.km-hit) {
    position: relative;
    width: 34px;
    height: 46px;
    filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.45));
  }
  :global(.km-hit svg) {
    display: block;
  }
  :global(.km-hit-label) {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 4px);
    transform: translate(-50%);
    padding: 3px 9px;
    border-radius: 999px;
    background: #1f2937;
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }
  :global(.km-mk) {
    position: relative;
    width: 30px;
    height: 30px;
    transform: translate(-50%, -50%);
    cursor: pointer;
  }
  :global(.km-pin) {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid #fff;
    border-radius: 50%;
    color: #fff;
    box-shadow: 0 2px 8px #00000080;
  }
  :global(.km-mk.is-dot) {
    pointer-events: none;
  }
  :global(.km-dot) {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    box-sizing: border-box;
    width: 18px;
    height: 18px;
    border: 2px solid #fff;
    border-radius: 50%;
    box-shadow: 0 1px 4px #00000059;
    pointer-events: auto;
  }
  :global(.km-mk.is-faded .km-dot) {
    opacity: 0.8;
    border-color: #ffffffd9;
  }
  :global(.km-mk.is-selected) {
    cursor: default;
  }
  :global(.km-drop) {
    position: absolute;
    left: -2px;
    top: -29px;
    width: 34px;
    height: 46px;
    filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.45));
  }
  :global(.km-drop svg) {
    display: block;
  }
  :global(.km-drop-icon) {
    position: absolute;
    top: 17px;
    left: 17px;
    transform: translate(-50%, -50%);
    color: #fff;
    line-height: 0;
  }
  :global(.km-num) {
    font: 700 13px/1 var(--font-sans, system-ui, sans-serif);
    font-style: normal;
    letter-spacing: -0.02em;
  }
  :global(.km-mk.is-num .km-pin) {
    box-shadow:
      0 2px 8px #00000080,
      0 0 0 2px #0000002e;
  }
  :global(.km-mk.is-doc .km-pin) {
    border-color: #4a4038;
    color: #4a4038;
  }
  :global(.km-mk.is-doc .km-dot) {
    border-color: #4a4038;
  }
  :global(.km-mk.is-doc .km-drop-icon) {
    color: #4a4038;
  }
  :global(.km-mk.is-bounce .km-drop) {
    animation: km-hop 0.42s cubic-bezier(0.28, 0.84, 0.42, 1) 3 both;
  }
  @keyframes -global-km-hop {
    0%,
    to {
      transform: translateY(0);
    }
    30% {
      transform: translateY(-9px);
    }
    55% {
      transform: translateY(0);
    }
    70% {
      transform: translateY(-3px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.km-mk.is-bounce .km-drop) {
      animation: none;
    }
  }
  :global(.km-here) {
    position: relative;
    width: 28px;
    height: 28px;
  }
  :global(.km-here-dot) {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 16px;
    height: 16px;
    border-radius: 9999px;
    background: #0ea5e9;
    border: 3px solid #fff;
    box-shadow: 0 1px 5px #00000073;
    box-sizing: border-box;
  }
  :global(.km-here-pulse) {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 28px;
    height: 28px;
    border-radius: 9999px;
    background: #0ea5e959;
    animation: km-here-pulse 1.6s ease-out 3 forwards;
  }
  @keyframes -global-km-here-pulse {
    0% {
      transform: translate(-50%, -50%) scale(0.5);
      opacity: 0.85;
    }
    to {
      transform: translate(-50%, -50%) scale(2.6);
      opacity: 0;
    }
  }
  :global(.kakao-pin-label) {
    background: var(--color-surface-1, #fff);
    border: 1px solid var(--color-rule, #ccc);
    border-radius: var(--radius-sm);
    padding: 1px 6px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-fg, #222);
    white-space: nowrap;
    box-shadow: 0 1px 3px #0003;
    pointer-events: none;
  }
</style>
