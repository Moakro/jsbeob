<script lang="ts">
  // 도생광장 PC 의 앨범·회원 모달 — 'jb:section-open' 이벤트나 #album/#members 해시로 연다.
  // 복원(2026-11-01): 배포본 SSR(CommunityHome 청크)·클라이언트(_astro/CommunityModals.*.js) 기준.
  import { onMount } from "svelte";
  import { ORIALTER_FILTER_EVENT } from "../../lib/api";
  import ModalFrame from "../ModalFrame.svelte";
  import AlbumGrid from "./AlbumGrid.svelte";
  import OrialterMembers from "./OrialterMembers.svelte";

  let key = $state<string | null>(null);

  function close() {
    key = null;
    if (location.hash) history.replaceState(history.state, "", location.pathname + location.search);
  }

  onMount(() => {
    const onOpen = (e: Event) => (key = (e as CustomEvent).detail.key);
    // 회원 목록에서 회원을 고르면(글쓴이 필터) 모달을 닫는다
    const onFilter = (e: Event) => {
      if (key === "members" && (e as CustomEvent).detail.author) close();
    };
    window.addEventListener("jb:section-open", onOpen);
    const h = location.hash.slice(1);
    if ((h === "album" || h === "members") && matchMedia("(min-width: 861px)").matches) key = h;
    window.addEventListener(ORIALTER_FILTER_EVENT, onFilter);
    return () => {
      window.removeEventListener("jb:section-open", onOpen);
      window.removeEventListener(ORIALTER_FILTER_EVENT, onFilter);
    };
  });
</script>

<ModalFrame open={key === "album"} onclose={close} label="앨범" title="앨범" wide>
  <div class="pad"><AlbumGrid /></div>
</ModalFrame>
<ModalFrame open={key === "members"} onclose={close} label="회원" title="회원">
  <div class="pad"><OrialterMembers mode="list" /></div>
</ModalFrame>

<style>
  .pad {
    padding: 12px 16px 16px;
  }
</style>
