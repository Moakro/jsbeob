<script lang="ts">
  // 관리자 화면(/admin/) — 해시 라우팅으로 섹션 탭·편집기를 오간다. 운영자(level 4)만.
  //   #about · #jeongak · #archive · #map · #media · #photos · #tags · #home · #members
  //   #article/<id|new>?section=&parent=  ·  #place/<id|new>  ·  #point/<id|new>?place=  ·  #tag/<id|new>
  // 저장하지 않은 변경(window.__jbAdminDirty)이 있으면 이동 전에 묻는다.
  // 복원(2026-11-01): 배포본 _astro/AdminApp.*.js 를 근거로 다시 썼다. 하위 컴포넌트 파일 이름은 추정.
  import { onMount } from "svelte";
  import { api } from "../../lib/api";
  import { confirmDialog } from "../../lib/confirm";
  import { HEADER_NAV } from "../../data/site-nav";
  import MediaLibrary from "../MediaLibrary.svelte";
  import AdminContentList from "./AdminContentList.svelte";
  import LibraryCategories from "./LibraryCategories.svelte";
  import AdminEditor from "./AdminEditor.svelte";
  import MapPointList from "./MapPointList.svelte";
  import PointEditor from "./PointEditor.svelte";
  import TagsAdmin from "./TagsAdmin.svelte";
  import HomeTiles from "./HomeTiles.svelte";
  import MediaVideos from "./MediaVideos.svelte";
  import MembersAdmin from "./MembersAdmin.svelte";

  let me = $state<any>(null);
  let ready = $state(false);
  let hash = $state("");
  /** 직전 해시 — 이동을 취소하면 되돌린다 */
  let lastHash = "";

  /** 아직 관리 화면이 없는 섹션은 흐리게 */
  const ENABLED = new Set(["about", "jeongak", "archive", "map", "media"]);
  const SECTION_TABS = HEADER_NAV.filter((n) => n.slug !== "home").map((n) => ({
    key: n.slug,
    label: n.label,
    enabled: ENABLED.has(n.slug),
  }));
  const EXTRA_TABS = [
    { key: "photos", label: "사진 창고" },
    { key: "tags", label: "태그" },
    { key: "home", label: "홈 편성" },
    { key: "members", label: "회원" },
  ];
  const TABS = new Set([
    ...SECTION_TABS.filter((t) => t.enabled).map((t) => t.key),
    ...EXTRA_TABS.map((t) => t.key),
  ]);
  /** 예전 해시 이름 */
  const ALIAS: Record<string, string> = { library: "archive", places: "jeongak" };

  const route = $derived.by((): any => {
    const raw = hash.replace(/^#/, "") || "about";
    const [path, qs = ""] = raw.split("?");
    const [head, id] = path.split("/");
    const params = new URLSearchParams(qs);
    if ((head === "article" || head === "place") && id) {
      const section = params.get("section") === "library" ? "library" : "about";
      return {
        view: "edit",
        type: head,
        id: id === "new" ? null : id,
        section,
        parent: params.get("parent"),
        key: raw,
      };
    }
    if (head === "point" && id)
      return { view: "point", id: id === "new" ? null : id, placeId: params.get("place"), key: raw };
    if (head === "tag" && id) return { view: "tag", id: id === "new" ? null : id, key: raw };
    const tab = ALIAS[head] ?? head;
    return { view: "list", tab: TABS.has(tab) ? tab : "about", key: raw };
  });
  const activeTab = $derived(
    route.view === "list"
      ? route.tab
      : route.view === "point"
        ? "map"
        : route.view === "tag"
          ? "tags"
          : route.type === "place"
            ? "jeongak"
            : route.section === "library"
              ? "archive"
              : "about",
  );

  onMount(() => {
    hash = location.hash;
    lastHash = hash;
    const onHash = async () => {
      if ((window as any).__jbAdminDirty) {
        const target = location.hash;
        history.replaceState(null, "", lastHash || "#");
        if (
          !(await confirmDialog({
            title: "저장하지 않은 변경",
            message: "저장하지 않은 내용이 있습니다. 저장하지 않고 이동할까요?",
            confirmText: "이동",
            tone: "danger",
          }))
        )
          return;
        (window as any).__jbAdminDirty = false;
        history.replaceState(null, "", target);
      }
      hash = location.hash;
      lastHash = hash;
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    api
      .me()
      .then((r: any) => (me = r.user))
      .catch(() => (me = null))
      .finally(() => (ready = true));
    return () => window.removeEventListener("hashchange", onHash);
  });
</script>

{#if !ready}
  <p class="dim">확인 중…</p>
{:else if !me}
  <p>로그인이 필요합니다. <a href={`/login?next=${encodeURIComponent("/admin/")}`}>로그인</a></p>
{:else if (me.level ?? 0) < 4}
  <p>운영자만 사용할 수 있는 화면입니다.</p>
{:else}
  <nav class="tabs">
    {#each SECTION_TABS as t (t.key)}
      {#if t.enabled}
        <a href={`#${t.key}`} class:on={activeTab === t.key}>{t.label}</a>
      {:else}
        <span class="off" aria-disabled="true">{t.label}</span>
      {/if}
    {/each}
    <span class="sep" aria-hidden="true"></span>
    {#each EXTRA_TABS as t (t.key)}
      <a href={`#${t.key}`} class:on={activeTab === t.key}>{t.label}</a>
    {/each}
  </nav>
  {#key route.key}
    {#if route.view === "edit"}
      <AdminEditor type={route.type} id={route.id} section={route.section} parent={route.parent} />
    {:else if route.view === "point"}
      <PointEditor id={route.id} placeId={route.placeId} />
    {:else if route.view === "tag"}
      <TagsAdmin id={route.id} />
    {:else if route.tab === "tags"}
      <TagsAdmin />
    {:else if route.tab === "home"}
      <HomeTiles />
    {:else if route.tab === "members"}
      <MembersAdmin meId={me.id} />
    {:else if route.tab === "photos"}
      <MediaLibrary mode="manage" />
    {:else if route.tab === "media"}
      <MediaVideos />
    {:else if route.tab === "jeongak"}
      <AdminContentList type="place" />
    {:else if route.tab === "map"}
      <MapPointList />
    {:else if route.tab === "archive"}
      <LibraryCategories />
      <AdminContentList type="article" section="library" />
    {:else}
      <AdminContentList type="article" section="about" />
    {/if}
  {/key}
{/if}

<style>
  .tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--color-rule);
    margin-bottom: 18px;
    flex-wrap: wrap;
  }
  .tabs a {
    padding: 8px 14px;
    color: var(--color-muted);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    font-weight: 600;
  }
  .tabs a:hover {
    text-decoration: none;
    color: var(--color-fg);
  }
  .tabs a.on {
    color: var(--color-primary);
    border-bottom-color: var(--color-primary);
  }
  .tabs .off {
    padding: 8px 14px;
    color: var(--color-muted);
    opacity: 0.45;
    font-weight: 600;
    cursor: default;
  }
  .tabs .sep {
    width: 1px;
    align-self: center;
    height: 18px;
    margin: 0 6px;
    background: var(--color-rule);
  }
  .dim {
    color: var(--color-muted);
  }
</style>
