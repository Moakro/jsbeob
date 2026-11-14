<svelte:options css="injected" />

<script lang="ts">
  // 블록 본문 편집기 — 소제목·글·인용·이미지·이미지 참조·영상·링크·지도 블록. 끌어서/버튼으로 순서 바꾸기.
  // mode="admin": 사진 창고에서 고르기, 썸네일·헤더 지정(onrole). mode="member": 사진 직접 올리기, 공개 지도 장소만.
  // 복원(2026-11-01): 배포본 _astro/BlockEditor.*.js(export B) 기준. 원본은 css="injected" 로 컴파일됐다.
  import { confirmDialog } from "../lib/confirm";
  import {
    emptyBlock,
    hasContent,
    loadImageBlocks,
    newImage,
    parseYouTube,
    uploadImage,
    type EditBlock,
  } from "../lib/blocks";
  import { iconPath } from "../lib/map-categories";
  import RefPicker from "./RefPicker.svelte";
  import PointPicker from "./PointPicker.svelte";
  import MediaLibrary from "./MediaLibrary.svelte";

  let {
    blocks = $bindable([]),
    mode = "member",
    thumbId = null,
    heroId = null,
    onrole,
  }: {
    blocks?: EditBlock[];
    mode?: "member" | "admin";
    thumbId?: string | null;
    heroId?: string | null;
    onrole?: (role: "thumb" | "hero", media: { id: string; url: string }) => void;
  } = $props();

  const LABEL: Record<string, string> = {
    heading: "소제목",
    text: "글",
    quote: "인용",
    image: "이미지",
    imageref: "이미지 참조",
    video: "영상",
    link: "링크",
    map: "지도",
    verse: "절",
  };
  const ADDS = [
    { type: "heading", label: "소제목 추가" },
    { type: "text", label: "글 추가" },
    { type: "quote", label: "인용 추가" },
    { type: "image", label: "이미지 추가" },
    { type: "imageref", label: "이미지 참조 추가" },
    { type: "video", label: "영상 추가" },
    { type: "link", label: "링크 추가" },
    { type: "map", label: "지도 추가" },
  ] as const;
  // 경전 절 블록은 관리자 문서에서만 (2026-11-14)
  const adds = $derived(mode === "admin" ? [...ADDS, { type: "verse", label: "절 추가" } as const] : ADDS);

  /** 블록별 업로드 상태 문구 */
  const uploadNote = $state<Record<string, string>>({});
  /** 사진 창고를 연 이미지 블록 */
  let pickingFor = $state<string | null>(null);
  /** 링크 블록 자료 찾기 */
  let linkFor = $state<string | null>(null);
  /** 인용 블록 출처 자료 찾기 */
  let sourceFor = $state<string | null>(null);
  let draggingKey = $state<string | null>(null);
  /** 지도 블록 장소 찾기 */
  let pointFor = $state<string | null>(null);

  /** 지도 블록 번호(글 순서, 같은 장소는 같은 번호) */
  const pointNo = $derived.by(() => {
    const order: string[] = [];
    for (const b of blocks) if (b.type === "map" && b.point && !order.includes(b.point)) order.push(b.point);
    return (id: string | null) => (id ? order.indexOf(id) + 1 : 0);
  });

  function setPoint(b: EditBlock, p: any) {
    b.point = p.id;
    b.view_title = p.name;
    b.view_kind = p.status === "published" ? "지도 장소" : "비공개 장소";
    b.view_point = {
      lat: p.lat,
      lng: p.lng,
      color: p.color,
      icon: p.icon,
      name_hanja: p.name_hanja,
      visible: p.status === "published",
    };
    pointFor = null;
  }
  function clearPoint(b: EditBlock) {
    b.point = null;
    b.view_point = null;
    b.view_title = b.view_kind = null;
  }

  // 이미지 참조 — 자료를 고른 뒤 그 자료의 이미지 블록을 고른다
  let imgrefFor = $state<string | null>(null);
  let imgref = $state<{ hit: any; blocks: any[] | null; error: string | null } | null>(null);
  async function pickRefDoc(hit: any) {
    imgref = { hit, blocks: null, error: null };
    try {
      const list = await loadImageBlocks(hit.kind, hit.id);
      imgref = { hit, blocks: list, error: list.length ? null : "이 자료에는 이미지 블록이 없습니다." };
    } catch (e) {
      imgref = { hit, blocks: [], error: e instanceof Error ? e.message : "불러오지 못했습니다" };
    }
  }
  function pickRefBlock(b: EditBlock, blk: any) {
    if (!imgref) return;
    b.ref = { kind: imgref.hit.kind, id: imgref.hit.id };
    b.block = blk.block_id;
    b.view_title = imgref.hit.title;
    b.view_kind = imgref.hit.label;
    b.view_href = imgref.hit.href;
    b.view_thumbs = blk.thumbs;
    if (!b.caption && blk.caption) b.caption = blk.caption;
    imgrefFor = null;
    imgref = null;
  }
  function clearImageRef(b: EditBlock) {
    b.ref = null;
    b.block = null;
    b.view_thumbs = [];
    b.view_title = b.view_kind = b.view_href = null;
  }

  // 빈 본문이면 글 블록 하나
  $effect(() => {
    if (blocks.length === 0) blocks = [emptyBlock("text")];
  });

  const isEmpty = $derived(!blocks.some(hasContent));

  function openInDrawer(ref: { kind: string; id: string } | null) {
    if (ref)
      window.dispatchEvent(new CustomEvent("jb:drawer-open", { detail: { kind: ref.kind, id: ref.id } }));
  }

  function add(type: EditBlock["type"], atTop = false) {
    const b = emptyBlock(type);
    blocks = atTop ? [b, ...blocks] : [...blocks, b];
    queueMicrotask(() => {
      document.querySelector<HTMLElement>(`[data-bk="${b._k}"] input, [data-bk="${b._k}"] textarea`)?.focus();
    });
  }

  async function remove(i: number) {
    if (
      hasContent(blocks[i]) &&
      !(await confirmDialog({
        title: "블록 삭제",
        message: "이 블록에 쓴 내용을 지울까요?",
        confirmText: "삭제",
        tone: "danger",
      }))
    )
      return;
    const rest = blocks.filter((_, j) => j !== i);
    blocks = rest.length ? rest : [emptyBlock("text")];
  }

  function move(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    blocks = next;
  }

  function dragStart(e: DragEvent, key: string) {
    draggingKey = key;
    e.dataTransfer?.setData("text/plain", "");
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  /** 끄는 블록을 이 블록의 위/아래 절반에 따라 앞뒤로 옮긴다 */
  function dragOver(e: DragEvent, key: string) {
    if (!draggingKey) return;
    e.preventDefault();
    if (key === draggingKey) return;
    const from = blocks.findIndex((b) => b._k === draggingKey);
    const to = blocks.findIndex((b) => b._k === key);
    if (from < 0 || to < 0) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    let at = next.findIndex((b) => b._k === key);
    if (after) at += 1;
    next.splice(at, 0, moved);
    if (next.map((b) => b._k).join() !== blocks.map((b) => b._k).join()) blocks = next;
  }

  /** 회원 사진 올리기 */
  async function uploadFiles(e: Event, b: EditBlock) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = "";
    if (!files.length) return;
    let err = "";
    for (let i = 0; i < files.length; i++) {
      uploadNote[b._k] = `올리는 중… (${i + 1}/${files.length})`;
      try {
        const r = await uploadImage(files[i]);
        b.images = [...b.images, newImage({ key: r.key, view_url: r.view_url })];
      } catch (ex) {
        err = ex instanceof Error ? ex.message : "올리지 못했습니다";
      }
    }
    if (err) uploadNote[b._k] = err;
    else delete uploadNote[b._k];
  }

  /** 사진 창고에서 고른 사진 */
  function addPicked(items: any[]) {
    const b = blocks.find((x) => x._k === pickingFor);
    if (b) {
      const have = new Set(b.images.map((i) => i.media_id));
      b.images = [
        ...b.images,
        ...items.filter((m) => !have.has(m.id)).map((m) => newImage({ media_id: m.id, view_url: m.url })),
      ];
    }
    pickingFor = null;
  }

  function moveImage(b: EditBlock, i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= b.images.length) return;
    const next = [...b.images];
    [next[i], next[j]] = [next[j], next[i]];
    b.images = next;
  }

  function setSource(b: EditBlock, hit: any) {
    b.source_ref = { kind: hit.kind, id: hit.id };
    b.view_title = hit.title;
    b.view_kind = hit.label;
    b.view_href = hit.href;
    sourceFor = null;
  }
  function clearSource(b: EditBlock) {
    b.source_ref = null;
    b.view_title = b.view_kind = b.view_href = null;
  }

  function setLink(b: EditBlock, hit: any) {
    b.ref = { kind: hit.kind, id: hit.id };
    b.view_title = hit.title;
    b.view_kind = hit.label;
    b.view_href = hit.href;
    b.url = "";
    b.label = "";
    linkFor = null;
  }
  function clearLink(b: EditBlock) {
    b.ref = null;
    b.view_title = b.view_kind = b.view_href = null;
  }

  /** textarea 높이를 내용에 맞춘다 */
  function autosize(node: HTMLTextAreaElement) {
    const fit = () => {
      node.style.height = "auto";
      node.style.height = Math.max(node.scrollHeight + 2, 80) + "px";
    };
    fit();
    node.addEventListener("input", fit);
    return { destroy: () => node.removeEventListener("input", fit) };
  }
</script>

<div class="be">
  <div class="adds top">
    {#each adds as a}
      <button type="button" onclick={() => add(a.type, true)}>{a.label}</button>
    {/each}
  </div>
  {#each blocks as b, i (b._k)}
    {@const vid = b.type === "video" ? parseYouTube(b.video) : null}
    <div
      class="be-blk"
      class:dragging={draggingKey === b._k}
      role="group"
      data-bk={b._k}
      aria-label={`${LABEL[b.type]} 블록`}
      ondragover={(e) => dragOver(e, b._k)}
      ondrop={(e) => e.preventDefault()}
    >
      <div class="head">
        <span
          class="grip"
          draggable="true"
          aria-hidden="true"
          title="끌어서 옮기기"
          ondragstart={(e) => dragStart(e, b._k)}
          ondragend={() => (draggingKey = null)}>⠿</span
        >
        <span class="label">{LABEL[b.type]}</span>
        <span class="tools">
          <button type="button" aria-label="위로" title="위로" disabled={i === 0} onclick={() => move(i, -1)}
            >↑</button
          >
          <button
            type="button"
            aria-label="아래로"
            title="아래로"
            disabled={i === blocks.length - 1}
            onclick={() => move(i, 1)}>↓</button
          >
          <button type="button" class="x" aria-label="삭제" title="삭제" onclick={() => remove(i)}>✕</button>
        </span>
      </div>
      <div class="body">
        {#if b.type === "heading"}
          <input class="title" placeholder="소제목" maxlength="200" bind:value={b.text} />
        {:else if b.type === "text"}
          <textarea placeholder="본문 단락" rows="5" bind:value={b.text} use:autosize></textarea>
        {:else if b.type === "quote"}
          <textarea class="quote" placeholder="인용문" rows="3" bind:value={b.text} use:autosize></textarea>
          <input
            maxlength="300"
            placeholder={b.source_ref
              ? "출처 문구 (비우면 연결한 자료의 제목)"
              : "출처 (선택) — 예: 화은당실기 3장"}
            bind:value={b.source}
          />
          {#if b.source_ref}
            <div class="ref-chip">
              <span class="kind">{b.view_kind ?? "사이트 자료"}</span>
              <span class="t">{b.view_title ?? "(제목 확인 중)"}</span>
              <span class="note">출처를 누르면 이 자료가 옆 서랍으로 열립니다</span>
              <button type="button" class="link" onclick={() => clearSource(b)}>연결 해제</button>
              <button type="button" class="link open-drawer" onclick={() => openInDrawer(b.source_ref)}
                >서랍에서 보기 ›</button
              >
            </div>
            <label class="anchor-row"
              >문장 위치 (선택)
              <input
                placeholder="예: 1-1-3 — 경전의 그 문장으로 바로 연결"
                maxlength="40"
                value={b.source_ref.anchor ?? ""}
                oninput={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value.trim().replace(/^\^/, "");
                  const { anchor, ...rest } = b.source_ref;
                  b.source_ref = v ? { ...rest, anchor: v } : rest;
                }}
              /></label
            >
          {:else}
            <div class="row">
              <button
                type="button"
                class="btn-s"
                onclick={() => (sourceFor = sourceFor === b._k ? null : b._k)}>출처에 사이트 자료 연결</button
              >
              <span class="note">(선택) 사이트 안의 자료만 연결할 수 있습니다</span>
            </div>
            {#if sourceFor === b._k}
              <RefPicker onpick={(hit) => setSource(b, hit)} oncancel={() => (sourceFor = null)} />
            {/if}
          {/if}
        {:else if b.type === "image"}
          {#if b.images.length}
            <ul class="imgs" class:multi={b.images.length > 1}>
              {#each b.images as img, j (img._k)}
                <li>
                  {#if img.view_url}<img src={img.view_url} alt="" />{:else}<span class="ph"></span>{/if}
                  {#if b.images.length > 1}
                    <input placeholder="이 사진 설명 (선택)" maxlength="300" bind:value={img.caption} />
                  {/if}
                  <div class="img-btns">
                    {#if mode === "admin" && onrole && img.media_id}
                      <button
                        type="button"
                        class="role"
                        class:on={thumbId === img.media_id}
                        aria-pressed={thumbId === img.media_id}
                        onclick={() => onrole("thumb", { id: img.media_id!, url: img.view_url ?? "" })}
                        >썸네일</button
                      >
                      <button
                        type="button"
                        class="role"
                        class:on={heroId === img.media_id}
                        aria-pressed={heroId === img.media_id}
                        onclick={() => onrole("hero", { id: img.media_id!, url: img.view_url ?? "" })}
                        >헤더</button
                      >
                      <span class="sp"></span>
                    {/if}
                    {#if b.images.length > 1}
                      <button
                        type="button"
                        title="앞으로"
                        disabled={j === 0}
                        onclick={() => moveImage(b, j, -1)}>←</button
                      >
                      <button
                        type="button"
                        title="뒤로"
                        disabled={j === b.images.length - 1}
                        onclick={() => moveImage(b, j, 1)}>→</button
                      >
                    {/if}
                    <button
                      type="button"
                      title="빼기"
                      onclick={() => (b.images = b.images.filter((x) => x._k !== img._k))}>빼기</button
                    >
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
          <div class="row">
            {#if mode === "admin"}
              <button type="button" class="btn-s" onclick={() => (pickingFor = b._k)}
                >{b.images.length ? "사진 더 고르기" : "사진 창고에서 고르기"}</button
              >
            {:else}
              <label class="btn-s file"
                >{b.images.length ? "사진 더 올리기" : "사진 올리기"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  hidden
                  onchange={(e) => uploadFiles(e, b)}
                /></label
              >
            {/if}
            <span class="note">여러 장이면 격자로 보입니다</span>
            {#if uploadNote[b._k]}<span class="note">{uploadNote[b._k]}</span>{/if}
          </div>
          <input
            maxlength="500"
            placeholder={b.images.length > 1 ? "사진 묶음 설명 (선택)" : "이미지 설명 (선택)"}
            bind:value={b.caption}
          />
        {:else if b.type === "imageref"}
          {#if b.ref && b.block}
            <div class="ir-thumbs">
              {#each b.view_thumbs.slice(0, 6) as u}<img src={u} alt="" />{/each}
              {#if b.view_thumbs.length > 6}<span class="note">+{b.view_thumbs.length - 6}</span>{/if}
            </div>
            <div class="ref-chip">
              <span class="kind">{b.view_kind ?? "자료"}</span>
              <span class="t">{b.view_title ?? "(제목 확인 중)"}</span>
              <span class="note">방문자는 썸네일을 누르면 이미지 뷰어로 크게 봅니다</span>
              <button type="button" class="link" onclick={() => clearImageRef(b)}>다시 고르기</button>
            </div>
          {:else if imgrefFor === b._k && imgref}
            <div class="ir-pick">
              <div class="row">
                <strong>{imgref.hit.title}</strong>
                <button type="button" class="link" onclick={() => (imgref = null)}>← 다른 자료</button>
              </div>
              {#if !imgref.blocks}
                <p class="note">불러오는 중…</p>
              {:else if imgref.error}
                <p class="note">{imgref.error}</p>
              {:else}
                <p class="note">참조할 이미지 블록을 고르세요</p>
                {#each imgref.blocks as blk (blk.block_id)}
                  <button type="button" class="ir-opt" onclick={() => pickRefBlock(b, blk)}>
                    {#each blk.thumbs.slice(0, 5) as u}<img src={u} alt="" />{/each}
                    <span>{blk.caption ?? `${blk.thumbs.length}장`}</span>
                  </button>
                {/each}
              {/if}
            </div>
          {:else}
            <div class="row">
              <button
                type="button"
                class="btn-s"
                onclick={() => {
                  imgrefFor = imgrefFor === b._k ? null : b._k;
                  imgref = null;
                }}>참조할 자료 찾기</button
              >
              <span class="note">소개·자료실·전각에 올린 이미지 블록을 불러옵니다</span>
            </div>
            {#if imgrefFor === b._k}
              <RefPicker
                kinds={["article", "place"]}
                placeholder="이미지가 있는 자료 제목 (예: 영대)"
                onpick={pickRefDoc}
                oncancel={() => (imgrefFor = null)}
              />
            {/if}
          {/if}
          <input placeholder="설명 (선택)" maxlength="500" bind:value={b.caption} />
        {:else if b.type === "video"}
          <input placeholder="YouTube 주소" inputmode="url" bind:value={b.video} />
          {#if vid}
            <div class="pv-video">
              <div class="frame">
                <iframe
                  title="영상 미리보기"
                  loading="lazy"
                  allowfullscreen
                  referrerpolicy="strict-origin-when-cross-origin"
                  src={`https://www.youtube.com/embed/${vid}`}
                ></iframe>
              </div>
            </div>
          {/if}
          <input placeholder="영상 설명 (선택)" maxlength="500" bind:value={b.caption} />
        {:else if b.type === "map"}
          {#if b.point}
            {@const vp = b.view_point}
            <div class="ref-chip pt-chip">
              <span class="pt-no" title="방문자 모달 지도의 번호(글 순서)">{pointNo(b.point)}</span>
              {#if vp}
                <span class="pt-mk" class:is-doc={vp.icon === "doc"} style:background={vp.color}
                  ><svg viewBox="0 -960 960 960" width="12" height="12" aria-hidden="true"
                    ><path fill="currentColor" d={iconPath(vp.icon)}></path></svg
                  ></span
                >
              {/if}
              <span class="t"
                >{b.view_title ?? "(장소 확인 중)"}
                {#if vp?.name_hanja}<small>{vp.name_hanja}</small>{/if}</span
              >
              {#if vp && !vp.visible}<span class="note warn">비공개 장소 — 공개해야 방문자에게 보입니다</span
                >{/if}
              <button type="button" class="link" onclick={() => clearPoint(b)}>다시 고르기</button>
            </div>
            <p class="hint">
              방문자 화면에는 이 장소의 썸네일이 보이고, 누르면 이 글의 지도 블록 장소 전부가 번호 마커로 뜨는 지도가 열립니다.
            </p>
          {:else}
            <div class="row">
              <button type="button" class="btn-s" onclick={() => (pointFor = pointFor === b._k ? null : b._k)}
                >지도 장소 고르기</button
              >
              <span class="note">블록 하나에 장소 하나 — 여러 곳이면 지도 블록을 여러 개 넣습니다</span>
            </div>
            {#if pointFor === b._k}
              <PointPicker {mode} onpick={(p) => setPoint(b, p)} oncancel={() => (pointFor = null)} />
            {/if}
          {/if}
          <input placeholder="짧은 설명 (선택)" maxlength="500" bind:value={b.caption} />
        {:else if b.type === "link"}
          {#if b.ref}
            <div class="ref-chip">
              <span class="kind">{b.view_kind ?? "사이트 자료"}</span>
              <span class="t">{b.view_title ?? "(제목 확인 중)"}</span>
              {#if b.view_href}<a href={b.view_href} target="_blank" rel="noopener">보기</a>{/if}
              <button type="button" class="link" onclick={() => clearLink(b)}>연결 해제</button>
            </div>
          {:else}
            <div class="row">
              <button type="button" class="btn-s" onclick={() => (linkFor = linkFor === b._k ? null : b._k)}
                >사이트 자료에서 찾기</button
              >
              <span class="note">또는 주소를 붙여 넣으세요</span>
            </div>
            {#if linkFor === b._k}
              <RefPicker onpick={(hit) => setLink(b, hit)} oncancel={() => (linkFor = null)} />
            {/if}
            <input placeholder="링크 주소 (https://…)" inputmode="url" maxlength="2000" bind:value={b.url} />
            <input placeholder="표시할 문구" maxlength="200" bind:value={b.label} />
            <p class="hint">
              사이트 안의 주소를 붙여 넣으면 저장할 때 사이트 자료로 연결되고, 제목은 자료의 현재 제목으로 표시됩니다.
            </p>
          {/if}
        {:else if b.type === "verse"}
          <input class="title" placeholder="절 이름 — 예: 3절" maxlength="40" bind:value={b.label} />
          <textarea class="verse" placeholder="한 줄에 한 문장" rows="5" bind:value={b.text} use:autosize></textarea>
          <p class="hint">
            한 줄이 한 문장입니다. 줄 끝의 <code>^1-1-3</code> 같은 표시는 그 문장의 위치(인용·관련링크가 가리키는 곳)이니
            지우거나 바꾸지 마세요. 새로 넣은 문장은 표시 없이 쓰면 저장할 때 다음 번호가 붙습니다.
          </p>
        {/if}
      </div>
    </div>
  {/each}
  <div class="adds">
    {#each adds as a}
      <button type="button" onclick={() => add(a.type)}>{a.label}</button>
    {/each}
  </div>
  {#if isEmpty}<p class="empty">본문이 비어 있습니다. 블록을 하나 이상 채워 주세요.</p>{/if}
</div>
{#if pickingFor}
  <div class="overlay" role="dialog" aria-modal="true" aria-label="사진 고르기">
    <div class="sheet">
      <h3>본문에 넣을 사진 고르기</h3>
      <MediaLibrary mode="pick" multiple onpick={addPicked} oncancel={() => (pickingFor = null)} />
    </div>
  </div>
{/if}

<style>
  .be {
    display: grid;
    gap: 10px;
  }
  .be-blk {
    border: 1px solid var(--color-rule);
    background: #fff;
    border-radius: var(--radius-sm);
  }
  .be-blk.dragging {
    opacity: 0.5;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-surface-2);
  }
  .grip {
    cursor: grab;
    user-select: none;
    color: var(--color-muted);
    font-size: 0.8rem;
    padding: 0 2px;
  }
  .label {
    font-size: 0.74rem;
    font-weight: 700;
    color: var(--color-muted);
  }
  .tools {
    margin-left: auto;
    display: flex;
    gap: 4px;
  }
  .tools button {
    width: 26px;
    height: 26px;
    border: 1px solid var(--color-rule);
    background: #fff;
    border-radius: var(--radius-sm);
    font-size: 0.78rem;
    cursor: pointer;
    color: var(--color-muted);
  }
  .tools button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .tools .x {
    color: var(--color-primary);
  }
  .body {
    display: grid;
    gap: 8px;
    padding: 10px;
  }
  input:not([type="file"]),
  textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    font: inherit;
    font-size: 0.95rem;
    color: var(--color-fg);
    background: #fff;
  }
  input.title {
    font-weight: 700;
  }
  textarea {
    resize: vertical;
    line-height: 1.7;
  }
  textarea.verse {
    font-size: 0.95rem;
    line-height: 1.7;
  }
  .anchor-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    color: var(--color-muted, #666);
  }
  .anchor-row input {
    flex: 1;
  }
  textarea.quote {
    background: var(--color-surface-2);
    border-left: 3px solid var(--color-gold-soft);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .btn-s {
    display: inline-flex;
    align-items: center;
    padding: 5px 12px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: #fff;
    font-size: 0.82rem;
    cursor: pointer;
    color: var(--color-fg);
  }
  .btn-s:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }
  .note,
  .hint {
    font-size: 0.78rem;
    color: var(--color-muted);
    margin: 0;
  }
  .ir-thumbs {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }
  .ir-thumbs img,
  .ir-opt img {
    width: 72px;
    height: 54px;
    object-fit: cover;
    border-radius: var(--radius-sm);
  }
  .ir-pick {
    display: grid;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
  }
  .ir-opt {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 6px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: #fff;
    cursor: pointer;
    text-align: left;
    font: inherit;
    font-size: 0.85rem;
  }
  .ir-opt:hover {
    border-color: var(--color-primary);
  }
  .imgs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .imgs.multi {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }
  .imgs li {
    display: grid;
    gap: 4px;
    align-content: start;
  }
  .imgs img,
  .imgs .ph {
    display: block;
    max-width: 100%;
    max-height: 260px;
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
  }
  .imgs.multi img,
  .imgs.multi .ph {
    width: 100%;
    height: 110px;
    object-fit: cover;
  }
  .imgs input {
    font-size: 0.8rem;
    padding: 5px 7px;
  }
  .img-btns {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .img-btns button {
    border: 1px solid var(--color-rule);
    background: #fff;
    border-radius: var(--radius-sm);
    font-size: 0.74rem;
    padding: 2px 7px;
    white-space: nowrap;
    cursor: pointer;
  }
  .img-btns .sp {
    flex: 1;
  }
  .img-btns .role.on {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: #fff;
  }
  .img-btns button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .pv-video {
    width: 33%;
    min-width: 160px;
  }
  .frame {
    position: relative;
    padding-top: 56.25%;
    border: 1px solid var(--color-rule);
  }
  .frame iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
  }
  .ref-chip {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 8px 10px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: var(--color-secondary-bg);
  }
  .ref-chip .kind {
    font-size: 0.72rem;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--color-secondary);
    color: #fff;
  }
  .ref-chip .t {
    font-weight: 600;
  }
  .pt-no {
    flex: none;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    box-sizing: border-box;
    display: grid;
    place-items: center;
    border-radius: 999px;
    background: var(--color-fg);
    color: #fff;
    font-size: 0.74rem;
    font-weight: 700;
  }
  .pt-mk {
    flex: none;
    width: 22px;
    height: 22px;
    box-sizing: border-box;
    display: grid;
    place-items: center;
    border: 1.5px solid #fff;
    border-radius: 50%;
    color: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  }
  .pt-mk.is-doc {
    border-color: #4a4038;
    color: #4a4038;
  }
  .ref-chip small {
    font-weight: 400;
    color: var(--color-muted);
  }
  .note.warn {
    color: var(--color-gold);
  }
  .ref-chip a {
    font-size: 0.82rem;
  }
  .ref-chip .open-drawer {
    margin-left: auto; /* 칩 맨 오른쪽 */
    font-weight: 600;
    color: var(--color-secondary);
  }
  .link {
    border: 0;
    background: none;
    color: var(--color-primary);
    cursor: pointer;
    font-size: 0.82rem;
    padding: 0;
  }
  .adds {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .adds button {
    padding: 4px 10px;
    border: 1px solid var(--color-rule);
    background: #fff;
    font-size: 0.82rem;
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .adds button:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }
  .empty {
    margin: 0;
    font-size: 0.82rem;
    color: var(--color-gold);
  }
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: var(--color-overlay);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 4vh 16px;
    overflow: auto;
  }
  .sheet {
    width: min(960px, 100%);
    background: var(--color-bg);
    border-radius: var(--radius-lg);
    padding: 18px;
    box-shadow: var(--shadow-lg);
  }
  .sheet h3 {
    margin: 0 0 12px;
  }
</style>
