<script lang="ts">
  // 공유 버튼 — 휴대폰은 공유 시트, 데스크톱은 주소 복사 + '복사됨' (2026-11-27)
  // 테두리 없는 원형 아이콘 버튼. '공유' 글자는 aria-label·툴팁으로만 — 글자도 보이게 하려면 showLabel (2026-11-27)
  import { shareLink } from "../lib/share";
  import ShareIcon from "./ShareIcon.svelte";

  let {
    url,
    title,
    text = undefined,
    label = "공유",
    showLabel = false,
  }: { url: string; title: string; text?: string; label?: string; showLabel?: boolean } = $props();

  let note = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function run() {
    const r = await shareLink({ url, title, text });
    if (r === "copied") say("주소를 복사했습니다");
    else if (r === "failed") say("복사하지 못했습니다");
  }
  function say(msg: string) {
    note = msg;
    clearTimeout(timer);
    timer = setTimeout(() => (note = null), 2200);
  }
</script>

<span class="share">
  <button type="button" class:with-label={showLabel} onclick={run} aria-label={`이 글 ${label}하기`} title={label}>
    <ShareIcon size={20} />
    {#if showLabel}<span class="lbl">{label}</span>{/if}
  </button>
  {#if note}<span class="note" role="status">{note}</span>{/if}
</span>

<style>
  .share {
    --share-size: 38px;
    position: relative;
    display: inline-flex;
    flex: none;
  }
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: var(--share-size);
    height: var(--share-size);
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--color-muted);
    font: inherit;
    font-size: 0.9rem;
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
    white-space: nowrap;
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color 0.15s,
      color 0.15s;
  }
  button.with-label {
    width: auto;
    padding: 0 12px 0 10px;
  }
  button:hover {
    background: rgba(31, 28, 26, 0.06);
    color: var(--color-fg);
  }
  button:active {
    background: rgba(31, 28, 26, 0.11);
  }
  button:focus-visible {
    outline: 2px solid var(--color-secondary);
    outline-offset: 1px;
  }
  .note {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 2;
    padding: 5px 10px;
    border-radius: var(--radius-sm, 6px);
    background: rgba(20, 20, 20, 0.88);
    color: #fff;
    font-size: 0.82rem;
    font-weight: 500;
    white-space: nowrap;
    pointer-events: none;
  }
</style>
