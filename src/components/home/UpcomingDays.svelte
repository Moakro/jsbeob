<script lang="ts">
  // 홈 '다가오는 날' — 40일 안의 기념일(달력 API)과 다음 절기를 가까운 순으로 4개.
  // 2026-11-16: 소식에 등록한 일정(달력 '일정', 진행 중이거나 40일 안에 시작)도 함께 보이고, 누르면 그 소식 글이 열린다.
  // 복원(2026-11-01): 배포본 클라이언트(_astro/UpcomingDays.*.js) 기준.
  import { onMount } from "svelte";
  import { computeOccurrence } from "../../lib/calendar-events";
  import { getJeolgiInfo } from "../../lib/date";
  import { postHref } from "../../lib/api";

  interface Item {
    key: string;
    title: string;
    date: Date;
    kind: "기념일" | "절기" | "일정";
    lunar: string | null;
    /** 일정: 끝나는 날(여러 날 일정) */
    end?: Date | null;
    /** 일정: 그 글 주소 */
    href?: string | null;
    /** 소식 글이면 소식 창으로 연다 */
    news?: boolean;
    /** 일정 블록 번호(소식 창에서 그 카드로 이동) */
    block?: string | null;
  }
  const ymdLocal = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const toDate = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

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
    // 소식에 등록한 일정 — 진행 중이면 '진행 중', 아니면 시작일 기준 D-n
    try {
      const to = new Date(today.getTime() + HORIZON_DAYS * 864e5);
      const r = await fetch(`/api/events?from=${ymdLocal(today)}&to=${ymdLocal(to)}`).then((res) => res.json());
      for (const ev of r?.events ?? []) {
        if (ev.is_annual || ev.category !== "일정" || !ev.source_post_id) continue;
        const start = toDate(ev.start_date);
        const end = ev.end_date ? toDate(ev.end_date) : null;
        if ((end ?? start) < today) continue;
        out.push({
          key: `ev:${ev.id}`,
          title: ev.title,
          date: start < today ? today : start,
          kind: "일정",
          lunar: null,
          end,
          href:
            postHref(ev.source_board || "news", ev.source_post_id, ev.source_category) +
            (ev.source_block_id ? `#b-${ev.source_block_id}` : ""),
          block: ev.source_block_id ?? null,
          news: !ev.source_board || ev.source_board === "news",
        });
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
        {@const ongoing = it.kind === "일정" && d === 0 && !!it.end && it.end > it.date}
        <li class:jeolgi={it.kind === "절기"} class:sched={it.kind === "일정"}>
          <span class="dd" class:today={d === 0}>{ongoing ? "진행 중" : d === 0 ? "오늘" : `D-${d}`}</span>
          {#if it.href}
            <a class="t" href={it.href} data-news-id={it.news ? it.href.split("#")[0].split("/").filter(Boolean).pop() : undefined}
              data-news-block={it.news ? it.block || undefined : undefined} title={it.title}>{it.title}</a>
          {:else}
            <strong class="t" title={it.title}>{it.title}</strong>
          {/if}
          {#if it.lunar}<small class="lu">{it.lunar.replace("음력 ", "음 ")}</small>{/if}
          <span class="dt"
            >{it.date.getMonth() + 1}.{it.date.getDate()}{#if it.end && it.end > it.date}~{it.end.getMonth() !== it.date.getMonth() ? `${it.end.getMonth() + 1}.` : ""}{it.end.getDate()}{:else}
              <small>{WEEKDAY[it.date.getDay()]}</small>{/if}</span
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
    /* 기념일·절기는 색을 채운 배지, 일정만 테두리형 — 달력과 같게 (2026-11-16 사용자 지시) */
    background: var(--color-primary);
    color: #fff;
    font-weight: 700;
    font-size: 0.76rem;
    font-variant-numeric: tabular-nums;
  }
  .dd.today {
    background: var(--color-primary);
    color: #fff;
  }
  li.jeolgi .dd {
    background: var(--color-secondary);
    color: #fff;
  }
  /* 소식 일정 — 소식 목록의 '일정' 배지와 같은 테두리형 색 */
  li.sched .dd {
    background: transparent;
    border: 1px solid var(--color-secondary);
    color: var(--color-secondary);
    padding: 1px 0;
  }
  a.t {
    color: var(--color-ink);
  }
  a.t:hover {
    color: var(--color-primary);
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
