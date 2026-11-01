<script lang="ts">
  // 홈 '다가오는 날' — 40일 안의 기념일(달력 API)과 다음 절기를 가까운 순으로 4개.
  // 복원(2026-11-01): 배포본 클라이언트(_astro/UpcomingDays.*.js) 기준.
  import { onMount } from "svelte";
  import { computeOccurrence } from "../../lib/calendar-events";
  import { getJeolgiInfo } from "../../lib/date";

  interface Item {
    key: string;
    title: string;
    date: Date;
    kind: "기념일" | "절기";
    lunar: string | null;
  }

  let items = $state<Item[] | null>(null);
  const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
  const HORIZON_DAYS = 40;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const daysFromToday = (d: Date) =>
    Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 864e5);

  onMount(async () => {
    const today = startOfDay(new Date());
    const year = today.getFullYear();
    const out: Item[] = [];
    try {
      const r = await fetch(`/api/events?category=${encodeURIComponent("기념일")}`).then((res) => res.json());
      for (const ev of r?.events ?? []) {
        // 올해 남은 날이 없으면 내년
        for (const y of [year, year + 1]) {
          const occ = computeOccurrence(ev, y);
          if (!occ) continue;
          const [yy, mm, dd] = occ.occursOn.split("-").map(Number);
          const date = new Date(yy, mm - 1, dd);
          if (date < today) continue;
          const [, lm, ld] = ev.start_date.split("-").map(Number);
          out.push({
            key: `${ev.id}:${y}`,
            title: ev.title,
            date,
            kind: "기념일",
            lunar: ev.is_lunar ? `음력 ${lm}.${ld}` : null,
          });
          break;
        }
      }
    } catch {}
    const jeolgi = getJeolgiInfo(new Date());
    out.push({
      key: `jeolgi:${jeolgi.next.name}`,
      title: `${jeolgi.next.name}(${jeolgi.next.hanja})`,
      date: jeolgi.next.date,
      kind: "절기",
      lunar: null,
    });
    out.sort((a, b) => a.date.getTime() - b.date.getTime());
    items = out.filter((i) => daysFromToday(i.date) <= HORIZON_DAYS).slice(0, 4);
  });
</script>

<section class="side-box up">
  <div class="side-head">
    <h3>다가오는 날</h3>
    <a href="/calendar/">달력 →</a>
  </div>
  {#if items === null}
    <p class="dim">불러오는 중…</p>
  {:else if !items.length}
    <p class="dim">다가오는 기념일이 없습니다.</p>
  {:else}
    <ul>
      {#each items as it (it.key)}
        {@const d = daysFromToday(it.date)}
        <li class:jeolgi={it.kind === "절기"}>
          <span class="dd" class:today={d === 0}>{d === 0 ? "오늘" : `D-${d}`}</span>
          <strong class="t" title={it.title}>{it.title}</strong>
          {#if it.lunar}<small class="lu">{it.lunar.replace("음력 ", "음 ")}</small>{/if}
          <span class="dt"
            >{it.date.getMonth() + 1}.{it.date.getDate()} <small>{WEEKDAY[it.date.getDay()]}</small></span
          >
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .up :global(.side-head) {
    margin-bottom: 4px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 40px;
    border-bottom: 1px solid var(--color-rule);
  }
  li:last-child {
    border-bottom: 0;
  }
  .dd {
    flex: none;
    min-width: 46px;
    padding: 2px 0;
    text-align: center;
    border-radius: 999px;
    background: var(--color-primary-bg);
    color: var(--color-primary);
    font-weight: 700;
    font-size: 0.76rem;
    font-variant-numeric: tabular-nums;
  }
  .dd.today {
    background: var(--color-primary);
    color: #fff;
  }
  li.jeolgi .dd {
    background: var(--color-secondary-bg);
    color: var(--color-secondary);
  }
  .t {
    flex: 1;
    min-width: 0;
    font-size: 0.93rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lu {
    flex: none;
    color: var(--color-muted);
    font-size: 0.74rem;
  }
  .dt {
    flex: none;
    min-width: 52px;
    text-align: right;
    font-size: 0.86rem;
    font-variant-numeric: tabular-nums;
    color: var(--color-fg);
  }
  .dt small {
    color: var(--color-muted);
    font-size: 0.74rem;
  }
  .dim {
    margin: 0;
    color: var(--color-muted);
    font-size: 0.9rem;
  }
</style>
