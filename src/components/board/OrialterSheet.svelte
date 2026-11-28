<script lang="ts">
  // ＋ 버튼 '오리알터에 올리기' 창 — 도생광장 피드 맨 위 글쓰기 폼(OrialterComposer)을 그대로 띄운다 (2026-11-28 오너 결정)
  // AI·올림함을 거치지 않는다. 교인(40) 이상만 이 창을 연다(IntakeFab). 권한·하루 상한은 API 가 검사한다.
  import ModalFrame from "../ModalFrame.svelte";
  import { ORIALTER_POSTED } from "../../lib/api";
  import OrialterComposer from "./OrialterComposer.svelte";

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);

  function posted(id: string) {
    error = null;
    onclose();
    // 도생광장 피드가 떠 있으면 그 자리에서 새로 읽고, 아니면 피드로 간다
    const ev = new CustomEvent(ORIALTER_POSTED, { detail: { id, handled: false } });
    window.dispatchEvent(ev);
    if (!ev.detail.handled) location.href = "/community/";
  }
</script>

<ModalFrame {open} onclose={() => !busy && onclose()} label="오리알터에 올리기" title="오리알터에 올리기">
  <div class="os">
    <OrialterComposer onposted={posted} onerror={(m) => (error = m)} onbusy={(b) => (busy = b, b && (error = null))} />
    {#if error}<p class="err" role="alert">{error}</p>{/if}
  </div>
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
  .err {
    margin: 0;
    color: var(--color-primary);
    background: var(--color-primary-bg);
    padding: 8px 12px;
    border-radius: var(--radius-md);
    font-size: 0.9rem;
  }
</style>
