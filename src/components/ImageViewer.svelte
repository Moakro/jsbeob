<script lang="ts">
  // 이미지 참조 블록 뷰어 — 본문의 .imgref-thumb 를 누르면 같은 블록([data-viewer])의 사진들을 크게 넘겨 본다.
  // 복원(2026-11-01): 배포본 클라이언트(_astro/ImageViewer.*.js) 기준.
  import { onMount, tick } from "svelte";
  import { confirmNavigate } from "../lib/confirm";

  interface ViewerData {
    images: { url: string; caption?: string; width?: number; height?: number }[];
    caption?: string;
    source: { href: string; label: string; title?: string };
  }

  let data = $state<ViewerData | null>(null);
  let index = $state(0);
  let closeBtn = $state<HTMLButtonElement | null>(null);
  let opener: HTMLElement | null = null;

  const current = $derived(data ? data.images[index] : null);

  function close() {
    data = null;
    opener?.focus?.();
  }

  function step(d: number) {
    if (!data) return;
    index = (index + d + data.images.length) % data.images.length;
  }

  onMount(() => {
    const onClick = (e: MouseEvent) => {
      const thumb = (e.target as Element | null)?.closest?.(".imgref-thumb") as HTMLElement | null;
      if (!thumb) return;
      const holder = thumb.closest("[data-viewer]") as HTMLElement | null;
      if (!holder) return;
      e.preventDefault();
      try {
        data = JSON.parse(holder.dataset.viewer || "null");
        index = Number(thumb.dataset.viewerIndex) || 0;
        opener = thumb;
        tick().then(() => closeBtn?.focus());
      } catch {
        data = null;
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (!data) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  });
</script>

{#if data && current}
  <div class="iv" role="dialog" aria-modal="true" aria-label="이미지 보기">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="iv-scrim" role="presentation" onclick={close}></div>
    <div class="iv-box">
      <header>
        <span class="iv-count">{index + 1} / {data.images.length}</span>
        <button type="button" class="iv-x" aria-label="닫기" bind:this={closeBtn} onclick={close}>✕</button>
      </header>
      <div class="iv-stage">
        {#if data.images.length > 1}
          <button type="button" class="iv-nav prev" aria-label="이전 사진" onclick={() => step(-1)}>‹</button>
        {/if}
        <img
          src={current.url}
          alt={current.caption}
          width={current.width || undefined}
          height={current.height || undefined}
        />
        {#if data.images.length > 1}
          <button type="button" class="iv-nav next" aria-label="다음 사진" onclick={() => step(1)}>›</button>
        {/if}
      </div>
      <footer>
        {#if current.caption}<p class="iv-cap">{current.caption}</p>{/if}
        {#if data.caption}<p class="iv-sub">{data.caption}</p>{/if}
        <button
          type="button"
          class="iv-src"
          onclick={() => confirmNavigate(data!.source.href, data!.source.title)}
        >
          <span class="iv-label">{data.source.label}</span>
          {data.source.title ?? ""} — 원본 페이지로 이동 →
        </button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .iv {
    position: fixed;
    inset: 0;
    z-index: 120;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  .iv-scrim {
    position: absolute;
    inset: 0;
    background: #0c0908d1;
  }
  .iv-box {
    position: relative;
    width: min(1100px, 100%);
    max-height: 100%;
    display: flex;
    flex-direction: column;
    color: #f4ede2;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 0 8px;
  }
  .iv-count {
    font-size: 0.85rem;
    opacity: 0.8;
  }
  .iv-x {
    border: 0;
    background: none;
    color: inherit;
    font-size: 1.4rem;
    cursor: pointer;
  }
  .iv-stage {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
  }
  .iv-stage img {
    max-width: 100%;
    max-height: 72vh;
    width: auto;
    height: auto;
    object-fit: contain;
    border-radius: var(--radius-sm);
  }
  .iv-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 0;
    background: #ffffff2e;
    color: #fff;
    font-size: 1.6rem;
    cursor: pointer;
  }
  .iv-nav.prev {
    left: 6px;
  }
  .iv-nav.next {
    right: 6px;
  }
  footer {
    padding-top: 10px;
    display: grid;
    gap: 6px;
  }
  .iv-cap {
    margin: 0;
    font-weight: 600;
  }
  .iv-sub {
    margin: 0;
    font-size: 0.88rem;
    opacity: 0.85;
  }
  .iv-src {
    justify-self: start;
    display: inline-flex;
    gap: 8px;
    align-items: center;
    border: 1px solid rgba(255, 255, 255, 0.35);
    background: none;
    color: inherit;
    border-radius: 999px;
    padding: 6px 14px;
    cursor: pointer;
    font: inherit;
    font-size: 0.88rem;
  }
  .iv-label {
    font-size: 0.72rem;
    padding: 1px 7px;
    border-radius: 999px;
    background: #fff3;
  }
</style>
