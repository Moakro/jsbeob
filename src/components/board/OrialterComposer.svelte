<script lang="ts">
  // 오리알터 글쓰기 폼 — 도생광장 피드 맨 위와 ＋ 버튼 '오리알터에 올리기' 창이 같이 쓴다 (2026-11-28 오너: 두 곳 같은 UI).
  // 글 + 사진(앨범·파일 또는 카메라로 바로 촬영, 최대 MAX_PHOTOS) → 제목 없이 바로 게시. 권한·하루 상한은 API 가 검사한다.
  // 사진은 브라우저에서 WebP 로 다시 저장해 올리므로 찍은 위치(EXIF GPS)가 빠진다(서버도 한 번 더 지움).
  import { api } from "../../lib/api";
  import { uploadImage } from "../../lib/blocks";
  import { MAX_PHOTOS, ORIALTER_BOARD, orialterBlocks, splitYouTube } from "../../lib/orialter";

  let {
    canPost = true,
    hint = "새로운 소식을 남겨보세요",
    onposted,
    onerror,
    onbusy,
  }: {
    canPost?: boolean;
    hint?: string;
    onposted: (id: string) => void | Promise<void>;
    onerror: (msg: string) => void;
    onbusy?: (busy: boolean) => void;
  } = $props();

  let text = $state("");
  let files = $state<{ file: File; url: string }[]>([]);
  let posting = $state(false);
  let fileInput = $state<HTMLInputElement | undefined>(undefined);
  let camInput = $state<HTMLInputElement | undefined>(undefined);

  const videos = $derived(splitYouTube(text).videos.length);

  function pickFiles(e: Event) {
    const input = e.target as HTMLInputElement;
    const picked = [...(input.files ?? [])];
    const room = MAX_PHOTOS - files.length;
    files = [...files, ...picked.slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }))];
    input.value = "";
  }

  function dropFile(i: number) {
    URL.revokeObjectURL(files[i].url);
    files = files.filter((_, j) => j !== i);
  }

  async function submit() {
    if (posting || (!text.trim() && !files.length)) return;
    posting = true;
    onbusy?.(true);
    try {
      const keys: string[] = [];
      for (const f of files) keys.push((await uploadImage(f.file)).key);
      const { id } = await api.createPost({ board: ORIALTER_BOARD, title: "", blocks: orialterBlocks({ text, keys }) });
      files.forEach((f) => URL.revokeObjectURL(f.url));
      text = "";
      files = [];
      await onposted(id);
    } catch (e) {
      onerror(e instanceof Error ? e.message : "올리지 못했습니다");
    } finally {
      posting = false;
      onbusy?.(false);
    }
  }
</script>

<form
  class="card composer"
  class:locked={!canPost}
  onsubmit={(e) => {
    e.preventDefault();
    if (canPost) submit();
  }}
>
  <textarea rows="3" placeholder={hint} aria-label="글" disabled={!canPost} bind:value={text}></textarea>
  {#if videos}
    <p class="yt-note">
      ▶ 유튜브 영상 {videos}개가 글과 함께 올라갑니다(주소는 글에서 빠집니다)
    </p>
  {/if}
  {#if files.length}
    <ul class="picks">
      {#each files as f, i}
        <li>
          <img src={f.url} alt="" />
          <button type="button" class="x" aria-label="사진 빼기" onclick={() => dropFile(i)}>×</button>
        </li>
      {/each}
    </ul>
  {/if}
  <div class="composer-bar">
    <span class="tools">
      <button
        type="button"
        class="tool"
        disabled={!canPost || files.length >= MAX_PHOTOS}
        onclick={() => fileInput?.click()}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"
        ><rect x="3.5" y="4.5" width="17" height="15" rx="2"></rect><path d="m3.5 16 5-5 4 4 3-3 5 5" stroke-linejoin="round"
        ></path><circle cx="15.5" cy="9" r="1.6"></circle></svg
      >
        사진 {files.length ? `${files.length}/${MAX_PHOTOS}` : ""}</button
      >
      <button
        type="button"
        class="tool"
        disabled={!canPost || files.length >= MAX_PHOTOS}
        onclick={() => camInput?.click()}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
        ><path
          d="M4 7h3l2-2h6l2 2h3v12H4z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linejoin="round"
        ></path><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"
        ></circle></svg
      >
        카메라</button
      >
    </span>
    <input
      type="file"
      accept="image/jpeg,image/png,image/webp"
      multiple
      hidden
      bind:this={fileInput}
      onchange={pickFiles}
    />
    <input type="file" accept="image/*" capture="environment" hidden bind:this={camInput} onchange={pickFiles} />
    <button class="btn btn-primary go" disabled={!canPost || posting || (!text.trim() && !files.length)}
      >{posting ? "올리는 중…" : "올리기"}</button
    >
  </div>
</form>

<style>
  .card {
    background: var(--color-surface);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    min-width: 0;
  }
  .composer {
    padding: 12px 14px;
  }
  .composer textarea {
    width: 100%;
    border: 0;
    background: none;
    resize: vertical;
    font: inherit;
    color: var(--color-fg);
    outline: none;
  }
  .composer.locked textarea {
    resize: none;
    cursor: not-allowed;
  }
  .composer.locked .tool:disabled,
  .composer.locked .go:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .yt-note {
    margin: 6px 0 0;
    color: var(--color-secondary);
    font-size: 0.85rem;
  }
  .picks {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .picks li {
    position: relative;
    width: 72px;
    height: 72px;
  }
  .picks img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: var(--radius-sm);
  }
  .picks .x {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: 50%;
    background: #0009;
    color: #fff;
    cursor: pointer;
    line-height: 1;
  }
  .composer-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--color-rule);
  }
  .tools {
    display: inline-flex;
    gap: 2px;
  }
  .tool {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-muted);
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .tool:hover:not(:disabled) {
    background: var(--color-bg);
    color: var(--color-fg);
  }
  .go {
    padding: 7px 16px;
  }
</style>
