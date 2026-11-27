<script lang="ts">
  // 올리기 창 — 파일(끌어다 놓기·고르기·사진 찍기·붙여넣기)·메모·주소 → POST /api/intake (2026-11-27 올림함 0단계)
  import ModalFrame from "../ModalFrame.svelte";
  import {
    ACCEPT,
    INBOX_PATH,
    INTAKE_CHANGED,
    MAX_DOC_BYTES,
    MAX_FILES,
    MAX_IMAGE_BYTES,
    fmtSize,
    isAcceptedName,
    isImageName,
    prepareImage,
    uploadIntake,
  } from "../../lib/intake";

  let { open, onclose, ondone }: { open: boolean; onclose: () => void; ondone: (msg: string, href: string) => void } = $props();

  type Pick = { k: string; file: File; thumb: string | null };
  let picks = $state<Pick[]>([]);
  let note = $state("");
  let url = $state("");
  let hint = $state("");
  let busy = $state(false);
  let progress = $state(0);
  let stage = $state("");
  let error = $state<string | null>(null);
  let dragging = $state(false);
  /** 같은 내용을 다시 보낼 때(전송 실패 → 다시) 같은 키 — 내용이 바뀌면 새 키 */
  let idemKey = "";
  let fileInput = $state<HTMLInputElement | null>(null);
  let camInput = $state<HTMLInputElement | null>(null);

  const HINTS = [
    { v: "", label: "자동" },
    { v: "event_notice", label: "일정·소식" },
    { v: "photos", label: "사진" },
    { v: "document", label: "자료" },
  ];

  function resetKey() {
    idemKey = "";
  }
  function add(list: FileList | File[] | null | undefined) {
    if (!list) return;
    error = null;
    for (const f of Array.from(list)) {
      if (picks.length >= MAX_FILES) {
        error = `한 번에 파일 ${MAX_FILES}개까지 올릴 수 있습니다.`;
        break;
      }
      const name = f.name || (f.type === "image/png" ? "붙여넣은 화면.png" : "붙여넣은 사진.jpg");
      const file = f.name ? f : new File([f], name, { type: f.type });
      if (!isAcceptedName(file.name, file.type)) {
        error = `받지 않는 형식입니다: ${file.name} (사진 JPG·PNG·HEIC, PDF, 한글, 워드)`;
        continue;
      }
      const img = isImageName(file.name, file.type);
      // 사진은 올리기 전에 줄이므로 원본 상한을 넉넉히(줄인 뒤 서버 8MB 상한)
      if (!img && file.size > MAX_DOC_BYTES) {
        error = `문서는 20MB까지입니다: ${file.name}`;
        continue;
      }
      const thumb = img && !/\.(heic|heif)$/i.test(file.name) ? URL.createObjectURL(file) : null;
      picks.push({ k: Math.random().toString(36).slice(2), file, thumb });
    }
    resetKey();
  }
  function remove(k: string) {
    const p = picks.find((x) => x.k === k);
    if (p?.thumb) URL.revokeObjectURL(p.thumb);
    picks = picks.filter((x) => x.k !== k);
    resetKey();
  }
  function clear() {
    for (const p of picks) if (p.thumb) URL.revokeObjectURL(p.thumb);
    picks = [];
    note = "";
    url = "";
    hint = "";
    progress = 0;
    stage = "";
    error = null;
    resetKey();
  }

  // 창이 열려 있는 동안 붙여넣기(화면 캡처)를 받는다 — 글 상자에 글자를 붙여 넣는 것은 그대로
  $effect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      add(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  async function submit(e: Event) {
    e.preventDefault();
    if (busy) return;
    error = null;
    const u = url.trim();
    if (!picks.length && !note.trim() && !u) {
      error = "파일을 고르거나 메모·주소를 적어 주세요.";
      return;
    }
    if (u && !/^https?:\/\/\S+$/i.test(u)) {
      error = "인터넷 주소는 http:// 또는 https:// 로 시작해야 합니다.";
      return;
    }
    busy = true;
    progress = 0;
    try {
      const blobs: Blob[] = [];
      const names: string[] = [];
      for (let i = 0; i < picks.length; i++) {
        const p = picks[i];
        stage = picks.length > 1 ? `사진 준비 중 (${i + 1}/${picks.length})` : "준비 중";
        if (isImageName(p.file.name, p.file.type)) {
          const r = await prepareImage(p.file);
          if (r.blob.size > MAX_IMAGE_BYTES) throw new Error(`사진이 너무 큽니다: ${p.file.name} (8MB까지)`);
          blobs.push(r.blob);
          names.push(r.name);
        } else {
          blobs.push(p.file);
          names.push(p.file.name);
        }
      }
      if (!idemKey) idemKey = `web-${crypto.randomUUID()}`;
      stage = "올리는 중";
      const r = await uploadIntake({ files: blobs, names, note: note.trim(), url: u, hint }, idemKey, (x) => (progress = x));
      progress = 1;
      window.dispatchEvent(new CustomEvent(INTAKE_CHANGED));
      const href = `${INBOX_PATH}${r.intake.id}/`;
      ondone(r.duplicate ? "이미 올린 것입니다. 올림함에 있는 건을 보여 드립니다." : "올림함에 넣었습니다.", href);
      clear();
      onclose();
    } catch (err) {
      error = err instanceof Error ? err.message : "올리기 실패";
    } finally {
      busy = false;
      stage = "";
    }
  }
</script>

<ModalFrame {open} onclose={() => !busy && onclose()} label="올림함에 올리기" title="올림함에 올리기">
  <form class="is" onsubmit={submit}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="drop"
      class:on={dragging}
      ondragover={(e) => (e.preventDefault(), (dragging = true))}
      ondragleave={() => (dragging = false)}
      ondrop={(e) => (e.preventDefault(), (dragging = false), add(e.dataTransfer?.files))}
    >
      <p class="drop-t">공문·사진·PDF·카톡 대화 캡처를 여기에 끌어다 놓거나</p>
      <div class="drop-b">
        <button type="button" class="btn btn-ghost" onclick={() => fileInput?.click()} disabled={busy}>파일 고르기</button>
        <button type="button" class="btn btn-ghost" onclick={() => camInput?.click()} disabled={busy}>사진 찍기</button>
      </div>
      <p class="drop-s">화면 캡처는 붙여넣기(Ctrl+V)도 됩니다 · 한 번에 {MAX_FILES}개까지 · 여러 장은 한 건으로 묶입니다</p>
      <input bind:this={fileInput} type="file" multiple accept={ACCEPT} hidden onchange={(e) => (add(e.currentTarget.files), (e.currentTarget.value = ""))} />
      <input bind:this={camInput} type="file" accept="image/*" capture="environment" hidden onchange={(e) => (add(e.currentTarget.files), (e.currentTarget.value = ""))} />
    </div>

    {#if picks.length}
      <ul class="picks" aria-label="고른 파일">
        {#each picks as p (p.k)}
          <li>
            {#if p.thumb}<img src={p.thumb} alt="" />{:else}<span class="ico">{p.file.name.split(".").pop()?.toUpperCase()}</span>{/if}
            <span class="nm" title={p.file.name}>{p.file.name}</span>
            <span class="sz">{fmtSize(p.file.size)}</span>
            <button type="button" class="x" aria-label={`${p.file.name} 빼기`} onclick={() => remove(p.k)} disabled={busy}>✕</button>
          </li>
        {/each}
      </ul>
    {/if}

    <label class="fld">
      <span>메모 <small>(선택 — 파일 없이 글자만도 됩니다)</small></span>
      <textarea bind:value={note} oninput={resetKey} rows="3" maxlength="5000" placeholder="예) 소식으로 올려 주세요 · 받은 문자 내용 붙여넣기"></textarea>
    </label>
    <label class="fld">
      <span>인터넷 주소 <small>(선택)</small></span>
      <input type="url" bind:value={url} oninput={resetKey} maxlength="2000" placeholder="https://" inputmode="url" />
    </label>
    <div class="fld">
      <span id="is-hint">무엇인지 <small>(선택)</small></span>
      <div class="chips" role="radiogroup" aria-labelledby="is-hint">
        {#each HINTS as h}
          <button type="button" role="radio" aria-checked={hint === h.v} class:on={hint === h.v} onclick={() => ((hint = h.v), resetKey())}>{h.label}</button>
        {/each}
      </div>
    </div>

    <p class="guide">
      카톡 대화는 <b>일정과 관계있는 부분만</b> 찍어 올려 주세요. 인사·재정·분쟁 같은 민감한 문서는 올리지 않습니다.
      올린 원본은 편집진만 보며, 1년 뒤 자동으로 지워집니다.
    </p>

    {#if busy}
      <div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress * 100)}>
        <div class="bar" style={`width:${Math.round(progress * 100)}%`}></div>
        <span>{stage}{stage === "올리는 중" ? ` ${Math.round(progress * 100)}%` : ""}</span>
      </div>
    {/if}
    {#if error}<p class="err">{error}</p>{/if}
    <div class="btns">
      <a class="btn btn-ghost" href={INBOX_PATH}>올림함 보기</a>
      <button class="btn btn-primary" disabled={busy}>{busy ? "올리는 중…" : "올리기"}</button>
    </div>
  </form>
</ModalFrame>

<style>
  .is {
    display: grid;
    gap: 14px;
    padding: 4px 20px 20px;
  }
  @media (max-width: 560px) {
    .is {
      padding: 4px 14px 16px;
    }
  }
  .drop {
    border: 2px dashed var(--color-rule);
    border-radius: 10px;
    padding: 18px 14px;
    text-align: center;
    background: var(--color-surface-2);
  }
  .drop.on {
    border-color: var(--color-primary);
    background: var(--color-primary-bg);
  }
  .drop-t {
    margin: 0 0 10px;
    font-size: 0.92rem;
  }
  .drop-b {
    display: flex;
    gap: 8px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .drop-s {
    margin: 10px 0 0;
    color: var(--color-muted);
    font-size: 0.78rem;
  }
  .picks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .picks li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border: 1px solid var(--color-rule);
    border-radius: 8px;
    background: var(--color-surface);
  }
  .picks img,
  .picks .ico {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 6px;
    object-fit: cover;
    background: var(--color-surface-2);
    display: grid;
    place-items: center;
    font-size: 0.66rem;
    font-weight: 700;
    color: var(--color-muted);
  }
  .picks .nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.9rem;
  }
  .picks .sz {
    color: var(--color-muted);
    font-size: 0.8rem;
  }
  .picks .x {
    border: 0;
    background: none;
    color: var(--color-muted);
    cursor: pointer;
    font-size: 0.95rem;
    padding: 4px 6px;
  }
  .fld {
    display: grid;
    gap: 6px;
  }
  .fld > span {
    font-weight: 600;
    font-size: 0.9rem;
  }
  .fld small {
    font-weight: 400;
    color: var(--color-muted);
  }
  .fld textarea,
  .fld input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    font: inherit;
    font-size: 16px; /* 아이폰 확대 방지 */
  }
  .chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .chips button {
    border: 1px solid var(--color-rule);
    background: var(--color-surface);
    border-radius: 999px;
    padding: 6px 14px;
    font: inherit;
    font-size: 0.88rem;
    cursor: pointer;
  }
  .chips button.on {
    border-color: var(--color-primary);
    background: var(--color-primary);
    color: #fff;
  }
  .guide {
    margin: 0;
    font-size: 0.8rem;
    color: var(--color-muted);
    line-height: 1.6;
  }
  .prog {
    position: relative;
    height: 26px;
    border-radius: 6px;
    background: var(--color-surface-2);
    overflow: hidden;
  }
  .prog .bar {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--color-secondary-bg);
    border-right: 2px solid var(--color-secondary);
    transition: width 0.2s;
  }
  .prog span {
    position: relative;
    display: block;
    text-align: center;
    line-height: 26px;
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
    justify-content: space-between;
    gap: 10px;
  }
</style>
