<script lang="ts">
  let { videoId, title = "YouTube 영상" }: { videoId: string; title?: string } = $props();
  let play = $state(false);
  const thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
</script>

<div class="yt">
  {#if play}
    <iframe
      src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
      {title}
      frameborder="0"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen
    ></iframe>
  {:else}
    <button class="poster" onclick={() => (play = true)} aria-label="영상 재생">
      <img src={thumb} alt={title} loading="lazy" />
      <span class="play">▶</span>
    </button>
  {/if}
</div>

<style>
  .yt {
    position: relative;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: #000;
  }
  .yt iframe,
  .poster img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border: 0;
  }
  .poster {
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    cursor: pointer;
    position: relative;
    display: block;
  }
  .play {
    position: absolute;
    inset: 0;
    margin: auto;
    width: 64px;
    height: 64px;
    display: grid;
    place-items: center;
    background: rgba(168, 53, 42, 0.92);
    color: #fff;
    border-radius: 50%;
    font-size: 1.4rem;
    padding-left: 4px;
  }
</style>
