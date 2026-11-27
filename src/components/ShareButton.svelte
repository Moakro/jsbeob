<script lang="ts">
  // 공유 버튼 — 오리알터 카드의 '공유하기'와 같은 아이콘. 휴대폰은 공유 시트, 데스크톱은 주소 복사 + '복사됨' (2026-11-27)
  import { shareLink } from "../lib/share";

  let { url, title, text = undefined, label = "공유" }: { url: string; title: string; text?: string; label?: string } =
    $props();

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
  <button type="button" onclick={run} aria-label="이 글 공유하기">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
      ><path
        d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></path></svg
    >
    <span class="lbl">{label}</span>
  </button>
  {#if note}<span class="note" role="status">{note}</span>{/if}
</span>

<style>
  .share {
    position: relative;
    display: inline-flex;
    flex: none;
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border: 1px solid var(--color-rule);
    border-radius: 999px;
    background: transparent;
    color: var(--color-muted);
    font: inherit;
    font-size: 0.88rem;
    font-weight: 500;
    line-height: 1.2;
    cursor: pointer;
    white-space: nowrap;
  }
  button:hover {
    border-color: currentColor;
    color: var(--color-ink, inherit);
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
