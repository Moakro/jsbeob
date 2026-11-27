<script lang="ts">
  // 올림함 목록 (/editor/inbox/) — 편집진 공용, 누가 올렸는지 표시 (2026-11-27 올림함 0단계, 결정 14)
  import { onMount } from "svelte";
  import { api } from "../../lib/api";
  import {
    HINT_LABEL,
    KIND_LABEL,
    INBOX_PATH,
    INTAKE_CHANGED,
    INTAKE_LEVEL,
    INTAKE_OPEN,
    checkCount,
    fmtWhen,
    intakeApi,
    isProcessing,
    statusLabel,
    type Intake,
  } from "../../lib/intake";

  type Tab = "open" | "published" | "discarded" | "all";
  const TABS: { v: Tab; label: string }[] = [
    { v: "open", label: "처리 전" },
    { v: "published", label: "게시됨" },
    { v: "discarded", label: "버림" },
    { v: "all", label: "전체" },
  ];

  let allowed = $state<boolean | null>(null);
  let tab = $state<Tab>("open");
  let items = $state<Intake[]>([]);
  let next = $state<string | null>(null);
  let open = $state(0);
  let loading = $state(false);
  let error = $state<string | null>(null);

  async function load(more = false) {
    loading = true;
    error = null;
    try {
      const r = await intakeApi.list(tab, more ? next : null);
      items = more ? [...items, ...r.items] : r.items;
      next = r.next;
      open = r.open;
    } catch (e) {
      error = e instanceof Error ? e.message : "불러오기 실패";
    } finally {
      loading = false;
    }
  }

  // AI 처리 중인 건이 보이면 10초마다 다시 읽는다(화면이 보일 때만)
  $effect(() => {
    if (!allowed || !items.some(isProcessing)) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && !loading) load();
    }, 10_000);
    return () => clearInterval(t);
  });

  onMount(() => {
    const t = new URLSearchParams(location.search).get("tab");
    if (t && TABS.some((x) => x.v === t)) tab = t as Tab;
    const onChanged = () => allowed && load();
    window.addEventListener(INTAKE_CHANGED, onChanged);
    (async () => {
      const me = (await api.me().catch(() => ({ user: null }))).user;
      allowed = !!me && (me.level ?? 0) >= INTAKE_LEVEL;
      if (allowed) load();
    })();
    return () => window.removeEventListener(INTAKE_CHANGED, onChanged);
  });

  function setTab(t: Tab) {
    tab = t;
    history.replaceState(null, "", t === "open" ? INBOX_PATH : `${INBOX_PATH}?tab=${t}`);
    load();
  }

  const firstImage = (it: Intake) => it.files.find((f) => f.file_url && /^image\/(jpeg|png|webp)$/.test(f.content_type));
  const summary = (it: Intake) =>
    it.title || it.note?.split("\n")[0]?.slice(0, 80) || it.url || (it.files.length ? it.files.map((f) => f.name).join(", ") : "(내용 없음)");
  const fileLabel = (it: Intake) => {
    if (!it.files.length) return it.url ? "주소" : "메모";
    const img = it.files.filter((f) => f.content_type.startsWith("image/")).length;
    const doc = it.files.length - img;
    return [img && `사진 ${img}`, doc && `문서 ${doc}`].filter(Boolean).join(" · ");
  };
</script>

{#if allowed === null}
  <p class="state">불러오는 중…</p>
{:else if !allowed}
  <p class="state">편집진만 볼 수 있는 화면입니다.</p>
{:else}
  <div class="inbox">
    <div class="head">
      <h1>올림함 {#if open}<span class="cnt">{open}</span>{/if}</h1>
      <button type="button" class="btn btn-primary" onclick={() => window.dispatchEvent(new CustomEvent(INTAKE_OPEN))}>＋ 올리기</button>
    </div>
    <p class="lead">편집진이 올린 공문·사진·메모를 모아 둡니다. 사진·PDF·메모는 AI 가 1~2분 안에 일정·소식 초안을 만들어 둡니다(초안 준비). 한 건을 열어 원본과 대조해 고친 뒤 게시하거나 버립니다.</p>
    <div class="tabs" role="tablist">
      {#each TABS as t}
        <button type="button" role="tab" aria-selected={tab === t.v} class:on={tab === t.v} onclick={() => setTab(t.v)}>{t.label}</button>
      {/each}
    </div>
    {#if error}<p class="err">{error}</p>{/if}
    {#if !items.length && !loading}
      <p class="state">{tab === "open" ? "처리할 올림이 없습니다. ＋ 버튼으로 올려 보세요." : "없습니다."}</p>
    {:else}
      <ul class="list">
        {#each items as it (it.id)}
          {@const img = firstImage(it)}
          <li>
            <a href={`${INBOX_PATH}${it.id}/`}>
              {#if img}
                <img class="th" src={img.file_url} alt="" loading="lazy" />
              {:else}
                <span class="th ico">{it.files.length ? (it.files[0].name.split(".").pop() ?? "").toUpperCase() : "메모"}</span>
              {/if}
              <span class="body">
                <span class="ttl">{summary(it)}</span>
                <span class="meta">
                  {#if it.kind}<span class="hint">{KIND_LABEL[it.kind] ?? it.kind}</span>
                  {:else if it.hint}<span class="hint">{HINT_LABEL[it.hint] ?? it.hint}</span>{/if}
                  <span>{fileLabel(it)}</span>
                  <span>· {it.user.name ?? "알 수 없음"}</span>
                  <span>· {fmtWhen(it.created_at)}</span>
                </span>
              </span>
              <span class={`st st-${it.status}`} class:busy={isProcessing(it)}>
                {statusLabel(it)}{#if it.status === "published" && it.post}<small>{it.post.title}</small>
                {:else if it.status === "ready" && checkCount(it)}<small class="chk">확인 필요 {checkCount(it)}</small>{/if}
              </span>
            </a>
          </li>
        {/each}
      </ul>
      {#if next}
        <button type="button" class="btn btn-ghost more" disabled={loading} onclick={() => load(true)}>더 보기</button>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .state {
    color: var(--color-muted);
    text-align: center;
    padding: 40px 0;
  }
  .inbox {
    max-width: 860px;
    margin-inline: auto;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .head h1 {
    font-size: 1.6rem;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .cnt {
    font-size: 0.85rem;
    padding: 2px 9px;
    border-radius: 999px;
    background: var(--color-gold);
    color: #fff;
  }
  .lead {
    color: var(--color-muted);
    font-size: 0.9rem;
    margin: 8px 0 16px;
  }
  .tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--color-rule);
    margin-bottom: 8px;
    overflow-x: auto;
  }
  .tabs button {
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    padding: 8px 14px;
    font: inherit;
    font-weight: 600;
    color: var(--color-muted);
    cursor: pointer;
    white-space: nowrap;
  }
  .tabs button.on {
    color: var(--color-primary);
    border-bottom-color: var(--color-primary);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .list li + li {
    border-top: 1px solid var(--color-rule);
  }
  .list a {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 4px;
    color: inherit;
    text-decoration: none;
  }
  .list a:hover {
    background: var(--color-surface-2);
  }
  .th {
    flex: none;
    width: 56px;
    height: 56px;
    border-radius: 8px;
    object-fit: cover;
    background: var(--color-surface-2);
    border: 1px solid var(--color-rule);
  }
  .th.ico {
    display: grid;
    place-items: center;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--color-muted);
  }
  .body {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 4px;
  }
  .ttl {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    color: var(--color-muted);
    font-size: 0.82rem;
  }
  .hint {
    color: var(--color-secondary);
    font-weight: 600;
  }
  .st {
    flex: none;
    display: grid;
    justify-items: end;
    max-width: 30%;
    font-size: 0.8rem;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-muted);
  }
  .st small {
    font-weight: 400;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .st-uploaded,
  .st-ready {
    background: var(--color-secondary-bg);
    color: var(--color-secondary);
  }
  .st.busy {
    background: var(--color-surface-2);
    color: var(--color-gold);
  }
  .st-extracting::before {
    content: "";
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--color-gold);
    animation: blink 1.2s ease-in-out infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }
  .st-ready {
    background: var(--color-secondary);
    color: #fff;
  }
  .st small.chk {
    color: #fff;
    font-weight: 700;
  }
  .st-failed {
    background: var(--color-primary-bg);
    color: var(--color-primary);
  }
  .st-published {
    background: none;
    color: var(--color-secondary);
  }
  .more {
    display: block;
    margin: 16px auto;
  }
  .err {
    color: var(--color-primary);
    background: var(--color-primary-bg);
    padding: 10px 14px;
    border-radius: var(--radius-md);
  }
  @media (max-width: 560px) {
    .st small {
      display: none;
    }
  }
</style>
