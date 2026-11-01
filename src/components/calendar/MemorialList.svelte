<script lang="ts">
  // 법종교 기념일 목록 — 올해 날짜순. 누르면 달력에서 그날로. 편집 권한이 있으면 추가·수정.
  // 복원(2026-11-01): 배포본 클라이언트(_astro/MemorialList.*.js) 기준.
  import { onMount } from "svelte";
  import type { CalendarEvent } from "../../lib/calendar-events";
  import { lunarToSolar } from "../../lib/date";
  import EventModal from "./EventModal.svelte";

  const STEMS = "甲乙丙丁戊己庚辛壬癸";
  const BRANCHES = "子丑寅卯辰巳午未申酉戌亥";
  /** 연도 → 간지 (1984 = 甲子) */
  const ganji = (y: number) => STEMS[(((y - 4) % 10) + 10) % 10] + BRANCHES[(((y - 4) % 12) + 12) % 12];
  const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

  let events = $state<CalendarEvent[]>([]);
  let canEdit = $state(false);
  let loading = $state(true);
  let failed = $state(false);
  let modalOpen = $state(false);
  let editing = $state<CalendarEvent | null>(null);
  /** 달력에서 고른 기념일 날짜 */
  let active = $state<string | null>(null);
  /** 달력이 보고 있는 월(YYYY-MM) */
  let viewMonth = $state<string | null>(null);

  const thisYear = new Date().getFullYear();
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  /** 올해의 양력 날짜 */
  function dateThisYear(ev: CalendarEvent): Date | null {
    const [y, m, d] = ev.start_date.split("-").map(Number);
    if (!y || !m || !d) return null;
    const year = ev.is_annual === 1 ? thisYear : y;
    return ev.is_lunar === 1 ? lunarToSolar(year, m, d, false) : new Date(year, m - 1, d);
  }

  const rows = $derived(
    events
      .map((ev) => {
        const date = dateThisYear(ev);
        const [y, m, d] = ev.start_date.split("-").map(Number);
        return {
          ev,
          date,
          iso: date ? iso(date) : "",
          lunar: ev.is_lunar === 1 ? `${m}.${d}` : null,
          since: ev.is_annual === 1 && y ? `${y}(${ganji(y)})` : null,
        };
      })
      .sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0)),
  );

  async function load() {
    try {
      const res = await fetch(`/api/events?category=${encodeURIComponent("기념일")}`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      events = data.events ?? [];
      canEdit = !!data.can_edit;
      failed = false;
    } catch {
      failed = true;
    } finally {
      loading = false;
    }
  }

  function goto(r: (typeof rows)[number]) {
    if (!r.iso) return;
    active = r.iso;
    window.dispatchEvent(new CustomEvent("jb:calendar-goto", { detail: { date: r.iso } }));
  }

  function add() {
    editing = null;
    modalOpen = true;
  }

  function edit(ev: CalendarEvent) {
    editing = ev;
    modalOpen = true;
  }

  function saved() {
    load();
    window.dispatchEvent(new CustomEvent("jb:events-updated"));
  }

  onMount(() => {
    load();
    const onUpdated = () => load();
    const onView = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d) return;
      viewMonth = `${d.year}-${pad(d.month)}`;
      // 달력에서 다른 날을 고르면 강조를 푼다
      if (active && d.selected !== active) active = null;
    };
    window.addEventListener("jb:events-updated", onUpdated);
    window.addEventListener("jb:calendar-view", onView);
    window.dispatchEvent(new CustomEvent("jb:calendar-view-request"));
    return () => {
      window.removeEventListener("jb:events-updated", onUpdated);
      window.removeEventListener("jb:calendar-view", onView);
    };
  });
</script>

<div class="ml">
  <div class="ml-head">
    <h2>법종교 기념일</h2>
    {#if canEdit}
      <button type="button" class="ml-add" onclick={add}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg> 일정 추가
      </button>
    {/if}
  </div>
  {#if loading}
    <p class="ml-empty">불러오는 중…</p>
  {:else if failed}
    <p class="ml-empty">기념일을 불러오지 못했습니다.</p>
  {:else if rows.length}
    <ul class="ml-list">
      {#each rows as r (r.ev.id)}
        <li
          class:active={r.iso && r.iso === active}
          class:in-month={!!viewMonth && r.iso.startsWith(viewMonth)}
          class:has-meta={!!(r.lunar || r.since)}
          class:editable={canEdit}
        >
          <button type="button" class="ml-row" title="달력에서 보기" onclick={() => goto(r)}>
            <span class="ml-date">
              {#if r.date}{r.date.getMonth() + 1}.{r.date.getDate()}
                <small>({WEEKDAY[r.date.getDay()]})</small>{/if}
            </span>
            <span class="ml-title">
              {#if r.lunar || r.since}
                <span class="ml-meta">
                  {#if r.lunar}<em class="ml-lunar">(음) {r.lunar}</em>{/if}
                  {#if r.since}<span class="ml-since" title="시작년도">{r.since}</span>{/if}
                </span>
              {/if}
              <span class="ml-name">{r.ev.title}</span>
            </span>
          </button>
          {#if canEdit}
            <button
              type="button"
              class="ml-edit"
              title="수정"
              aria-label={`${r.ev.title} 수정`}
              onclick={() => edit(r.ev)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"
                ><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"></path></svg
              >
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="ml-empty">등록된 기념일이 없습니다.</p>
  {/if}
</div>
{#if canEdit}
  <EventModal bind:open={modalOpen} event={editing} onClose={() => (editing = null)} onSaved={saved} />
{/if}

<style>
  .ml-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
  }
  .ml-head h2 {
    margin: 0;
    font-size: 1.05rem;
  }
  .ml-add {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 5px 10px 5px 7px;
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-primary);
    font: inherit;
    font-size: 0.8rem;
    font-weight: 700;
    cursor: pointer;
  }
  .ml-add:hover {
    background: var(--color-primary);
    color: #fff;
  }
  .ml-add svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
  }
  .ml-empty {
    margin: 6px 0 0;
    font-size: 0.86rem;
    color: var(--color-muted);
  }
  .ml-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .ml-list li {
    position: relative;
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--color-rule);
  }
  .ml-list li:last-child {
    border-bottom: 0;
  }
  .ml-list li.in-month {
    border-bottom-color: transparent;
  }
  .ml-list li.in-month:after {
    content: "";
    position: absolute;
    inset: 0;
    border: 1.5px solid color-mix(in srgb, var(--color-primary) 60%, transparent);
    border-radius: var(--radius-md);
    pointer-events: none;
  }
  .ml-row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 8px 4px;
    border: 0;
    background: transparent;
    font: inherit;
    text-align: left;
    color: var(--color-ink);
    cursor: pointer;
    border-radius: var(--radius-md);
  }
  .ml-row:hover,
  .ml-list li.active .ml-row {
    background: var(--color-primary-bg);
  }
  .ml-row:focus-visible,
  .ml-edit:focus-visible,
  .ml-add:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 1px;
  }
  .ml-date {
    flex: none;
    min-width: 58px;
    font-size: 0.86rem;
    font-weight: 700;
    color: var(--color-fg);
    font-variant-numeric: tabular-nums;
  }
  .ml-date small {
    margin-left: 1px;
    font-size: 0.74rem;
    font-weight: 500;
    color: var(--color-muted);
  }
  .ml-title {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-size: 0.9rem;
    line-height: 1.4;
  }
  .ml-meta {
    display: flex;
    align-items: baseline;
    column-gap: 4px;
    white-space: nowrap;
  }
  .ml-lunar {
    font-style: normal;
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--color-primary);
    white-space: nowrap;
  }
  .ml-since {
    font-size: 0.74rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: #3a6ea5;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  @media (max-width: 900px) {
    .ml-title {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: baseline;
      column-gap: 6px;
    }
  }
  @media (min-width: 901px) {
    .ml-list li .ml-edit {
      position: absolute;
      top: 7px;
      right: 0;
      height: 22px;
    }
    .ml-list li.editable:not(.has-meta) .ml-row {
      padding-right: 30px;
    }
  }
  .ml-edit {
    flex: none;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-faint);
    cursor: pointer;
  }
  .ml-edit:hover {
    background: var(--color-surface-2);
    color: var(--color-primary);
  }
  .ml-edit svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linejoin: round;
  }
</style>
