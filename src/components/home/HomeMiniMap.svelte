<script lang="ts">
  // 홈 오른쪽 미니 지도 — 카카오맵 위성 지도에 장소 점만 찍는다(조작 불가, 누르면 지도 페이지로).
  // 복원(2026-11-01): 배포본 SSR(index 청크)·클라이언트(_astro/HomeMiniMap.*.js) 기준.
  import { onMount } from "svelte";
  import { hasKakaoKey, loadKakaoMaps } from "../../lib/kakao-maps";

  let {
    points = [],
    href = "/map/",
    label = "",
    color = "#B8322A",
  }: { points?: { lat: number; lng: number }[]; href?: string; label?: string; color?: string } = $props();

  let mapEl = $state<HTMLElement | null>(null);
  let ready = $state(false);

  onMount(() => {
    if (!hasKakaoKey() || !mapEl || !points.length) return;
    const el = mapEl;
    loadKakaoMaps()
      .then((kakao) => {
        const map = new kakao.maps.Map(el, {
          center: new kakao.maps.LatLng(points[0].lat, points[0].lng),
          level: 4,
          draggable: false,
          scrollwheel: false,
          disableDoubleClick: true,
          disableDoubleClickZoom: true,
          keyboardShortcuts: false,
        });
        map.setMapTypeId(kakao.maps.MapTypeId.HYBRID);
        if (points.length > 1) {
          const bounds = new kakao.maps.LatLngBounds();
          for (const p of points) bounds.extend(new kakao.maps.LatLng(p.lat, p.lng));
          map.setBounds(bounds, 44, 28, 36, 28);
        }
        for (const p of points) {
          const dot = document.createElement("span");
          dot.className = "mm-dot";
          dot.style.background = color;
          new kakao.maps.CustomOverlay({
            position: new kakao.maps.LatLng(p.lat, p.lng),
            content: dot,
            xAnchor: 0.5,
            yAnchor: 0.5,
          }).setMap(map);
        }
        ready = true;
      })
      .catch(() => {});
  });
</script>

<section class="side-box">
  <div class="side-head">
    <h3>오리알터 지도</h3>
    <a {href}>지도에서 보기 →</a>
  </div>
  <a class="mm" {href} aria-label={`지도에서 보기${label ? `: ${label}` : ""}`}>
    <div class="mm-map" class:ready bind:this={mapEl}></div>
    {#if label}<span class="mm-label">{label}</span>{/if}
  </a>
</section>

<style>
  .mm {
    position: relative;
    display: block;
    aspect-ratio: 16 / 11;
    border-radius: var(--radius-md);
    overflow: hidden;
    background:
      radial-gradient(ellipse at 30% 25%, rgba(120, 150, 110, 0.55), transparent 60%),
      linear-gradient(160deg, #4b5a44, #2c3328);
  }
  .mm-map {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .mm-label {
    position: absolute;
    z-index: 2;
    left: 10px;
    top: 10px;
    padding: 4px 10px;
    border-radius: 999px;
    background: #0e0b09a6;
    color: #fff;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .mm:hover .mm-label {
    background: var(--color-primary);
  }

  /* 카카오 CustomOverlay 로 붙이는 점 — 컴포넌트 밖 DOM 이라 전역 */
  :global(.mm-dot) {
    display: block;
    width: 12px;
    height: 12px;
    border: 2px solid #fff;
    border-radius: 50%;
    box-shadow: 0 1px 4px #00000080;
  }
</style>
