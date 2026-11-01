<script lang="ts">
  // 관리자 — 미디어: 유튜브 채널 영상의 대표 지정·공개/비공개, 메인 배치(앞 4편) 미리보기.
  // 복원(2026-11-01): 배포본 _astro/AdminApp.*.js 에 함께 묶인 컴포넌트. 파일 이름은 추정.
  import { onMount } from "svelte";
  import { adminApi } from "../../lib/blocks";

  let videos = $state<any[]>([]);
  let channelUrl = $state("https://www.youtube.com/@jsbeob");
  let loading = $state(true);
  let error = $state<string | null>(null);
  let msg = $state<{ tone: string; text: string } | null>(null);
  let busy = $state<string | null>(null);

  /** 메인에 나오는 순서: 대표 영상이 있으면 맨 앞, 나머지는 최신순 — 4편 */
  const lineup = $derived.by(() => {
    const shown = videos.filter((v) => !v.hidden);
    const f = shown.find((v) => v.featured);
    return (f ? [f, ...shown.filter((v) => v !== f)] : shown).slice(0, 4);
  });
  const ymd = (s: string) => {
    const d = new Date(s);
    return Number.isNaN(d.getTime())
      ? ""
      : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  };

  async function load() {
    try {
      const r = await adminApi.listMediaVideos();
      videos = r.videos;
      if (r.channel?.url) channelUrl = r.channel.url;
    } catch (e) {
      error = e instanceof Error ? e.message : "영상 목록을 불러오지 못했습니다";
    } finally {
      loading = false;
    }
  }
  onMount(load);

  async function save(v: any, patch: { featured?: boolean; hidden?: boolean }) {
    msg = null;
    busy = v.id;
    try {
      await adminApi.saveMediaVideo(v.id, patch);
      if (patch.featured) videos = videos.map((x) => ({ ...x, featured: x.id === v.id }));
      else if (patch.featured === false) v.featured = false;
      if (patch.hidden !== undefined) {
        v.hidden = patch.hidden;
        if (patch.hidden) v.featured = false;
      }
      msg = { tone: "ok", text: "저장했습니다. 메인에 바로 반영됩니다." };
    } catch (e) {
      msg = { tone: "err", text: e instanceof Error ? e.message : "저장하지 못했습니다" };
    } finally {
      busy = null;
    }
  }
</script>

<div class="head">
  <p class="dim">유튜브 채널에 올린 영상이 자동으로 들어옵니다. 대표 영상은 메인 맨 앞 큰 자리에 나옵니다.</p>
  <a class="btn btn-ghost" href={channelUrl} target="_blank" rel="noopener">유튜브 채널 ↗</a>
</div>
{#if msg}<p class={`msg ${msg.tone}`}>{msg.text}</p>{/if}
{#if loading}
  <p class="dim">불러오는 중…</p>
{:else if error}
  <p class="err">{error}</p>
{:else if videos.length}
  <section class="lineup" aria-label="메인 배치 미리보기">
    <strong>메인 배치</strong>
    <div class="lu">
      {#each lineup as v, i (v.id)}
        <figure class:big={i === 0}>
          <img src={v.thumb} alt="" loading="lazy" />
          <figcaption>{i === 0 ? (v.featured ? "대표" : "최신") : `${i + 1}`} · {v.title}</figcaption>
        </figure>
      {/each}
    </div>
  </section>
  <ul class="list">
    {#each videos as v (v.id)}
      <li class:off={v.hidden}>
        <img class="th" src={v.thumb} alt="" loading="lazy" />
        <span class="t"
          ><a href={v.url} target="_blank" rel="noopener">{v.title}</a>
          <small
            >{ymd(v.published)}{v.views != null ? ` · 조회 ${v.views.toLocaleString("ko-KR")}` : ""}</small
          ></span
        >
        <span class="ctl"
          ><label class="rad" class:on={v.featured} title="메인 맨 앞 큰 자리"
            ><input
              type="radio"
              name="featured"
              checked={v.featured}
              disabled={v.hidden || busy !== null}
              onchange={() => save(v, { featured: true })}
            /> 대표</label
          >
          {#if v.featured}
            <button
              type="button"
              class="link"
              disabled={busy !== null}
              onclick={() => save(v, { featured: false })}>대표 해제</button
            >
          {/if}
          <button
            type="button"
            class="sw"
            class:pub={!v.hidden}
            role="switch"
            aria-checked={!v.hidden}
            disabled={busy !== null}
            onclick={() => save(v, { hidden: !v.hidden })}
            ><span class="knob" aria-hidden="true"></span> {v.hidden ? "비공개" : "공개"}</button
          ></span
        >
      </li>
    {/each}
  </ul>
{:else}
  <p class="dim">채널에 영상이 없습니다.</p>
{/if}

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .lineup {
    display: grid;
    gap: 8px;
    padding: 14px;
    margin-bottom: 14px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  .lu {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr;
    gap: 10px;
    align-items: start;
  }
  .lu figure {
    margin: 0;
    display: grid;
    gap: 4px;
  }
  .lu img {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: var(--radius-md);
  }
  .lu figcaption {
    font-size: 0.78rem;
    color: var(--color-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lu .big figcaption {
    color: var(--color-fg);
    font-weight: 600;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: #fff;
  }
  .list li.off .th,
  .list li.off .t {
    opacity: 0.5;
  }
  .th {
    flex: none;
    width: 96px;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: var(--radius-sm);
  }
  .t {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .t a {
    color: var(--color-fg);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .t small {
    color: var(--color-muted);
    font-size: 0.8rem;
  }
  .ctl {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .rad {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .rad.on {
    color: var(--color-primary);
    font-weight: 700;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--color-muted);
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .sw {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 84px;
    height: 30px;
    padding: 0 10px 0 4px;
    border: 1px solid var(--color-rule);
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-muted);
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .sw .knob {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px #00000040;
  }
  .sw.pub {
    flex-direction: row-reverse;
    padding: 0 4px 0 10px;
    background: var(--color-secondary);
    border-color: var(--color-secondary);
    color: #fff;
  }
  .dim {
    color: var(--color-muted);
    font-size: 0.86rem;
    margin: 0;
  }
  .err {
    color: var(--color-primary);
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
  @media (max-width: 760px) {
    .lu {
      grid-template-columns: 1fr 1fr;
    }
    .lu .big {
      grid-column: 1 / -1;
    }
    .list li {
      flex-wrap: wrap;
    }
    .ctl {
      width: 100%;
      justify-content: flex-end;
    }
  }
</style>
