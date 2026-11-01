<script lang="ts">
  // 영상 미리보기 모달 — 페이지 어디서든 [data-video-id] 요소를 누르면 유튜브 영상을 바로 띄운다.
  // 복원(2026-11-01): 배포본 클라이언트(_astro/VideoPreview.*.js) 기준.
  import { onMount, tick } from "svelte";

  let video = $state<{ id: string; title: string; date: string } | null>(null);
  let closeBtn = $state<HTMLButtonElement | null>(null);
  let opener: HTMLElement | null = null;

  async function openVideo(id: string, title: string, date: string, from: HTMLElement) {
    opener = from;
    video = { id, title, date };
    document.documentElement.style.overflow = "hidden";
    await tick();
    closeBtn?.focus();
  }

  function close() {
    if (!video) return;
    video = null;
    document.documentElement.style.overflow = "";
    opener?.focus();
  }

  onMount(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const el = (e.target as Element | null)?.closest?.("[data-video-id]") as HTMLElement | null;
      const id = el?.dataset.videoId ?? "";
      if (!el || !/^[\w-]{11}$/.test(id)) return;
      e.preventDefault();
      openVideo(id, el.dataset.videoTitle ?? "", el.dataset.videoDate ?? "", el);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && video) {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      if (video) close();
    };
  });
</script>

{#if video}
  <div class="vp" role="dialog" aria-modal="true" aria-label={`영상 미리보기: ${video.title}`}>
    <button type="button" class="vp-dim" tabindex="-1" aria-label="닫기" onclick={close}></button>
    <div class="vp-box">
      <div class="vp-frame">
        <iframe
          src={`https://www.youtube.com/embed/${video.id}?autoplay=1&rel=0&playsinline=1`}
          title={video.title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowfullscreen
          referrerpolicy="strict-origin-when-cross-origin"
        ></iframe>
      </div>
      <div class="vp-info">
        <div class="vp-text">
          <strong>{video.title}</strong>
          {#if video.date}<small>{video.date}</small>{/if}
        </div>
        <div class="vp-actions">
          <a class="vp-go" href={`/media/${video.id}/`}>영상 페이지로 →</a>
          <a class="vp-yt" href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener"
            >유튜브에서 보기 ↗</a
          >
        </div>
      </div>
    </div>
    <button
      type="button"
      class="vp-close"
      aria-label="미리보기 닫기"
      title="닫기"
      bind:this={closeBtn}
      onclick={close}
    >
      <svg viewBox="0 -960 960 960" aria-hidden="true"
        ><path
          d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"
        ></path></svg
      >
    </button>
  </div>
{/if}

<style>
  .vp {
    position: fixed;
    inset: 0;
    z-index: 120;
    display: grid;
    place-items: center;
    padding: 24px 24px 110px;
  }
  .vp-dim {
    position: absolute;
    inset: 0;
    border: 0;
    padding: 0;
    background: #0e0a08d1;
    cursor: default;
  }
  .vp-box {
    position: relative;
    width: min(1100px, 100%, calc((100dvh - 250px) * 16 / 9));
    min-width: min(100%, 320px);
    animation: vp-in 0.18s ease-out;
  }
  @keyframes vp-in {
    0% {
      transform: translateY(10px);
      opacity: 0;
    }
  }
  .vp-frame {
    position: relative;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: #000;
    box-shadow: 0 24px 60px #00000080;
  }
  .vp-frame iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
  }
  .vp-info {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
    margin-top: 12px;
    color: #fff;
  }
  .vp-text {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .vp-text strong {
    font-size: 1.05rem;
    line-height: 1.4;
  }
  .vp-text small {
    color: #ffffffa6;
  }
  .vp-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .vp-actions a {
    display: inline-flex;
    align-items: center;
    height: 38px;
    padding: 0 16px;
    border-radius: var(--radius-md);
    font-weight: 600;
    font-size: 0.9rem;
    text-decoration: none;
    white-space: nowrap;
  }
  .vp-go {
    background: #fff;
    color: #1b1714;
  }
  .vp-yt {
    border: 1px solid rgba(255, 255, 255, 0.45);
    color: #fff;
  }
  .vp-actions a:hover {
    filter: brightness(0.92);
  }
  .vp-close {
    position: absolute;
    left: 50%;
    bottom: 28px;
    transform: translate(-50%);
    width: 58px;
    height: 58px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.28);
    border-radius: 50%;
    background: #0e0b099e;
    -webkit-backdrop-filter: blur(14px);
    backdrop-filter: blur(14px);
    color: #fff;
    cursor: pointer;
    box-shadow: 0 10px 28px #0006;
  }
  .vp-close svg {
    width: 28px;
    height: 28px;
    fill: currentColor;
  }
  .vp-close:focus-visible {
    outline: 2px solid #f5c84c;
    outline-offset: 3px;
  }
  @media (max-width: 760px) {
    .vp {
      padding: 12px 12px 110px;
    }
    .vp-box {
      width: 100%;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .vp-box {
      animation: none;
    }
  }
</style>
