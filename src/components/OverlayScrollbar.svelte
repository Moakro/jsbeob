<script lang="ts">
  // 페이지 오버레이 스크롤바 — 스크롤하거나 화면 오른쪽 끝에 마우스를 대면 잠깐 보이고, 끌어서 스크롤할 수 있다.
  // 복원(2026-11-01): 배포본 클라이언트(_astro/OverlayScrollbar.*.js) 기준.
  import { onMount } from "svelte";

  let top = $state(0);
  let height = $state(0);
  let show = $state(false);
  let active = $state(false);
  let needed = $state(false);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let drag: { y0: number; s0: number; id: number } | null = null;
  const MIN_H = 36;

  function measure() {
    const doc = document.documentElement;
    const vh = window.innerHeight;
    const sh = doc.scrollHeight;
    // 스크롤할 내용이 없거나 모달이 스크롤을 잠갔으면 숨긴다
    needed = sh > vh + 1 && doc.style.overflow !== "hidden";
    if (!needed) return;
    height = Math.max(MIN_H, (vh * vh) / sh);
    const range = sh - vh;
    top = range > 0 ? (window.scrollY / range) * (vh - height) : 0;
  }

  function flash() {
    measure();
    show = true;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!drag && !active) show = false;
    }, 900);
  }

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === "touch") return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { y0: e.clientY, s0: window.scrollY, id: e.pointerId };
    active = true;
    show = true;
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const vh = window.innerHeight;
    const ratio = (document.documentElement.scrollHeight - vh) / Math.max(1, vh - height);
    window.scrollTo({ top: drag.s0 + (e.clientY - drag.y0) * ratio, behavior: "instant" });
  }

  function onPointerUp(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    active = false;
    flash();
  }

  onMount(() => {
    const onScroll = () => flash();
    const onResize = () => measure();
    // 화면 오른쪽 14px 안으로 마우스가 들어오면 보인다
    const onMouseMove = (e: MouseEvent) => {
      const near = e.clientX >= window.innerWidth - 14;
      if (near !== active && !drag) {
        active = near;
        if (near) {
          measure();
          show = true;
        } else flash();
      }
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    document.addEventListener("mousemove", onMouseMove, { passive: true });
    const ro = new ResizeObserver(() => measure());
    ro.observe(document.body);
    // 모달이 html overflow 를 바꾸면 다시 잰다
    const mo = new MutationObserver(() => measure());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("mousemove", onMouseMove);
      ro.disconnect();
      mo.disconnect();
      clearTimeout(hideTimer);
    };
  });
</script>

{#if needed}
  <div
    class="osb"
    class:show
    class:active
    style:transform={`translateY(${top}px)`}
    style:height={`${height}px`}
    aria-hidden="true"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
  ></div>
{/if}

<style>
  .osb {
    position: fixed;
    top: 0;
    right: 2px;
    z-index: 89;
    width: 6px;
    border-radius: 999px;
    background: #281e166b;
    opacity: 0;
    transition:
      opacity 0.25s ease,
      width 0.15s ease;
    touch-action: none;
    cursor: default;
  }
  .osb.show {
    opacity: 1;
  }
  .osb.active {
    width: 9px;
    background: #281e1694;
  }
  @media (pointer: coarse) {
    .osb {
      width: 4px;
      pointer-events: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .osb {
      transition: none;
    }
  }
</style>
