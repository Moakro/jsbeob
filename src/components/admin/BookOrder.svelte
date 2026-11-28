<script lang="ts">
  // 관리자 — 자료실 '도서' 순서 (2026-11-28 오너 결정)
  // 위: 법종교 간행·관련 묶음(끌기·▲▼로 순서), 아래: 교계 참고 도서(가나다순, 순서 없음).
  // '법종교' 켜기/끄기로 묶음을 옮기고, '순서 저장' 한 번으로 보낸다. 저장은 bjg·sort_order 만 바꾸고 공개 상태는 안 바뀐다.
  // 공개/비공개 버튼은 따로 바로 저장한다 — 바뀐 상태는 statusOf 에만 적어 순서 편집 내용(mine/rest)을 건드리지 않는다.
  import { untrack } from "svelte";
  import { library } from "../../lib/library";
  import { BJG_LABEL, BJG_OTHERS_LABEL } from "../../lib/content-types";
  import OrderList from "./OrderList.svelte";
  import StatusToggle from "./StatusToggle.svelte";

  type Book = {
    id: string;
    title: string;
    hanja: string | null;
    status: string;
    chapters: number;
    sort: number;
    bjg: boolean;
    href: string;
  };
  let { kind, items, statusLabel }: { kind: string; items: Book[]; statusLabel: Record<string, string> } =
    $props();

  const ko = new Intl.Collator("ko");
  const alpha = (list: Book[]) => [...list].sort((a, b) => ko.compare(a.title, b.title));

  let mine = $state<Book[]>([]);
  let rest = $state<Book[]>([]);
  let saved = $state("");
  let saving = $state(false);
  let msg = $state<{ tone: "ok" | "err"; text: string } | null>(null);
  /** 목록에서 바로 바꾼 공개 상태(id → status). 되돌리기·순서 저장과 무관하게 유지 */
  let statusOf = $state<Record<string, string>>({});

  const sig = () => JSON.stringify([mine.map((b) => b.id), rest.map((b) => b.id).sort()]);
  function reset() {
    mine = items.filter((b) => b.bjg).sort((a, b) => a.sort - b.sort || ko.compare(a.title, b.title));
    rest = alpha(items.filter((b) => !b.bjg));
    saved = sig();
  }
  $effect.pre(() => {
    items;
    untrack(reset);
  });
  const dirty = $derived(sig() !== saved);

  function turnOn(b: Book) {
    rest = rest.filter((x) => x.id !== b.id);
    mine = [...mine, b];
    msg = null;
  }
  function turnOff(b: Book) {
    mine = mine.filter((x) => x.id !== b.id);
    rest = alpha([...rest, b]);
    msg = null;
  }

  async function save() {
    if (saving) return;
    saving = true;
    msg = null;
    try {
      await library.orderBooks(
        kind,
        mine.map((b) => b.id),
        rest.map((b) => b.id),
      );
      mine = mine.map((b, i) => ({ ...b, bjg: true, sort: i + 1 }));
      rest = rest.map((b) => ({ ...b, bjg: false }));
      saved = sig();
      msg = { tone: "ok", text: "순서를 저장했습니다." };
    } catch (e) {
      msg = { tone: "err", text: e instanceof Error ? e.message : "순서 저장 실패" };
    } finally {
      saving = false;
    }
  }
</script>

{#snippet info(b: Book)}
  {@const st = statusOf[b.id] ?? b.status}
  <a class="t" href={`#article/${b.id}`}
    >{b.title}{#if b.hanja}<span class="hanja">{b.hanja}</span>{/if}</a
  >
  {#if b.chapters}<span class="meta">{b.chapters}장</span>{/if}
  <span class={`badge ${st}`}>{statusLabel[st] ?? st}</span>
  <StatusToggle item={{ ...b, status: st }} onchange={(v) => (statusOf[b.id] = v)} />
  <a
    class="view"
    href={st === "published" ? b.href : `${b.href}?preview=1`}
    target="_blank"
    rel="noopener">보기</a
  >
{/snippet}

<div class="book-order" data-book-order>
  <div class="sub">
    <strong>{BJG_LABEL} <small>{mine.length}</small></strong>
    <span class="hint">위에 먼저 보입니다 · 끌거나 ▲▼로 순서</span>
  </div>
  {#if mine.length}
    <div class="box">
      <OrderList items={mine} onchange={(n) => (mine = n)} disabled={saving} label="책">
        {#snippet row(b)}
          {@render info(b)}
          <button type="button" class="tog on" disabled={saving} onclick={() => turnOff(b)}
            >법종교 끄기</button
          >
        {/snippet}
      </OrderList>
    </div>
  {:else}
    <p class="dim">아래 목록에서 '법종교 켜기'를 누르면 이 묶음으로 옮겨집니다.</p>
  {/if}

  <div class="sub">
    <strong>{BJG_OTHERS_LABEL} <small>{rest.length}</small></strong>
    <span class="hint">가나다순</span>
  </div>
  {#if rest.length}
    <ul class="box plain">
      {#each rest as b (b.id)}
        <li>
          {@render info(b)}
          <button type="button" class="tog" disabled={saving} onclick={() => turnOn(b)}>법종교 켜기</button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="dim">없습니다.</p>
  {/if}

  <div class="bar">
    {#if msg}<span class={msg.tone}>{msg.text}</span>{:else if dirty}<span class="dim">바뀐 순서가 아직 저장되지 않았습니다.</span>{/if}
    <button type="button" class="btn btn-ghost" disabled={!dirty || saving} onclick={reset}>되돌리기</button>
    <button type="button" class="btn btn-primary" disabled={!dirty || saving} onclick={save}
      >{saving ? "저장 중…" : "순서 저장"}</button
    >
  </div>
</div>

<style>
  .sub {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 10px;
    margin: 12px 0 6px;
    font-size: 0.9rem;
  }
  .sub small,
  .hint {
    color: var(--color-muted);
    font-weight: 500;
    font-size: 0.8rem;
  }
  .box {
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    overflow: hidden;
  }
  .plain {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .plain li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 6px 12px;
    border-top: 1px solid var(--color-rule);
  }
  .plain li:first-child {
    border-top: 0;
  }
  .t {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    color: var(--color-fg);
  }
  .hanja {
    margin-left: 4px;
    color: var(--color-muted);
    font-weight: 400;
  }
  .badge {
    font-size: 0.74rem;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-muted);
    flex: none;
  }
  .badge.published {
    background: var(--color-secondary-bg);
    color: var(--color-secondary);
  }
  .meta {
    font-size: 0.78rem;
    color: var(--color-muted);
    flex: none;
  }
  .view {
    font-size: 0.82rem;
    flex: none;
  }
  .tog {
    flex: none;
    min-height: 32px;
    padding: 2px 10px;
    border: 1px solid var(--color-rule);
    border-radius: 999px;
    background: var(--color-bg);
    color: var(--color-fg);
    font-size: 0.78rem;
    cursor: pointer;
  }
  .tog.on {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }
  .bar {
    position: sticky;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
    padding: 8px 0;
    background: var(--color-bg);
    font-size: 0.85rem;
  }
  .bar > span {
    margin-right: auto;
  }
  .ok {
    color: var(--color-secondary);
  }
  .err {
    color: var(--color-primary);
  }
  .dim {
    color: var(--color-muted);
    font-size: 0.85rem;
    margin: 0;
  }
  @media (max-width: 640px) {
    .meta,
    .view {
      display: none;
    }
    /* 폰: 제목은 한 줄 전체, 상태·켜기/끄기는 그 아래 */
    .plain li {
      flex-wrap: wrap;
      gap: 6px 8px;
    }
    .t {
      flex: 1 1 100%;
      white-space: normal;
    }
  }
</style>
