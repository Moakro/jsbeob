<script lang="ts">
  // 관리자 — 지부·분원 (2026-11-06 신설).
  //   code 없음 → 목록(분류별, ↑↓ 순서, 좌표 일괄 채우기) / code 있음("new" 는 null) → 편집 폼.
  // 주소: 카카오 우편번호 검색 → 좌표 자동(카카오 지도 SDK) → 지도에서 위치 미세 조정(PointLocationPicker).
  // 저장하면 API 가 지도 장소(지부·분원 버튼)를 함께 맞춘다.
  import { onMount } from "svelte";
  import { adminApi } from "../../lib/blocks";
  import { confirmDialog } from "../../lib/confirm";
  import { formatPhone } from "../../lib/phone";
  import { pickAddress, geocode } from "../../lib/address";
  import { hasKakaoKey } from "../../lib/kakao-maps";
  import MediaLibrary from "../MediaLibrary.svelte";
  import PointLocationPicker from "../PointLocationPicker.svelte";

  // code: undefined = 목록, null = 새로 만들기, 문자열 = 편집
  let { code = undefined }: { code?: string | null } = $props();
  const isList = code === undefined;

  const STATUS: Record<string, string> = { published: "공개", draft: "작성 중", hidden: "숨김" };
  const KINDS = ["지부", "분원"] as const;

  // ── 목록
  let items = $state<any[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let note = $state<string | null>(null);
  let filling = $state(false);

  const groups = $derived(KINDS.map((k) => ({ kind: k, items: items.filter((b) => b.kind === k) })));
  const missingCoord = $derived(items.filter((b) => b.address && (b.lat == null || b.lng == null)));

  async function loadList() {
    try {
      items = (await adminApi.listBranches()).items;
    } catch (e) {
      error = e instanceof Error ? e.message : "불러오기 실패";
    } finally {
      loading = false;
    }
  }

  async function move(code: string, d: number) {
    const i = items.findIndex((b) => b.code === code);
    const j = i + d;
    if (i < 0 || j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    items = next;
    note = null;
    try {
      items = (await adminApi.orderBranches(next.map((b) => b.code))).items;
      note = "순서를 저장했습니다.";
    } catch (e) {
      note = e instanceof Error ? e.message : "순서를 저장하지 못했습니다";
      await loadList();
    }
  }

  /** 주소는 있는데 좌표가 없는 곳을 카카오 지도로 찾아 저장 */
  async function fillCoords() {
    filling = true;
    note = null;
    let ok = 0;
    const failed: string[] = [];
    try {
      for (const b of missingCoord) {
        const c = await geocode(b.address);
        if (!c) {
          failed.push(b.name);
          continue;
        }
        await adminApi.updateBranch(b.code, { ...toInput(b), lat: c.lat, lng: c.lng });
        ok++;
      }
      note = `좌표 ${ok}곳을 채웠습니다.` + (failed.length ? ` 못 찾음: ${failed.join(", ")} — 편집에서 지도로 정해 주세요.` : "");
    } catch (e) {
      note = e instanceof Error ? e.message : "좌표를 찾지 못했습니다";
    } finally {
      filling = false;
      await loadList();
    }
  }

  const toInput = (b: any) => ({
    kind: b.kind,
    name: b.name,
    head_name: b.head_name,
    phone: b.phone,
    postcode: b.postcode,
    address: b.address,
    address_detail: b.address_detail,
    lat: b.lat,
    lng: b.lng,
    photo_media_id: b.photo?.id ?? null,
    sort_order: b.sort_order,
    status: b.status,
  });

  // ── 편집
  let currentCode = $state<string | null>(code ?? null);
  let saving = $state(false);
  let msg = $state<{ tone: string; text: string } | null>(null);
  let savedJson = $state("");
  let memberCount = $state(0);
  let mapPointId = $state<string | null>(null);
  let picking = $state(false);
  let geoNote = $state<string | null>(null);
  const f = $state({
    code: "",
    kind: "지부" as string,
    name: "",
    head_name: "",
    phone: "",
    postcode: "",
    address: "",
    address_detail: "",
    lat: "" as number | string,
    lng: "" as number | string,
    sort_order: "" as number | string,
    status: "published",
  });
  let photo = $state<{ id: string; url: string } | null>(null);

  const payload = () => ({
    ...(currentCode ? {} : { code: f.code.trim().toLowerCase() }),
    kind: f.kind,
    name: f.name,
    head_name: f.head_name,
    phone: f.phone,
    postcode: f.postcode,
    address: f.address,
    address_detail: f.address_detail,
    lat: f.lat === "" ? null : Number(f.lat),
    lng: f.lng === "" ? null : Number(f.lng),
    photo_media_id: photo?.id ?? null,
    sort_order: f.sort_order === "" ? null : Number(f.sort_order),
    status: f.status,
  });
  const dirty = $derived(!isList && !loading && JSON.stringify(payload()) !== savedJson);
  $effect(() => {
    if (!isList) (window as any).__jbAdminDirty = dirty;
  });

  function fill(b: any) {
    f.code = b.code;
    f.kind = b.kind;
    f.name = b.name ?? "";
    f.head_name = b.head_name ?? "";
    f.phone = b.phone ? formatPhone(b.phone) : "";
    f.postcode = b.postcode ?? "";
    f.address = b.address ?? "";
    f.address_detail = b.address_detail ?? "";
    f.lat = b.lat ?? "";
    f.lng = b.lng ?? "";
    f.sort_order = b.sort_order ?? "";
    f.status = b.status ?? "published";
    photo = b.photo ? { id: b.photo.id, url: b.photo.url } : null;
    memberCount = b.member_count ?? 0;
    mapPointId = b.map_point_id ?? null;
  }

  onMount(() => {
    if (isList) {
      loadList();
      return;
    }
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if ((window as any).__jbAdminDirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    // 지도에서 위치를 고르면 PointLocationPicker(KakaoMap)가 알려 준다
    const onPick = (e: Event) => {
      const c = (e as CustomEvent).detail;
      f.lat = Number(c.lat.toFixed(6));
      f.lng = Number(c.lng.toFixed(6));
    };
    window.addEventListener("jsbooks:coord-pick", onPick);
    (async () => {
      try {
        if (currentCode) fill((await adminApi.getBranch(currentCode)).item);
        loading = false;
        savedJson = JSON.stringify(payload());
      } catch (e) {
        error = e instanceof Error ? e.message : "불러오기 실패";
        loading = false;
      }
    })();
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("jsbooks:coord-pick", onPick);
      (window as any).__jbAdminDirty = false;
    };
  });

  async function searchAddress() {
    geoNote = null;
    try {
      const a = await pickAddress();
      if (!a) return;
      f.postcode = a.postcode;
      f.address = a.address;
      if (!f.address_detail && a.extra) f.address_detail = a.extra;
      await findCoord();
    } catch (e) {
      geoNote = e instanceof Error ? e.message : "주소 검색에 실패했습니다";
    }
  }

  async function findCoord() {
    geoNote = null;
    if (!f.address.trim()) return (geoNote = "주소를 먼저 입력해 주세요.");
    if (!hasKakaoKey()) return (geoNote = "카카오 지도 키(PUBLIC_KAKAO_JS_KEY)가 없어 좌표를 찾을 수 없습니다. 위도·경도를 직접 입력해 주세요.");
    try {
      const c = await geocode(f.address);
      if (!c) return (geoNote = "이 주소로 좌표를 찾지 못했습니다. 지도에서 위치를 정해 주세요.");
      f.lat = c.lat;
      f.lng = c.lng;
      geoNote = "주소로 위치를 찾았습니다. 지도에서 정확한 건물 위치로 옮길 수 있습니다.";
    } catch (e) {
      geoNote = e instanceof Error ? e.message : "좌표를 찾지 못했습니다";
    }
  }

  async function save() {
    msg = null;
    if (!currentCode && !/^[a-z0-9][a-z0-9-]{1,29}$/.test(f.code.trim().toLowerCase()))
      return (msg = { tone: "err", text: "주소 이름은 영문 소문자·숫자·-로 2~30자 입력해 주세요 (예: gwangju)" });
    if (!f.name.trim()) return (msg = { tone: "err", text: "지부·분원명을 입력해 주세요." });
    saving = true;
    try {
      const body = payload();
      const created = !currentCode;
      const it = currentCode
        ? (await adminApi.updateBranch(currentCode, body)).item
        : (await adminApi.createBranch(body)).item;
      currentCode = it.code;
      fill(it);
      savedJson = JSON.stringify(payload());
      msg = {
        tone: "ok",
        text:
          `저장했습니다 (${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })})` +
          (it.lat == null ? " — 좌표가 없어 지도에는 아직 나오지 않습니다." : ""),
      };
      if (created) history.replaceState(null, "", `#branch/${it.code}`);
    } catch (e) {
      msg = { tone: "err", text: e instanceof Error ? e.message : "저장 실패" };
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!currentCode) return;
    if (memberCount > 0) {
      msg = { tone: "err", text: `소속 회원이 ${memberCount}명 있어 삭제할 수 없습니다. 공개 상태를 '숨김'으로 바꿔 주세요.` };
      return;
    }
    if (
      !(await confirmDialog({
        title: "지부·분원 삭제",
        message: `"${f.name}"을(를) 삭제할까요? 지도에서도 사라집니다.`,
        confirmText: "삭제",
        tone: "danger",
      }))
    )
      return;
    try {
      await adminApi.removeBranch(currentCode);
      (window as any).__jbAdminDirty = false;
      location.hash = "#branches";
    } catch (e) {
      msg = { tone: "err", text: e instanceof Error ? e.message : "삭제 실패" };
    }
  }

  function onPickPhoto(list: { id: string; url: string }[]) {
    const m = list[0];
    if (m) photo = { id: m.id, url: m.url };
    picking = false;
  }

  const STATUSES = [
    { v: "published", l: "공개", d: "방문자에게 보임·지도에 표시" },
    { v: "draft", l: "작성 중", d: "운영자만 보임" },
    { v: "hidden", l: "숨김", d: "목록·지도에서 내림" },
  ];
</script>

{#if isList}
  <div class="head">
    <p class="dim">
      소개 &gt; 지부·분원 페이지와 지도의 "지부·분원" 버튼에 나옵니다. 순서는 ↑↓로 바꾸면 바로 저장됩니다.
    </p>
    <div class="head-btns">
      {#if missingCoord.length}
        <button type="button" class="btn btn-ghost" disabled={filling || !hasKakaoKey()} onclick={fillCoords}
          title={hasKakaoKey() ? "" : "카카오 지도 키가 필요합니다"}
          >{filling ? "좌표 찾는 중…" : `좌표 채우기 (${missingCoord.length})`}</button
        >
      {/if}
      <a class="btn btn-primary" href="#branch/new">＋ 새 지부·분원</a>
    </div>
  </div>
  {#if note}<p class="dim note">{note}</p>{/if}
  {#if loading}
    <p class="dim">불러오는 중…</p>
  {:else if error}
    <p class="err">{error}</p>
  {:else}
    {#each groups as g (g.kind)}
      <section>
        <h3>{g.kind} <small>{g.items.length}</small></h3>
        {#if g.items.length}
          <ul>
            {#each g.items as b (b.code)}
              {@const i = items.indexOf(b)}
              <li class:off={b.status !== "published"}>
                <a class="main" href={`#branch/${b.code}`}>
                  {#if b.photo}<img src={b.photo.url} alt="" loading="lazy" />{:else}<span class="ph"></span>{/if}
                  <span class="t">
                    <strong>{b.name}</strong>
                    <small>{[b.head_name, formatPhone(b.phone)].filter(Boolean).join(" · ") || "지부장·연락처 없음"}</small>
                    <small class="addr">{b.address ?? "주소 없음"}</small>
                  </span>
                </a>
                <span class="pin" class:none={b.lat == null} title={b.lat == null ? "좌표 없음 — 지도에 안 나옴" : "지도에 표시"}
                  >{b.lat == null ? "좌표 없음" : "지도 ✓"}</span
                >
                <span class={`badge ${b.status}`}>{STATUS[b.status] ?? b.status}</span>
                <span class="tools"
                  ><button type="button" aria-label="위로" disabled={i === 0} onclick={() => move(b.code, -1)}>↑</button>
                  <button type="button" aria-label="아래로" disabled={i === items.length - 1} onclick={() => move(b.code, 1)}
                    >↓</button
                  ></span
                >
              </li>
            {/each}
          </ul>
        {:else}
          <p class="dim">없습니다.</p>
        {/if}
      </section>
    {/each}
  {/if}
{:else if loading}
  <p class="dim">불러오는 중…</p>
{:else if error}
  <p class="err">{error}</p>
  <a href="#branches">← 목록으로</a>
{:else}
  <div class="top">
    <a href="#branches">← 목록으로</a>
    <div class="actions">
      <a class="btn btn-ghost" href="/about/branches/" target="_blank" rel="noopener">사이트에서 보기</a>
      <button type="button" class="btn btn-primary" disabled={saving} onclick={save}>{saving ? "저장 중…" : "저장"}</button>
    </div>
  </div>
  {#if dirty}<p class="dirty">저장하지 않은 변경이 있습니다.</p>{/if}
  {#if msg}<p class={`msg ${msg.tone}`}>{msg.text}</p>{/if}
  <div class="layout">
    <div class="main-col">
      <div class="field">
        <span>분류 *</span>
        <div class="seg" role="radiogroup" aria-label="분류">
          {#each KINDS as k}
            <label class:on={f.kind === k}><input type="radio" name="kind" value={k} bind:group={f.kind} /> {k}</label>
          {/each}
        </div>
      </div>
      <div class="grid2">
        <label><span>지부·분원명 *</span><input bind:value={f.name} maxlength="40" placeholder="예: 서울 지부" /></label>
        <label
          ><span>주소 이름 * <small>{currentCode ? "바꿀 수 없음" : "영문 소문자·숫자·- (회원 소속에 쓰임)"}</small></span><input
            bind:value={f.code}
            maxlength="30"
            placeholder="예: seoul"
            disabled={!!currentCode}
          /></label
        >
      </div>
      <div class="grid2">
        <label><span>{f.kind}장</span><input bind:value={f.head_name} maxlength="40" placeholder="예: 홍길동" /></label>
        <label
          ><span>연락처 <small>휴대폰·일반전화</small></span><input
            type="tel"
            inputmode="tel"
            bind:value={f.phone}
            maxlength="20"
            placeholder="예: 010-1234-5678"
            onblur={() => (f.phone = formatPhone(f.phone) || f.phone)}
          /></label
        >
      </div>
      <section class="box">
        <strong>주소·위치</strong>
        <div class="addr-row">
          <input class="postcode" bind:value={f.postcode} placeholder="우편번호" maxlength="10" readonly />
          <button type="button" class="btn btn-ghost" onclick={searchAddress}>주소 검색</button>
        </div>
        <input bind:value={f.address} maxlength="200" placeholder="주소 (검색하거나 직접 입력)" />
        <input bind:value={f.address_detail} maxlength="100" placeholder="상세 주소 (예: 2층, (신림동))" />
        <div class="addr-row">
          <button type="button" class="btn btn-ghost sm" onclick={findCoord}>주소로 위치 찾기</button>
          {#if geoNote}<small class="dim">{geoNote}</small>{/if}
        </div>
        {#if hasKakaoKey()}
          <PointLocationPicker lat={f.lat} lng={f.lng} itemId={mapPointId} kind="branch" />
        {/if}
        <div class="grid2 even">
          <label><span>위도</span><input type="number" step="any" bind:value={f.lat} /></label>
          <label><span>경도</span><input type="number" step="any" bind:value={f.lng} /></label>
        </div>
        <small class="dim">좌표가 있어야 지도의 "지부·분원" 버튼에 나옵니다.</small>
      </section>
    </div>
    <aside class="side">
      <section class="box">
        <strong>공개 상태</strong>
        {#each STATUSES as s}
          <label class="check"><input type="radio" name="status" value={s.v} bind:group={f.status} /> {s.l} <small>{s.d}</small></label>
        {/each}
      </section>
      <section class="box">
        <strong>사진</strong>
        {#if photo}<img class="photo" src={photo.url} alt="" />{:else}<span class="photo empty">없음</span>{/if}
        <div class="row">
          <button type="button" class="btn btn-ghost sm" onclick={() => (picking = true)}>{photo ? "바꾸기" : "고르기"}</button>
          {#if photo}<button type="button" class="btn btn-ghost sm" onclick={() => (photo = null)}>빼기</button>{/if}
        </div>
        <small class="dim">새 사진은 고르기 창에서 바로 올릴 수 있습니다.</small>
      </section>
      <section class="box">
        <label><span>순서 <small>작을수록 앞 (비우면 맨 뒤)</small></span><input type="number" step="1" bind:value={f.sort_order} /></label>
        {#if currentCode}<small class="dim">소속 회원 {memberCount}명</small>{/if}
      </section>
      {#if currentCode}
        <button type="button" class="btn btn-ghost danger" onclick={remove}>삭제</button>
      {/if}
    </aside>
  </div>
  {#if picking}
    <div class="overlay" role="dialog" aria-modal="true" aria-label="사진 고르기">
      <div class="sheet">
        <h3>{f.name || "지부·분원"} 사진 고르기</h3>
        <MediaLibrary mode="pick" onpick={onPickPhoto} oncancel={() => (picking = false)} />
      </div>
    </div>
  {/if}
{/if}

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .head-btns {
    display: flex;
    gap: 8px;
  }
  .note {
    margin-bottom: 8px;
  }
  h3 {
    font-size: 0.95rem;
    margin: 18px 0 8px;
  }
  h3 small {
    color: var(--color-muted);
    font-weight: 500;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-top: 1px solid var(--color-rule);
  }
  li:first-child {
    border-top: 0;
  }
  li.off .main {
    opacity: 0.55;
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--color-fg);
  }
  .main:hover {
    text-decoration: none;
  }
  .main img,
  .main .ph {
    width: 64px;
    height: 48px;
    flex: none;
    object-fit: cover;
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
  }
  .t {
    min-width: 0;
    display: grid;
    gap: 1px;
  }
  .t strong {
    font-size: 0.95rem;
  }
  .t small {
    color: var(--color-muted);
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pin {
    flex: none;
    font-size: 0.78rem;
    color: var(--color-secondary);
  }
  .pin.none {
    color: var(--color-primary);
  }
  .badge {
    flex: none;
    font-size: 0.74rem;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-muted);
  }
  .badge.published {
    background: var(--color-secondary-bg);
    color: var(--color-secondary);
  }
  .tools {
    flex: none;
    display: flex;
    gap: 4px;
  }
  .tools button {
    width: 28px;
    height: 28px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: #fff;
    cursor: pointer;
  }
  .tools button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .dirty {
    margin: 0 0 10px;
    font-size: 0.85rem;
    color: var(--color-primary);
  }
  .msg {
    margin: 0 0 12px;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    font-size: 0.88rem;
  }
  .msg.ok {
    background: var(--color-secondary-bg);
    color: var(--color-secondary);
  }
  .msg.err {
    background: #fbeaea;
    color: var(--color-primary);
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    gap: 20px;
    align-items: start;
  }
  .main-col,
  .side {
    display: grid;
    gap: 14px;
  }
  label,
  .field {
    display: grid;
    gap: 5px;
  }
  label > span,
  .field > span {
    font-size: 0.85rem;
    font-weight: 700;
  }
  label small,
  .field small {
    font-weight: 400;
    color: var(--color-muted);
  }
  input:not([type="radio"]):not([type="checkbox"]) {
    width: 100%;
    padding: 9px 11px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: #fff;
    font: inherit;
    font-size: 0.92rem;
    box-sizing: border-box;
  }
  input:disabled,
  input[readonly] {
    background: var(--color-surface-2);
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .seg {
    display: inline-flex;
    gap: 6px;
  }
  .seg label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 6px 14px;
    border: 1px solid var(--color-rule);
    border-radius: 999px;
    background: #fff;
    cursor: pointer;
    font-size: 0.9rem;
  }
  .seg label.on {
    border-color: var(--color-primary);
    color: var(--color-primary);
    font-weight: 700;
  }
  .seg input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .box {
    display: grid;
    gap: 10px;
    padding: 14px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  .addr-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .addr-row .postcode {
    width: 110px;
  }
  .check {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 0.9rem;
  }
  .check small {
    color: var(--color-muted);
  }
  .photo {
    width: 100%;
    aspect-ratio: 4 / 3;
    object-fit: cover;
    border-radius: var(--radius-sm);
  }
  .photo.empty {
    display: grid;
    place-items: center;
    background: var(--color-surface-2);
    color: var(--color-muted);
    font-size: 0.85rem;
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .danger {
    color: var(--color-primary);
  }
  .dim {
    color: var(--color-muted);
    font-size: 0.86rem;
    margin: 0;
  }
  .err {
    color: var(--color-primary);
  }
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgba(0, 0, 0, 0.45);
  }
  .sheet {
    width: min(960px, 100%);
    max-height: 90vh;
    overflow: auto;
    padding: 18px;
    border-radius: var(--radius-md);
    background: var(--color-bg, #fff);
  }
  .sheet h3 {
    margin: 0 0 12px;
  }
  @media (max-width: 860px) {
    .layout,
    .grid2 {
      grid-template-columns: 1fr;
    }
    .pin {
      display: none;
    }
  }
</style>
