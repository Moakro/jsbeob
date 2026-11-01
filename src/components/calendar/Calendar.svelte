<script lang="ts">
  // 달력 — 양력·음력·간지·절기·공휴일 + 일정(기념일·소식 일정). 선택한 날의 상세와 그달 기념일을 위에 보인다.
  // jsbooks 의 달력에서 출발해 jsbeob 에 맞게 고친 것(소식 일정 연동, jb:* 이벤트).
  // 복원(2026-11-01): 배포본 클라이언트(_astro/Calendar.*.js) 기준.
  import { onMount } from "svelte";
  import { NEWS_OPEN_EVENT } from "../../lib/api";
  import { getDayInfo, formatLunarKo } from "../../lib/date";
  import { holidayName } from "../../lib/holidays";
  import {
    type CalendarEvent,
    type OccurrenceEvent,
    expandOccurrences,
    monthRange,
    categoryBadgeClass,
    categoryFullLabel,
  } from "../../lib/calendar-events";

  interface Props {
    initialYear: number;
    initialMonth: number; // 1–12
  }

  const { initialYear, initialMonth }: Props = $props();

  let year = $state(initialYear);
  let month = $state(initialMonth);
  let today = $state<Date | null>(null);
  let selectedDate = $state<Date | null>(null);
  let monthEvents = $state<CalendarEvent[]>([]);

  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const YEAR_OPTIONS = Array.from({ length: 301 }, (_, i) => 1800 + i);
  const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

  onMount(() => {
    const now = new Date();
    today = now;
    // 빌드 시점 prop(initialYear/Month)은 정적 HTML 에 박혀 있으니 실제 오늘로 덮어쓴다.
    year = now.getFullYear();
    month = now.getMonth() + 1;
    // URL query 가 있으면 그게 우선 — 새로고침 후 같은 월 유지.
    const params = new URLSearchParams(location.search);
    const qy = Number(params.get("y"));
    const qm = Number(params.get("m"));
    if (Number.isInteger(qy) && qy >= 1800 && qy <= 2100) year = qy;
    if (Number.isInteger(qm) && qm >= 1 && qm <= 12) month = qm;
    selectedDate = startOfDay(now);

    const onUpdated = () => {
      fetchMonthEvents();
    };
    // 기념일 목록 등에서 날짜로 이동
    const onGoto = (e: Event) => {
      const m = (e as CustomEvent).detail?.date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) selectDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    };
    const onViewRequest = () => announceView();
    window.addEventListener("jb:events-updated", onUpdated);
    window.addEventListener("jb:calendar-goto", onGoto);
    window.addEventListener("jb:calendar-view-request", onViewRequest);
    return () => {
      window.removeEventListener("jb:events-updated", onUpdated);
      window.removeEventListener("jb:calendar-goto", onGoto);
      window.removeEventListener("jb:calendar-view-request", onViewRequest);
    };
  });

  $effect(() => {
    // year, month 가 바뀌면 셀 뱃지용 events 도 다시 조회.
    year;
    month;
    if (today !== null) fetchMonthEvents();
  });

  /** 보고 있는 연·월·선택일을 알린다(기념일 목록이 따라온다) */
  function announceView() {
    if (today === null) return;
    window.dispatchEvent(
      new CustomEvent("jb:calendar-view", {
        detail: { year, month, selected: selectedDate ? isoDate(selectedDate) : null },
      }),
    );
  }

  $effect(() => {
    year;
    month;
    selectedDate;
    announceView();
  });

  let reqSeq = 0;
  async function fetchMonthEvents() {
    const seq = ++reqSeq;
    try {
      const { from, to } = monthRange(year, month);
      const res = await fetch(`/api/events?from=${from}&to=${to}`, { credentials: "same-origin" });
      const data = res.ok ? ((await res.json()) as { events: CalendarEvent[] }) : { events: [] };
      // 늦게 온 이전 응답은 버린다
      if (seq === reqSeq) monthEvents = data.events ?? [];
    } catch {
      if (seq === reqSeq) monthEvents = [];
    }
  }

  /** 날짜(ISO) → 그날 일정. 기간 일정은 기간의 날마다(최대 62일) 넣는다. */
  const eventsByDate = $derived.by(() => {
    const map = new Map<string, OccurrenceEvent[]>();
    const add = (k: string, o: OccurrenceEvent) => {
      const list = map.get(k) ?? [];
      list.push(o);
      map.set(k, list);
    };
    for (const occ of expandOccurrences(monthEvents, year, month)) {
      if (occ.endOn && occ.endOn > occ.occursOn) {
        const [y, m, d] = occ.occursOn.split("-").map(Number);
        const cur = new Date(y, m - 1, d);
        for (let i = 0; i < 62; i++) {
          const k = isoDate(cur);
          if (k > occ.endOn) break;
          add(k, occ);
          cur.setDate(cur.getDate() + 1);
        }
      } else add(occ.occursOn, occ);
    }
    return map;
  });

  function isoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }

  /** 주소(?y=&m=)에 보고 있는 월을 남긴다 */
  function syncUrl(y: number, m: number) {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(location.search);
    sp.set("y", String(y));
    sp.set("m", String(m));
    history.replaceState(history.state, "", `${location.pathname}?${sp}`);
  }

  /** 월을 바꾸면 선택일은 오늘(그 달이면) 또는 1일 */
  function resetSelection() {
    if (today && today.getFullYear() === year && today.getMonth() + 1 === month)
      selectedDate = startOfDay(today);
    else selectedDate = new Date(year, month - 1, 1);
  }

  function shiftMonth(delta: number) {
    let m = month + delta;
    let y = year;
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    while (m > 12) {
      m -= 12;
      y += 1;
    }
    year = y;
    month = m;
    resetSelection();
    syncUrl(y, m);
  }

  function shiftYear(delta: number) {
    year = year + delta;
    resetSelection();
    syncUrl(year, month);
  }

  function pickYear(y: number) {
    year = y;
    resetSelection();
    syncUrl(year, month);
  }

  function pickMonth(m: number) {
    month = m;
    resetSelection();
    syncUrl(year, month);
  }

  function goToday() {
    const now = new Date();
    today = now;
    year = now.getFullYear();
    month = now.getMonth() + 1;
    selectedDate = startOfDay(now);
    syncUrl(year, month);
  }

  function selectDate(d: Date) {
    selectedDate = startOfDay(d);
    if (d.getFullYear() !== year || d.getMonth() + 1 !== month) {
      year = d.getFullYear();
      month = d.getMonth() + 1;
      syncUrl(year, month);
    }
  }

  function startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function sameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
    );
  }

  /** "丁酉年 丙午月 戊子日" → "戊子" */
  function chineseDayOf(gapja: string | undefined): string | null {
    return gapja ? (gapja.split(" ")[2]?.replace(/日$/, "") ?? null) : null;
  }

  function lunarShort(m: number, d: number, leap: boolean): string {
    return `${m}.${d}${leap ? "(윤)" : ""}`;
  }

  /** 6주(42칸) 달력 */
  const cells = $derived.by(() => {
    const firstDow = new Date(year, month - 1, 1).getDay();
    const start = new Date(year, month - 1, 1 - firstDow);
    const out = [];
    for (let i = 0; i < 42; i++) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const info = getDayInfo(date);
      const key = isoDate(date);
      out.push({
        date,
        day: date.getDate(),
        inMonth: date.getMonth() === month - 1,
        isToday: today ? sameDay(date, today) : false,
        isSelected: selectedDate ? sameDay(date, selectedDate) : false,
        dow: date.getDay(),
        lunarShort: info.lunar
          ? lunarShort(info.lunar.month, info.lunar.day, info.lunar.intercalation)
          : null,
        chineseDay: chineseDayOf(info.lunar?.chinese_gapja),
        jeolgiName: info.jeolgi.daysSince === 0 ? info.jeolgi.current.name : null,
        jeolgiHanja: info.jeolgi.daysSince === 0 ? info.jeolgi.current.hanja : null,
        holiday: holidayName(
          date.getMonth() + 1,
          date.getDate(),
          info.lunar?.month ?? null,
          info.lunar?.day ?? null,
        ),
        events: eventsByDate.get(key) ?? [],
      });
    }
    return out;
  });

  /** 선택한 날 상세 */
  const detail = $derived.by(() => {
    if (!selectedDate) return null;
    const info = getDayInfo(selectedDate);
    const gapja = info.lunar
      ? info.lunar.chinese_gapja.replace(/年/g, "년").replace(/月/g, "월").replace(/日/g, "일")
      : null;
    return {
      solar: info.solar.ymd,
      weekday: WEEKDAYS[selectedDate.getDay()],
      lunar: info.lunar ? formatLunarKo(info.lunar) : null,
      gapja,
      jeolgi:
        info.jeolgi.daysSince === 0
          ? { name: info.jeolgi.current.name, hanja: info.jeolgi.current.hanja }
          : null,
      holiday: holidayName(
        selectedDate.getMonth() + 1,
        selectedDate.getDate(),
        info.lunar?.month ?? null,
        info.lunar?.day ?? null,
      ),
      isToday: !!today && sameDay(selectedDate, today),
    };
  });

  /** 그달 기념일(상세 상자 아래) */
  const monthAnniversaries = $derived(
    expandOccurrences(
      monthEvents.filter((e) => e.category === "기념일"),
      year,
      month,
    ).sort((a, b) => (a.occursOn < b.occursOn ? -1 : a.occursOn > b.occursOn ? 1 : 0)),
  );
  const todayIso = $derived(today ? isoDate(today) : "");
  const selectedIsToday = $derived(!!today && !!selectedDate && sameDay(selectedDate, today));

  const openNews = (id: string) => window.dispatchEvent(new CustomEvent(NEWS_OPEN_EVENT, { detail: { id } }));
</script>

<div class="calendar">
  <div class="nav" role="toolbar" aria-label="달력 탐색">
    <div class="nav-group">
      <button type="button" class="step" aria-label="이전 년" onclick={() => shiftYear(-1)}>‹</button>
      <span class="label-wrap year-label">
        <span class="label-text">{year}년</span>
        <select aria-label="년 선택" value={year} onchange={(e) => pickYear(Number(e.currentTarget.value))}>
          {#each YEAR_OPTIONS as y}
            <option value={y}>{y}년</option>
          {/each}
        </select>
      </span>
      <button type="button" class="step" aria-label="다음 년" onclick={() => shiftYear(1)}>›</button>
    </div>
    <button type="button" class="today-btn" class:active={selectedIsToday} onclick={goToday}>오늘</button>
    <div class="nav-group">
      <button type="button" class="step" aria-label="이전 월" onclick={() => shiftMonth(-1)}>‹</button>
      <span class="label-wrap month-label">
        <span class="label-text">{month}월</span>
        <select aria-label="월 선택" value={month} onchange={(e) => pickMonth(Number(e.currentTarget.value))}>
          {#each MONTH_OPTIONS as m}
            <option value={m}>{m}월</option>
          {/each}
        </select>
      </span>
      <button type="button" class="step" aria-label="다음 월" onclick={() => shiftMonth(1)}>›</button>
    </div>
  </div>

  {#if detail}
    <div class="detail-box" class:is-today={detail.isToday}>
      <div class="detail-line primary">
        <span class="d-solar">{detail.solar}</span>
        <span class="d-weekday">({detail.weekday})</span>
        {#if detail.lunar}<span class="dot" aria-hidden="true">·</span>
          <span class="d-lunar">{detail.lunar}</span>{/if}
        {#if detail.jeolgi}<span class="d-jeolgi" title={detail.jeolgi.hanja}>{detail.jeolgi.name}</span>{/if}
        {#if detail.holiday}<span class="d-holiday">{detail.holiday}</span>{/if}
      </div>
      {#if detail.gapja}<div class="detail-line gapja">{detail.gapja}</div>{/if}
      {#if monthAnniversaries.length > 0}
        <div class="detail-events">
          {#each monthAnniversaries as occ (occ.source.id + "@" + occ.occursOn)}
            {@const isToday = occ.occursOn === todayIso}
            {@const linked = !!occ.source.source_post_id}
            <!-- 소식 글에서 온 일정은 눌러서 소식을 연다 -->
            <svelte:element
              this={linked ? "button" : "span"}
              type={linked ? "button" : undefined}
              role={linked ? undefined : "note"}
              class={`ev-pill ${categoryBadgeClass(occ.source.category)}`}
              class:linked
              class:today={isToday}
              onclick={linked ? () => openNews(occ.source.source_post_id!) : undefined}
              title={`${categoryFullLabel(occ.source.category)} · ${occ.source.title} · ${occ.occursOn}${isToday ? " (오늘)" : ""}`}
            >
              {#if isToday}
                <span class="ev-check" aria-label="오늘"
                  ><svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"
                    ><path
                      d="M5 12.5l4.5 4.5L19 7.5"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.4"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    ></path></svg
                  ></span
                >
              {/if}
              <span class="ev-title">{occ.source.title}</span>
              {#if linked}<span class="ev-go" aria-hidden="true">›</span>{/if}
            </svelte:element>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <div class="grid-scroll">
    <div class="month-grid">
      <div class="weekday-row" aria-hidden="true">
        {#each WEEKDAYS as w, i}
          <div class="weekday" class:sun={i === 0} class:sat={i === 6}>{w}</div>
        {/each}
      </div>
      <div class="days" role="grid" aria-label={`${year}년 ${month}월 달력`}>
        {#each cells as c (c.date.getTime())}
          <button
            type="button"
            class="cell"
            class:out={!c.inMonth}
            class:today={c.isToday}
            class:selected={c.isSelected}
            class:sun={c.dow === 0}
            class:sat={c.dow === 6}
            onclick={(e) => {
              // 칸 안의 소식 일정을 누르면 소식을 연다
              const id = (e.target as HTMLElement).closest<HTMLElement>("[data-news-post]")?.dataset.newsPost;
              if (id) openNews(id);
              else selectDate(c.date);
            }}
          >
            <div class="cell-head">
              <span class="solar">{c.day}</span>
              {#if c.chineseDay}<span class="chinese-day">{c.chineseDay}</span>{/if}
            </div>
            {#if c.lunarShort}<span class="lunar">{c.lunarShort}</span>{/if}
            {#if c.jeolgiName}<span class="jeolgi" title={c.jeolgiHanja ?? ""}>{c.jeolgiName}</span>{/if}
            {#if c.holiday}<span class="holiday">{c.holiday}</span>{/if}
            {#if c.events.length > 0}
              <div class="ev-titles" aria-label={`일정 ${c.events.length}건`}>
                {#each c.events.slice(0, 2) as occ (occ.source.id + "@" + occ.occursOn)}
                  <span
                    class={`ev-title-pill ${categoryBadgeClass(occ.source.category)}`}
                    class:linked={!!occ.source.source_post_id}
                    data-news-post={occ.source.source_post_id || undefined}
                    title={`${categoryFullLabel(occ.source.category)} · ${occ.source.title}${occ.source.source_post_id ? " — 눌러서 소식 보기" : ""}`}
                    >{occ.source.title}</span
                  >
                {/each}
                {#if c.events.length > 2}<span class="ev-more">+{c.events.length - 2}</span>{/if}
              </div>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .calendar {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    flex-wrap: nowrap;
  }
  .nav-group {
    display: inline-flex;
    align-items: center;
    gap: 0.1rem;
    background: var(--color-surface, #fff);
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 999px;
    padding: 0.15rem 0.25rem;
    flex-shrink: 0;
  }
  .step {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.6rem;
    height: 1.6rem;
    padding: 0 0.35rem;
    background: transparent;
    border: none;
    border-radius: 999px;
    color: var(--color-fg, #1f1c1a);
    font-size: 1rem;
    cursor: pointer;
    line-height: 1;
  }
  .step:hover {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 8%, transparent);
    color: var(--color-primary, #a8352a);
  }
  .label-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 0.45rem;
    min-width: 3.5rem;
    height: 1.6rem;
    border-radius: 999px;
    cursor: pointer;
  }
  .label-wrap:hover {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 6%, transparent);
  }
  .label-wrap.year-label {
    min-width: 4.2rem;
  }
  .label-text {
    font-weight: 600;
    color: var(--color-fg, #1f1c1a);
    pointer-events: none;
  }
  .label-wrap select {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
    border: none;
    background: transparent;
    font: inherit;
    color: inherit;
  }
  .today-btn {
    padding: 0.25rem 0.85rem;
    background: var(--color-surface, #fff);
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 999px;
    color: var(--color-fg, #1f1c1a);
    font-size: 0.88rem;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
  }
  .today-btn:hover {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 10%, transparent);
    color: var(--color-primary, #a8352a);
    border-color: color-mix(in srgb, var(--color-primary, #a8352a) 30%, var(--color-rule, #e8dfd9));
  }
  .today-btn.active {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 14%, var(--color-surface, #fff));
    color: var(--color-primary, #a8352a);
    border-color: color-mix(in srgb, var(--color-primary, #a8352a) 45%, var(--color-rule, #e8dfd9));
  }
  .detail-box {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.65rem 0.9rem;
    background: color-mix(in srgb, var(--color-muted, #8a807a) 8%, var(--color-surface, #fff));
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: var(--radius-md, 8px);
    font-size: 0.92rem;
  }
  .detail-box.is-today {
    background: color-mix(in srgb, var(--color-gold-soft, #d8af4a) 16%, var(--color-surface, #fff));
    border-color: color-mix(in srgb, var(--color-gold-soft, #d8af4a) 55%, var(--color-rule, #e8dfd9));
    box-shadow: inset 3px 0 0 var(--color-gold-soft, #d8af4a);
  }
  .detail-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35rem;
  }
  .d-solar {
    font-weight: 700;
    color: var(--color-fg, #1f1c1a);
  }
  .detail-box.is-today .d-solar {
    color: #6e4a00;
  }
  .d-weekday {
    color: var(--color-muted, #8a807a);
  }
  .detail-box.is-today .d-weekday {
    color: #8a6310;
  }
  .d-lunar {
    color: var(--color-fg, #1f1c1a);
  }
  .detail-box.is-today .d-lunar {
    color: #6e4a00;
  }
  .d-jeolgi {
    margin-left: 0.35rem;
    padding: 0.08rem 0.5rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary, #a8352a) 14%, transparent);
    color: var(--color-primary, #a8352a);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .detail-box.is-today .d-jeolgi {
    background: #a8352a2e;
    color: #8b2a20;
  }
  .d-holiday {
    margin-left: 0.35rem;
    padding: 0.08rem 0.5rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-secondary, #1e6e6e) 14%, transparent);
    color: var(--color-secondary, #1e6e6e);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .detail-box.is-today .d-holiday {
    background: #1e6e6e2e;
    color: #16585a;
  }
  .gapja {
    color: var(--color-muted, #8a807a);
    letter-spacing: 0.02em;
    font-size: 0.86rem;
  }
  .detail-box.is-today .gapja {
    color: #7c5410;
  }
  .dot {
    color: var(--color-muted, #8a807a);
    opacity: 0.6;
  }
  .grid-scroll {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    border-radius: var(--radius-md, 8px);
  }
  .month-grid {
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: var(--radius-md, 8px);
    overflow: hidden;
    background: var(--color-surface, #fff);
    min-width: 360px;
  }
  .weekday-row,
  .days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
  }
  .weekday-row {
    border-bottom: 1px solid var(--color-rule, #e8dfd9);
    background: var(--color-bg, #fbf8f4);
  }
  .weekday {
    padding: 0.5rem 0;
    text-align: center;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--color-muted, #8a807a);
  }
  .weekday.sun {
    color: var(--color-primary, #a8352a);
  }
  .weekday.sat {
    color: #3a6ea5;
  }
  .cell {
    all: unset;
    box-sizing: border-box;
    min-height: 88px;
    padding: 0.4rem 0.45rem 0.5rem;
    border-right: 1px solid var(--color-rule, #e8dfd9);
    border-bottom: 1px solid var(--color-rule, #e8dfd9);
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
    position: relative;
    cursor: pointer;
    background: var(--color-surface, #fff);
    overflow: hidden;
    min-width: 0;
  }
  .cell:focus-visible {
    outline: 2px solid var(--color-primary, #a8352a);
    outline-offset: -2px;
  }
  .cell:hover {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 4%, var(--color-surface, #fff));
  }
  .cell:nth-child(7n) {
    border-right: none;
  }
  .cell.out {
    background: color-mix(in srgb, var(--color-bg, #fbf8f4) 60%, var(--color-surface, #fff));
    color: var(--color-muted, #8a807a);
  }
  .cell.today {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 8%, transparent);
    box-shadow: inset 0 0 0 2px var(--color-primary, #a8352a);
  }
  .cell.selected:not(.today) {
    box-shadow: inset 0 0 0 2px var(--color-secondary, #1e6e6e);
  }
  .cell-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.3rem;
  }
  .solar {
    font-size: 0.92rem;
    font-weight: 700;
    color: var(--color-fg, #1f1c1a);
    line-height: 1.1;
  }
  .cell.out .solar {
    color: color-mix(in srgb, var(--color-muted, #8a807a) 80%, transparent);
    font-weight: 600;
  }
  .cell.sun:not(.out) .solar {
    color: var(--color-primary, #a8352a);
  }
  .cell.sat:not(.out) .solar {
    color: #3a6ea5;
  }
  .chinese-day {
    font-size: 0.7rem;
    color: var(--color-muted, #8a807a);
    letter-spacing: 0.03em;
    white-space: nowrap;
  }
  .cell.out .chinese-day {
    opacity: 0.6;
  }
  .lunar {
    font-size: 0.72rem;
    color: var(--color-muted, #8a807a);
    line-height: 1.1;
  }
  .cell.out .lunar {
    opacity: 0.7;
  }
  .jeolgi {
    align-self: flex-start;
    margin-top: 0.15rem;
    padding: 0.08rem 0.45rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary, #a8352a) 14%, transparent);
    color: var(--color-primary, #a8352a);
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cell.out .jeolgi {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 8%, transparent);
    color: color-mix(in srgb, var(--color-primary, #a8352a) 65%, var(--color-muted, #8a807a));
  }
  .holiday {
    align-self: flex-start;
    margin-top: 0.15rem;
    padding: 0.08rem 0.45rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-secondary, #1e6e6e) 14%, transparent);
    color: var(--color-secondary, #1e6e6e);
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cell.out .holiday {
    background: color-mix(in srgb, var(--color-secondary, #1e6e6e) 8%, transparent);
    color: color-mix(in srgb, var(--color-secondary, #1e6e6e) 65%, var(--color-muted, #8a807a));
  }
  .ev-titles {
    margin-top: auto;
    padding-top: 0.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .ev-title-pill {
    display: block;
    width: 100%;
    padding: 0.05rem 0.32rem;
    border-radius: var(--radius-sm);
    font-size: 0.64rem;
    font-weight: 600;
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: 0.01em;
  }
  .cell.out .ev-title-pill {
    opacity: 0.6;
  }
  .ev-more {
    align-self: flex-start;
    padding: 0 0.2rem;
    font-size: 0.6rem;
    color: var(--color-muted, #8a807a);
    line-height: 1.2;
  }
  .detail-events {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
    margin-top: 0.15rem;
    padding-top: 0.45rem;
    border-top: 1px dashed color-mix(in srgb, var(--color-rule, #e8dfd9) 80%, transparent);
  }
  .ev-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.18rem 0.6rem;
    border-radius: 999px;
    font-size: 0.82rem;
    line-height: 1.3;
    max-width: 100%;
  }
  .ev-pill.today {
    box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--color-fg, #1f1c1a) 30%, transparent);
  }
  .ev-pill .ev-check {
    display: inline-flex;
    align-items: center;
    color: inherit;
    flex-shrink: 0;
  }
  .ev-title-pill.linked {
    cursor: pointer;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
  }
  button.ev-pill {
    border: 0;
    font: inherit;
    cursor: pointer;
  }
  button.ev-pill:hover {
    filter: brightness(1.08);
  }
  .ev-go {
    margin-left: -2px;
    font-weight: 700;
  }
  .ev-pill .ev-title {
    font-weight: 600;
  }
  .cat-anniversary {
    background: var(--color-primary, #a8352a);
    color: #fff;
  }
  .cat-plan {
    background: var(--color-secondary, #1e6e6e);
    color: #fff;
  }
  .cat-other {
    background: color-mix(in srgb, var(--color-muted, #8a807a) 30%, #fff);
    color: #1f1c1a;
  }
  @media (max-width: 600px) {
    .nav {
      gap: 0.35rem;
    }
    .nav-group {
      padding: 0.1rem 0.2rem;
    }
    .step {
      min-width: 1.4rem;
      height: 1.4rem;
      font-size: 0.9rem;
      padding: 0 0.25rem;
    }
    .label-wrap {
      padding: 0 0.3rem;
      min-width: 3rem;
      height: 1.4rem;
      font-size: 0.88rem;
    }
    .label-wrap.year-label {
      min-width: 3.6rem;
    }
    .today-btn {
      padding: 0.2rem 0.6rem;
      font-size: 0.82rem;
    }
    .detail-box {
      font-size: 0.86rem;
      padding: 0.55rem 0.7rem;
    }
    .gapja {
      font-size: 0.8rem;
    }
    .grid-scroll {
      margin-inline: calc(-1 * var(--gutter, 16px));
      border-radius: 0;
    }
    .month-grid {
      min-width: 320px;
      border-inline: 0;
      border-radius: 0;
    }
    .cell {
      min-height: 70px;
      padding: 0.28rem 0.3rem 0.36rem;
    }
    .cell-head {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.05rem;
    }
    .solar {
      font-size: 0.82rem;
    }
    .chinese-day {
      font-size: 0.6rem;
      letter-spacing: 0.02em;
    }
    .lunar {
      font-size: 0.62rem;
    }
    .jeolgi,
    .holiday {
      font-size: 0.58rem;
      padding: 0.03rem 0.32rem;
    }
    .ev-title-pill {
      font-size: 0.58rem;
      padding: 0.03rem 0.24rem;
    }
    .ev-more {
      font-size: 0.54rem;
    }
    .ev-pill {
      font-size: 0.72rem;
      padding: 0.08rem 0.4rem;
    }
  }
</style>
