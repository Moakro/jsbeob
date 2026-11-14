<script lang="ts">
  // 사이트 검색 — 홈 히어로(variant="hero")와 헤더 아이콘(variant="header") 두 모양.
  // 자료 검색(/api/content/find) 하나로 보인다. 경전은 DB 자료실 책이라 절마다 하위 결과(subs, 문장 위치)가 온다.
  // (2026-11-14: 화은당실기 DB 전환으로 Pagefind 경전 색인을 걷어 냄)
  // 검색 결과는 탭(sessionStorage)에 남겨 두고, 여러 검색칸이 'jb:search-sync' 로 서로 맞춘다.
  // 복원(2026-11-01): 배포본 SSR(Base 청크)·클라이언트(_astro/HeroSearch.*.js) 기준.
  import { onMount, tick } from "svelte";
  import { confirmDialog } from "../lib/confirm";

  interface Sub {
    url: string;
    title: string;
    excerpt: string;
    anchor?: { id: string };
  }
  interface Group {
    pageUrl: string;
    pageTitle: string;
    source: string | null;
    subs: Sub[];
  }

  const { variant = "hero", inputId = "heroSearchInput" }: { variant?: "hero" | "header"; inputId?: string } =
    $props();
  const isHeader = $derived(variant === "header");
  const panelId = $derived(`${inputId}-panel`);
  /** 이 검색칸 — 다른 검색칸이 보낸 sync 와 구분 */
  const instanceId = Math.random().toString(36).slice(2);
  const PLACEHOLDER = "증산법종교 검색";
  const STORE_KEY = "jb-hero-search";

  let query = $state("");
  let results = $state<Group[]>([]);
  let searched = $state("");
  let open = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  /** 마지막으로 연 결과(돌아왔을 때 그 위치로) */
  let lastKey = $state<string | null>(null);
  let root = $state<HTMLElement | undefined>(undefined);
  let input = $state<HTMLInputElement | undefined>(undefined);
  let list = $state<HTMLElement | undefined>(undefined);
  let toggleBtn = $state<HTMLButtonElement | undefined>(undefined);
  /** 자료(문서·장소·경전 절 등) 검색 — 발췌(excerpt)는 API 가 이스케이프하고 찾은 낱말에 <mark> 를 붙여 준다 */
  async function findContent(q: string): Promise<Group[] | null> {
    try {
      const r = await fetch(`/api/content/find?q=${encodeURIComponent(q)}`);
      if (!r.ok) return null;
      return ((await r.json()).items ?? []).map((it: any) => ({
        pageUrl: it.href,
        pageTitle: it.hanja ? `${it.title} ${it.hanja}` : it.title,
        source: it.label,
        subs: it.subs?.length
          ? it.subs.map((s: any) => ({
              url: s.url ?? it.href,
              title: s.title ?? "",
              excerpt: s.excerpt ?? "",
              anchor: s.anchor ? { id: s.anchor } : undefined,
            }))
          : [{ url: it.href, title: "", excerpt: it.excerpt }],
      }));
    } catch {
      return null;
    }
  }

  async function run() {
    const q = query.trim();
    if (!q) return;
    open = true;
    loading = true;
    try {
      const a = await findContent(q);
      error = a === null ? "검색을 불러올 수 없습니다." : null;
      results = a ?? [];
      searched = q;
      lastKey = null;
      // 모바일 키보드를 내려 결과가 보이게
      if (results.length) input?.blur();
      persist();
      await tick();
      list?.scrollTo(0, 0);
    } catch {
      results = [];
    } finally {
      loading = false;
    }
  }

  function submit(e: Event) {
    e.preventDefault();
    run();
  }

  const subKey = (g: Group, s: Sub) => (s.anchor ? `${g.pageUrl}#${s.anchor.id}` : s.url);
  /** 결과 링크 — 찾은 낱말 강조(?q=)와 절 위치(#) */
  const subHref = (g: Group, s: Sub) =>
    `${s.anchor ? g.pageUrl : s.url}?q=${encodeURIComponent(searched || query)}${s.anchor ? `#${s.anchor.id}` : ""}`;

  function remember(key: string) {
    lastKey = key;
    persist();
  }

  async function reset() {
    if (
      !(await confirmDialog({
        title: "검색 결과 초기화",
        message: "저장된 검색 결과를 모두 비웁니다. 계속할까요?",
        confirmText: "초기화",
        tone: "danger",
      }))
    )
      return;
    query = "";
    searched = "";
    results = [];
    lastKey = null;
    open = false;
    try {
      sessionStorage.removeItem(STORE_KEY);
    } catch {}
    window.dispatchEvent(new CustomEvent("jb:search-sync", { detail: instanceId }));
  }

  function persist() {
    try {
      if (searched && results.length)
        sessionStorage.setItem(STORE_KEY, JSON.stringify({ query: searched, results, lastKey }));
      else sessionStorage.removeItem(STORE_KEY);
    } catch {}
    window.dispatchEvent(new CustomEvent("jb:search-sync", { detail: instanceId }));
  }

  function restore() {
    try {
      const s = JSON.parse(sessionStorage.getItem(STORE_KEY) || "null");
      if (s && typeof s.query === "string" && Array.isArray(s.results)) {
        query = searched = s.query;
        results = s.results;
        lastKey = typeof s.lastKey === "string" ? s.lastKey : null;
      } else if (!loading) {
        results = [];
        searched = "";
        lastKey = null;
      }
    } catch {}
  }

  /** 헤더 검색 버튼 */
  async function toggle() {
    if (open) return close(false);
    window.dispatchEvent(new CustomEvent("jb:menu-close"));
    restore();
    open = true;
    loadPagefind();
    await tick();
    input?.focus();
  }

  function close(focus = true) {
    open = false;
    if (focus) toggleBtn?.focus();
  }

  // 헤더 검색이 열리면 헤더에 표시(다른 도구 숨김)
  $effect(() => {
    if (!isHeader || !root) return;
    root.closest(".masthead")?.classList.toggle("search-open", open);
  });

  function onFocus() {
    loadPagefind();
    if (results.length || error) open = true;
  }

  // 결과를 다시 열면 마지막으로 연 결과로 스크롤
  $effect(() => {
    if (!open || !lastKey || !list) return;
    requestAnimationFrame(() => list?.querySelector("a.last")?.scrollIntoView({ block: "center" }));
  });

  onMount(() => {
    restore();
    const onDocClick = (e: MouseEvent) => {
      if (open && root && !root.contains(e.target as Node) && !document.querySelector("dialog[open]"))
        open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !open || document.querySelector("dialog[open]")) return;
      if (isHeader) return close();
      open = false;
      input?.focus();
    };
    const onSync = (e: Event) => {
      if ((e as CustomEvent).detail !== instanceId) restore();
    };
    const onClose = () => {
      if (isHeader && open) close(false);
    };
    window.addEventListener("jb:search-sync", onSync);
    window.addEventListener("jb:search-close", onClose);
    // 히어로 위에 겹친 헤더(is-overlay)가 되면 헤더 검색을 닫는다
    const masthead = isHeader ? root?.closest(".masthead") : null;
    const mo = masthead
      ? new MutationObserver(() => {
          if (open && masthead.classList.contains("is-overlay") && !masthead.classList.contains("keep-tools"))
            close(false);
        })
      : null;
    if (masthead) mo!.observe(masthead, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("jb:search-sync", onSync);
      window.removeEventListener("jb:search-close", onClose);
      mo?.disconnect();
    };
  });
</script>

{#snippet searchForm()}
  <form class="hero-search" class:has-panel={open} role="search" action="#" onsubmit={submit}>
    <label class="sr-only" for={inputId}>사이트 검색</label>
    <svg class="hs-ico" viewBox="0 0 24 24" aria-hidden="true"
      ><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg
    >
    <input
      id={inputId}
      bind:value={query}
      bind:this={input}
      type="search"
      name="q"
      autocomplete="off"
      spellcheck="false"
      enterkeyhint="search"
      placeholder={PLACEHOLDER}
      aria-controls={panelId}
      onfocus={onFocus}
    />
    {#if results.length && !open && !isHeader}
      <button
        type="button"
        class="hs-reopen"
        aria-label={`이전 검색 결과 ${results.length}건 펼치기`}
        title="이전 검색 결과"
        onclick={() => (open = true)}>{results.length}</button
      >
    {/if}
    <button type="submit" class="hs-submit" aria-label="검색">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>
    </button>
  </form>
{/snippet}

{#snippet panel()}
  <div class="hs-panel" id={panelId} role="region" aria-label="검색 결과">
    <div class="hs-panel-top">
      {#if results.length}
        <button type="button" class="hs-reset" onclick={reset}>검색 결과 초기화</button>
      {/if}
      <button
        type="button"
        class="hs-fold"
        aria-label="검색 결과 접기"
        title="접기"
        onclick={() => (isHeader ? close() : (open = false))}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="18 15 12 9 6 15"></polyline></svg>
      </button>
    </div>
    {#if error}
      <p class="hs-hint">{error}</p>
    {:else if loading}
      <p class="hs-hint">검색 중…</p>
    {:else if searched && !results.length}
      <p class="hs-hint">'{searched}' 검색 결과가 없습니다.</p>
    {:else if results.length}
      <ul class="hs-results" bind:this={list}>
        {#each results as g (g.pageUrl)}
          <li class="grp">
            <div class="grp-title">
              {#if g.source}<span class="src">{g.source}</span><span class="sep" aria-hidden="true">·</span
                >{/if}
              <span>{g.pageTitle}</span>
            </div>
            <ul class="subs">
              {#each g.subs as s, i (g.pageUrl + (s.anchor?.id ?? i))}
                {@const key = subKey(g, s)}
                <li>
                  <a href={subHref(g, s)} class:last={key === lastKey} onclick={() => remember(key)}>
                    {#if s.title && s.title !== g.pageTitle}<span class="s-title">{@html s.title}</span>{/if}
                    <span class="s-excerpt">{@html s.excerpt}</span>
                  </a>
                </li>
              {/each}
            </ul>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="hs-hint">검색어를 입력하세요</p>
    {/if}
  </div>
{/snippet}

{#if isHeader}
  <div class="hs-hdr" bind:this={root}>
    <button
      type="button"
      class="hdr-btn"
      class:on={open}
      aria-label={results.length ? `사이트 검색 (이전 결과 ${results.length}건)` : "사이트 검색"}
      aria-expanded={open}
      aria-controls={`${inputId}-drop`}
      title="검색"
      bind:this={toggleBtn}
      onclick={toggle}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"
        ><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg
      >
      {#if results.length && !open}<span class="dot" aria-hidden="true"></span>{/if}
    </button>
    {#if open}
      <div class="hs-drop" id={`${inputId}-drop`} role="dialog" aria-label="사이트 검색">
        {@render searchForm()}
        {@render panel()}
      </div>
    {/if}
  </div>
{:else}
  <div class="hs-field" bind:this={root}>
    {@render searchForm()}
    {#if open}{@render panel()}{/if}
  </div>
{/if}

<style>
  .hs-field {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  .hero-search {
    width: 100%;
    height: 70px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px 0 24px;
    border-radius: var(--radius-md);
    background: #0e0b0999;
    border: 1px solid rgba(255, 255, 255, 0.16);
    box-shadow:
      0 18px 40px #00000047,
      inset 0 1px #ffffff14;
    color: #fff;
    transition:
      background-color 0.2s,
      border-color 0.2s,
      box-shadow 0.2s;
  }
  .hero-search:hover {
    background: #0e0b09a8;
  }
  .hero-search:focus-within,
  .hero-search.has-panel {
    background: #0e0b09bd;
    border-color: #ffffff57;
    box-shadow:
      0 0 0 4px #ffffff0f,
      0 18px 40px #00000052,
      inset 0 1px #ffffff14;
  }
  .hero-search svg {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .hs-ico {
    flex: none;
    color: #ffffff9e;
  }
  .hero-search input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    outline: 0;
    background: transparent;
    padding: 0 10px;
    font: inherit;
    font-size: 1.1rem;
    letter-spacing: -0.01em;
    color: #fff;
    caret-color: #f5c84c;
  }
  .hero-search input::placeholder {
    color: #ffffff8c;
  }
  .hero-search input::-webkit-search-cancel-button {
    display: none;
  }
  .hs-reopen {
    flex: none;
    min-width: 28px;
    height: 24px;
    padding: 0 8px;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 999px;
    background: #ffffff14;
    color: #ffffffd9;
    font: inherit;
    font-size: 0.75rem;
    font-weight: 700;
    cursor: pointer;
  }
  .hs-reopen:hover {
    background: #ffffff2e;
  }
  .hs-submit {
    flex: none;
    width: 50px;
    height: 50px;
    margin-left: 4px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: var(--radius-md);
    background: #ffffff24;
    color: #fff;
    cursor: pointer;
    transition: background-color 0.15s;
  }
  .hs-submit:hover {
    background: #ffffff3d;
  }
  .hs-submit:focus-visible {
    outline: 2px solid #f5c84c;
    outline-offset: 2px;
  }
  .hs-panel {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    right: 0;
    z-index: 5;
    max-height: min(60vh, 560px);
    display: flex;
    flex-direction: column;
    background: #161412f0;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    color: #f4ece2;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: var(--radius-md);
    box-shadow: 0 18px 40px #0006;
    overflow: hidden;
    animation: hs-down 0.15s ease;
  }
  @keyframes hs-down {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
  }
  .hs-panel-top {
    flex: none;
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  .hs-reset {
    flex: 1;
    padding: 0.5rem 1rem;
    background: #ffffff0a;
    border: 0;
    color: #f4ece2a6;
    font: inherit;
    font-size: 0.78rem;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }
  .hs-reset:hover {
    background: #a8352a2e;
    color: #ffb3a6;
  }
  .hs-fold {
    flex: none;
    margin-left: auto;
    width: 40px;
    display: grid;
    place-items: center;
    padding: 6px 0;
    border: 0;
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    background: transparent;
    color: #f4ece2;
    cursor: pointer;
  }
  .hs-fold:hover {
    background: #ffffff1a;
  }
  .hs-fold svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .hs-reset:focus-visible,
  .hs-fold:focus-visible,
  .subs a:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: -2px;
  }
  .hs-hint {
    margin: 0;
    padding: 0.9rem 1rem;
    color: #f4ece299;
    font-size: 0.9rem;
  }
  .hs-results {
    list-style: none;
    margin: 0;
    padding: 0.3rem 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .grp {
    padding: 0.3rem 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .grp:last-child {
    border-bottom: 0;
  }
  .grp-title {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35rem;
    padding: 0.3rem 1rem;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: #f4ece28c;
  }
  .grp-title .src {
    color: #ffb3a6;
  }
  .grp-title .sep {
    color: #f4ece24d;
  }
  .subs {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .subs a {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.5rem 1rem;
    color: #f4ece2;
    text-decoration: none;
    border-left: 3px solid transparent;
  }
  .subs a:hover {
    background: #ffffff0f;
    border-left-color: var(--color-primary);
  }
  .subs a.last {
    background: #ff8a7a1a;
    border-left-color: var(--color-primary);
  }
  .s-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: #ff8a7a;
  }
  .subs a.last .s-title {
    color: #ffb3a6;
  }
  .s-excerpt {
    font-size: 0.92rem;
    line-height: 1.6;
    color: #f4ece2;
  }
  .s-excerpt :global(mark),
  .s-title :global(mark) {
    background: #ff8a7a38;
    color: #ffb3a6;
    padding: 0 2px;
    border-radius: 2px;
    font-weight: 600;
  }
  .hs-hdr {
    position: relative;
    display: flex;
  }
  .hdr-btn {
    position: relative;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 1px solid var(--color-rule);
    border-radius: 50%;
    background: var(--color-surface);
    color: var(--color-ink);
    cursor: pointer;
    transition:
      color 0.15s,
      border-color 0.15s,
      background-color 0.15s;
  }
  .hdr-btn:hover,
  .hdr-btn.on {
    color: var(--color-primary);
    border-color: var(--color-primary);
    background: var(--color-primary-bg);
  }
  .hdr-btn:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  .hdr-btn svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
  .hdr-btn .dot {
    position: absolute;
    top: 1px;
    right: 1px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-surface);
  }
  .hs-drop {
    position: absolute;
    top: calc(100% + 16px);
    left: 0;
    width: min(640px, calc(100vw - 32px));
    max-height: calc(100vh - var(--header-h) - 24px);
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-radius: var(--radius-md);
    background: #1a1714;
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 18px 40px #0006;
    animation: hs-down 0.15s ease;
  }
  .hs-drop .hero-search {
    height: 54px;
    flex: none;
    padding-left: 18px;
    border-radius: var(--radius-md);
    box-shadow: none;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background: #ffffff0f;
  }
  .hs-drop .hs-submit {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-md);
  }
  .hs-drop .hero-search input {
    font-size: 1rem;
  }
  .hs-drop .hs-panel {
    position: static;
    min-height: 0;
    max-height: none;
    flex: 1 1 auto;
    box-shadow: none;
    border-radius: var(--radius-md);
    background: #ffffff05;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    animation: none;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
  @media (max-width: 760px) {
    .hero-search {
      gap: 4px;
      padding: 0 10px 0 18px;
      border-radius: var(--radius-md);
    }
    .hero-search input {
      font-size: 17px;
      padding: 0 6px;
    }
    .hs-submit {
      width: 44px;
      height: 44px;
    }
    .hs-field .hs-panel {
      right: -62px;
      max-height: 62vh;
    }
    .hdr-btn {
      width: 34px;
      height: 34px;
    }
    .hs-drop {
      position: fixed;
      top: var(--header-h);
      left: 8px;
      right: 8px;
      width: auto;
      margin-top: 6px;
      max-height: calc(100dvh - var(--header-h) - 20px);
    }
    .hs-drop .hero-search input {
      font-size: 17px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .hs-panel {
      animation: none;
    }
  }
</style>
