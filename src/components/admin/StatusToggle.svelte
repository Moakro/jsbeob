<script lang="ts">
  // 관리자 — 목록 줄의 '공개하기 / 비공개로' (2026-11-28 오너 지시)
  // 누르면 확인 창 → 바로 저장(순서 저장과 별개). 책이면 장 글도 함께 바뀐다(서버 content.ts adminSetArticleStatus).
  import { library } from "../../lib/library";

  let {
    item,
    onchange,
  }: {
    item: { id: string; title: string; status: string; chapters?: number };
    onchange: (status: string) => void;
  } = $props();

  let busy = $state(false);
  const isPub = $derived(item.status === "published");

  /** 받침 있으면 a, 없으면 b (과/와, 을/를) */
  function josa(word: string, a: string, b: string) {
    const c = word.trim().charCodeAt(word.trim().length - 1);
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 ? a : b;
    return a;
  }

  async function toggle() {
    if (busy) return;
    const next = isPub ? "draft" : "published";
    const n = item.chapters ?? 0;
    const name = `『${item.title}』`;
    const who = n ? `${name}${josa(item.title, "과", "와")} 장 ${n}개를` : `${name}${josa(item.title, "을", "를")}`;
    const text = isPub
      ? `${who} 비공개(작성 중)로 돌립니다. 방문자에게 보이지 않습니다.`
      : `${who} 공개합니다. 방문자에게 보입니다.`;
    if (!confirm(text)) return;
    busy = true;
    try {
      const r: any = await library.setStatus(item.id, next);
      onchange(r?.status ?? next);
    } catch (e) {
      alert(e instanceof Error ? e.message : "상태를 바꾸지 못했습니다");
    } finally {
      busy = false;
    }
  }
</script>

<button type="button" class="pub" class:on={!isPub} disabled={busy} onclick={toggle} data-status-toggle
  >{busy ? "바꾸는 중…" : isPub ? "비공개로" : "공개하기"}</button
>

<style>
  .pub {
    flex: none;
    min-height: 32px;
    padding: 2px 10px;
    border: 1px solid var(--color-rule);
    border-radius: 999px;
    background: var(--color-bg);
    color: var(--color-muted);
    font-size: 0.78rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .pub.on {
    border-color: var(--color-secondary);
    color: var(--color-secondary);
  }
  .pub:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
