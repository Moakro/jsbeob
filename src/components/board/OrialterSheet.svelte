<script lang="ts">
  // ＋ 버튼 '오리알터에 올리기' 시트 — 사진 여러 장 + 짧은 글(제목 없음) → 바로 게시 (2026-11-28 오너 결정)
  // AI·올림함을 거치지 않는다. 교인(40) 이상(오리알터 create_level). 권한·하루 상한은 API 가 검사한다.
  // 사진은 브라우저에서 WebP 로 다시 저장해 올리므로 찍은 위치(EXIF GPS)가 빠진다(서버도 한 번 더 지움).
  import ModalFrame from "../ModalFrame.svelte";
  import { api, ORIALTER_POSTED } from "../../lib/api";
  import { uploadImage } from "../../lib/blocks";
  import { MAX_PHOTOS, ORIALTER_BOARD, PHOTO_ACCEPT, orialterBlocks, splitYouTube } from "../../lib/orialter";

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  type Pick = { k: string; file: File; url: string; broken: boolean };
  let picks = $state<Pick[]>([]);
  let text = $state("");
  let busy = $state(false);
  let stage = $state("");
  let error = $state<string | null>(null);
  let albumInput = $state<HTMLInputElement | null>(null);
  let camInput = $state<HTMLInputElement | null>(null);

  const videos = $derived(splitYouTube(text).videos.length);
  const ready = $derived(!busy && (picks.length > 0 || text.trim().length > 0));

  function add(list: FileList | null | undefined) {
    if (!list) return;
    error = null;
    for (const file of Array.from(list)) {
      if (picks.length >= MAX_PHOTOS) {
        error = `사진은 한 글에 ${MAX_PHOTOS}장까지 올릴 수 있습니다.`;
        break;
      }
      if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
        error = `사진만 올릴 수 있습니다: ${file.name}`;
        continue;
      }
      picks.push({ k: Math.random().toString(36).slice(2), file, url: URL.createObjectURL(file), broken: false });
    }
  }
  function remove(k: string) {
    const p = picks.find((x) => x.k === k);
    if (p) URL.revokeObjectURL(p.url);
    picks = picks.filter((x) => x.k !== k);
  }
  function reset() {
    for (const p of picks) URL.revokeObjectURL(p.url);
    picks = [];
    text = "";
    error = null;
    stage = "";
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!ready) return;
    busy = true;
    error = null;
    try {
      const keys: string[] = [];
      for (let i = 0; i < picks.length; i++) {
        stage = picks.length > 1 ? `사진 올리는 중 (${i + 1}/${picks.length})` : "사진 올리는 중";
        keys.push((await uploadImage(picks[i].file)).key);
      }
      stage = "게시하는 중";
      const { id } = await api.createPost({
        board: ORIALTER_BOARD,
        title: "",
        blocks: orialterBlocks({ text, keys }),
      });
      reset();
      onclose();
      // 도생광장 피드가 떠 있으면 그 자리에서 새로 읽고, 아니면 피드로 간다
      const ev = new CustomEvent(ORIALTER_POSTED, { detail: { id, handled: false } });
      window.dispatchEvent(ev);
      if (!ev.detail.handled) location.href = "/community/";
    } catch (err) {
      error = err instanceof Error ? err.message : "올리지 못했습니다";
    } finally {
      busy = false;
      stage = "";
    }
  }
</script>

<ModalFrame {open} onclose={() => !busy && onclose()} label="오리알터에 올리기" title="오리알터에 올리기">
  <form class="os" onsubmit={submit}>
    <div class="pick-row">
      <button type="button" class="pick" onclick={() => camInput?.click()} disabled={busy || picks.length >= MAX_PHOTOS}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3l2-2h6l2 2h3v12H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
        사진 찍기
      </button>
      <button type="button" class="pick" onclick={() => albumInput?.click()} disabled={busy || picks.length >= MAX_PHOTOS}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="m3.5 16 5-5 4 4 3-3 5 5" /><circle cx="15.5" cy="9" r="1.6" /></svg>
        앨범에서 고르기
      </button>
      <input bind:this={camInput} type="file" accept="image/*" capture="environment" hidden onchange={(e) => (add(e.currentTarget.files), (e.currentTarget.value = ""))} />
      <input bind:this={albumInput} type="file" accept={PHOTO_ACCEPT} multiple hidden onchange={(e) => (add(e.currentTarget.files), (e.currentTarget.value = ""))} />
    </div>

    {#if picks.length}
      <ul class="thumbs" aria-label={`고른 사진 ${picks.length}장`}>
        {#each picks as p (p.k)}
          <li>
            {#if p.broken}
              <span class="ph-name" title={p.file.name}>{p.file.name.split(".").pop()?.toUpperCase()}</span>
            {:else}
              <img src={p.url} alt="" onerror={() => (p.broken = true)} />
            {/if}
            <button type="button" class="x" aria-label="사진 빼기" onclick={() => remove(p.k)} disabled={busy}>×</button>
          </li>
        {/each}
        <li class="count">{picks.length}/{MAX_PHOTOS}</li>
      </ul>
    {/if}

    <label class="fld">
      <span>글</span>
      <textarea bind:value={text} rows="4" maxlength="5000" disabled={busy}></textarea>
    </label>
    {#if videos}
      <p class="note">▶ 유튜브 영상 {videos}개가 글과 함께 올라갑니다(주소는 글에서 빠집니다)</p>
    {/if}

    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <div class="btns">
      <button type="button" class="btn btn-ghost" onclick={() => !busy && onclose()} disabled={busy}>취소</button>
      <button class="btn btn-primary" disabled={!ready}>{busy ? stage || "올리는 중…" : "게시"}</button>
    </div>
  </form>
</ModalFrame>

<style>
  .os {
    display: grid;
    gap: 14px;
    padding: 4px 20px 20px;
  }
  @media (max-width: 560px) {
    .os {
      padding: 4px 14px 16px;
    }
  }
  .pick-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .pick {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 16px 8px;
    border: 2px dashed var(--color-rule);
    border-radius: 12px;
    background: var(--color-surface-2);
    color: var(--color-ink);
    font: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
  }
  .pick:hover:not(:disabled) {
    border-color: var(--color-primary);
    background: var(--color-primary-bg);
  }
  .pick:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .pick svg {
    width: 28px;
    height: 28px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .thumbs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .thumbs li {
    position: relative;
    width: 72px;
    height: 72px;
  }
  .thumbs img,
  .ph-name {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 8px;
    background: var(--color-surface-2);
    display: grid;
    place-items: center;
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--color-muted);
  }
  .thumbs .x {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 50%;
    background: var(--color-ink);
    color: #fff;
    font-size: 0.95rem;
    line-height: 1;
    cursor: pointer;
  }
  .thumbs li.count {
    width: auto;
    height: auto;
    color: var(--color-muted);
    font-size: 0.82rem;
  }
  .fld {
    display: grid;
    gap: 6px;
  }
  .fld > span {
    font-weight: 600;
    font-size: 0.9rem;
  }
  .fld textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    font: inherit;
    font-size: 16px; /* 아이폰 확대 방지 */
  }
  .note {
    margin: -6px 0 0;
    color: var(--color-muted);
    font-size: 0.82rem;
  }
  .err {
    margin: 0;
    color: var(--color-primary);
    background: var(--color-primary-bg);
    padding: 8px 12px;
    border-radius: var(--radius-md);
    font-size: 0.9rem;
  }
  .btns {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }
</style>
