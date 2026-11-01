<script lang="ts">
  // 오리알터 피드(밴드처럼) — 글·사진·유튜브 카드, 댓글 펼치기, 글 모달, 글쓰기(검증 회원 이상)·수정·삭제.
  // 검색어·회원 필터는 ORIALTER_FILTER_EVENT 로 받는다(오리알터 검색칸·회원 목록).
  // 복원(2026-11-01): 배포본 SSR(CommunityHome 청크)·클라이언트(_astro/OrialterFeed.*.js) 기준.
  import { onMount, tick } from "svelte";
  import {
    api,
    ORIALTER_FILTER_EVENT,
    postHref,
    fullTime,
    snsTime,
    type MeUser,
    type PostSummary,
  } from "../../lib/api";
  import { uploadImage, parseYouTube } from "../../lib/blocks";
  import { confirmDialog } from "../../lib/confirm";
  import { BRANCHES } from "../../data/branches";
  import ModalFrame from "../ModalFrame.svelte";

  let { limit = 10, openId = null }: { limit?: number; openId?: string | null } = $props();

  const BOARD = "orialter";
  const MAX_PHOTOS = 6;
  const branchName = (code: string | null | undefined) => BRANCHES.find((b) => b.code === code)?.name ?? null;

  let me = $state<MeUser | null>(null);
  let posts = $state<PostSummary[]>([]);
  let next = $state<string | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  /** 긴 글 펼침 */
  const expanded = $state<Record<string, boolean>>({});
  /** 열린 ⋮ 메뉴의 글 id */
  let menuFor = $state<string | null>(null);
  let toast = $state<string | null>(null);
  let filter = $state<{ q?: string[]; author?: string; name?: string; avatar?: string | null }>({});
  /** 글 모달 */
  let open = $state<{ id: string; post: any; comments: any[]; loading: boolean } | null>(null);
  let returnUrl = "/community/";
  let reply = $state("");
  let replying = $state(false);
  let replyInput = $state<HTMLInputElement | undefined>(undefined);

  /** 검증(2) 이상 + 닉네임 */
  const canPost = $derived(!!me && !!me.display_name && (me.level ?? 0) >= 2);

  // 글쓰기
  let text = $state("");
  let files = $state<{ file: File; url: string }[]>([]);
  let posting = $state(false);
  let fileInput = $state<HTMLInputElement | undefined>(undefined);
  // 수정
  let edit = $state<{
    id: string;
    text: string;
    keep: { key: string; view_url?: string }[];
    files: { file: File; url: string }[];
    extra: any[];
    loading: boolean;
    saving: boolean;
  } | null>(null);
  let editFileInput = $state<HTMLInputElement | undefined>(undefined);

  // 카드 아래 댓글 펼침
  const threads = $state<Record<string, { open: boolean; loading: boolean; list: any[] }>>({});

  async function loadComments(id: string) {
    const r = await fetch(`/api/comments?target=post:${id}`, { credentials: "same-origin" }).then((res) =>
      res.json(),
    );
    return (r.comments ?? []).filter((c: any) => c.status === "published");
  }

  async function toggleThread(p: PostSummary) {
    const th = threads[p.id];
    if (th?.open) {
      threads[p.id] = { ...th, open: false };
      return;
    }
    threads[p.id] = { open: true, loading: !th, list: th?.list ?? [] };
    try {
      const list = await loadComments(p.id);
      threads[p.id] = { ...threads[p.id], loading: false, list };
    } catch {
      threads[p.id] = { ...threads[p.id], loading: false };
    }
  }

  /** 카드 댓글 입력값 */
  const drafts = $state<Record<string, string>>({});
  let sendingFor = $state<string | null>(null);
  const replyInputs: Record<string, HTMLInputElement> = {};

  const photosOf = (p: PostSummary) => p.attachments.filter((a) => a.type === "image" && a.url);
  /** 카드 미디어 — 유튜브 썸네일 먼저, 그다음 사진 */
  const mediaOf = (p: PostSummary) => [
    ...p.attachments
      .filter((a) => a.type === "video" && a.videoId)
      .map((a) => ({ url: `https://i.ytimg.com/vi/${a.videoId}/hqdefault.jpg`, video: true })),
    ...photosOf(p).map((a) => ({ url: a.url!, video: false })),
  ];

  /** 글에서 유튜브 주소를 뽑아 영상 블록으로(주소만 있는 줄은 지운다) */
  function splitYouTube(src: string) {
    const videos: string[] = [];
    const lines: string[] = [];
    for (const line of src.split("\n")) {
      let hit = false;
      const rest = line.replace(/https?:\/\/[^\s<>"']+/g, (u) => {
        const id = parseYouTube(u.replace(/[)\].,!?]+$/, ""));
        if (!id) return u;
        hit = true;
        if (!videos.includes(id)) videos.push(id);
        return "";
      });
      if (hit && !rest.trim()) continue;
      lines.push(hit ? rest.replace(/[ \t]{2,}/g, " ").trimEnd() : line);
    }
    const text = lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { text, videos };
  }
  const videoCount = (src: string) => splitYouTube(src).videos.length;
  const canEdit = (p: { author_id: string }) => !!me && (me.id === p.author_id || (me.level ?? 0) >= 4);

  /** 공유 링크로 들어온 글이 첫 쪽에 없으면 그 글부터 */
  let fromOlder = $state(false);
  async function loadFrom(id: string) {
    try {
      const r = await api.listPosts({ board: BOARD, limit, from: id });
      if (r.posts[0]?.id !== id) return;
      posts = r.posts;
      next = r.next;
      fromOlder = true;
    } catch {}
  }

  async function backToLatest() {
    await load();
    window.scrollTo({ top: 0 });
  }

  async function load(reset = true) {
    loading = true;
    error = null;
    try {
      const r = await api.listPosts({
        board: BOARD,
        limit,
        before: reset ? undefined : (next ?? undefined),
        q: filter.q,
        author: filter.author,
      });
      posts = reset ? r.posts : [...posts, ...r.posts];
      if (reset) fromOlder = false;
      next = r.next;
      // 주소의 ?author= 로 들어왔으면 회원 이름·사진을 글에서 채운다
      const a = filter.author ? posts.find((p) => p.author_id === filter.author) : null;
      if (a && !filter.name)
        filter = { ...filter, name: a.author.display_name ?? "회원", avatar: a.author.avatar_url };
    } catch (e) {
      error = e instanceof Error ? e.message : "불러오지 못했습니다";
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    const sp = new URLSearchParams(location.search);
    const qs = sp
      .getAll("q")
      .map((x) => x.trim())
      .filter(Boolean);
    filter = { q: qs.length ? qs : undefined, author: sp.get("author") ?? undefined };
    (async () => {
      try {
        me = (await api.me()).user;
      } catch {}
      if (openId) openPost(openId, true);
      await load();
      if (openId) {
        if (!posts.some((p) => p.id === openId) && !filter.q?.length && !filter.author)
          await loadFrom(openId);
        await tick();
        scrollToPost(openId);
      }
    })();
    const closeMenu = () => (menuFor = null);
    const onFilter = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.addQ !== undefined || d.removeQ !== undefined) {
        let q = [...(filter.q ?? [])];
        if (d.addQ && !q.includes(d.addQ)) q.push(d.addQ);
        if (d.removeQ !== undefined) q = q.filter((x) => x !== d.removeQ);
        filter = { ...filter, q: q.length ? q : undefined };
      } else if (!d.keepAuthor)
        filter = { q: filter.q, author: d.author, name: d.name, avatar: d.avatar ?? null };
      syncUrl();
      load();
    };
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent).detail?.id;
      if (id) openPost(id);
    };
    document.addEventListener("click", closeMenu);
    window.addEventListener("jb:orialter-open", onOpen);
    window.addEventListener(ORIALTER_FILTER_EVENT, onFilter);
    return () => {
      document.removeEventListener("click", closeMenu);
      window.removeEventListener(ORIALTER_FILTER_EVENT, onFilter);
      window.removeEventListener("jb:orialter-open", onOpen);
    };
  });

  /** 필터를 주소(?q=&author=)에 남긴다 */
  function syncUrl() {
    const sp = new URLSearchParams();
    for (const q of filter.q ?? []) sp.append("q", q);
    if (filter.author) sp.set("author", filter.author);
    const s = sp.toString();
    history.replaceState(history.state, "", `/community/${s ? `?${s}` : ""}`);
  }

  function clearFilter(kind: "q" | "author", value?: string) {
    const detail = kind === "q" ? { removeQ: value, keepAuthor: true } : { author: undefined };
    window.dispatchEvent(new CustomEvent(ORIALTER_FILTER_EVENT, { detail }));
  }

  /** 공유 링크로 연 글 카드로 스크롤(모바일 탭 높이만큼 띄운다) */
  function scrollToPost(id: string) {
    if (posts[0]?.id === id) return;
    const el = document.querySelector<HTMLElement>(`article[data-post="${CSS.escape(id)}"]`);
    if (!el) return;
    const tabs = document.querySelector<HTMLElement>(".cm-mtabs");
    const offset = (tabs && getComputedStyle(tabs).display !== "none" ? tabs.offsetHeight : 0) + 12;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: "instant" });
  }

  /** 글 모달 — 주소를 글 주소로 바꾼다 */
  async function openPost(id: string, direct = false) {
    if (!open)
      returnUrl = direct
        ? `/community/${location.search}`
        : location.pathname + location.search + location.hash;
    open = { id, post: null, comments: [], loading: true };
    reply = "";
    history.replaceState(history.state, "", postHref(BOARD, id));
    try {
      const [{ post }, c] = await Promise.all([
        api.getPost(id),
        fetch(`/api/comments?target=post:${id}`, { credentials: "same-origin" }).then((r) => r.json()),
      ]);
      if (open?.id === id) open = { ...open, post, comments: c.comments ?? [], loading: false };
      posts = posts.map((p) => (p.id === id ? { ...p, view_count: post.view_count } : p));
    } catch (e) {
      if (open?.id === id) open = { ...open, loading: false };
      flash(e instanceof Error ? e.message : "글을 불러오지 못했습니다");
    }
  }

  function closePost() {
    if (!open) return;
    open = null;
    history.replaceState(history.state, "", returnUrl);
  }

  /** 토스트를 body 끝으로(모달 위에 보이게) */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  /** 글 모달 댓글 */
  async function sendReply() {
    if (!open?.post || !reply.trim() || replying) return;
    const id = open.id;
    const body = reply.trim();
    replying = true;
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: `post:${id}`, body, type: "memo" }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "댓글을 남기지 못했습니다");
      const c = await fetch(`/api/comments?target=post:${id}`, { credentials: "same-origin" }).then((r) =>
        r.json(),
      );
      if (open?.id === id) open = { ...open, comments: c.comments ?? [] };
      reply = "";
      posts = posts.map((p) =>
        p.id === id
          ? {
              ...p,
              comment_count: p.comment_count + 1,
              last_comment: { body, author: me?.display_name ?? "나", created_at: new Date().toISOString() },
            }
          : p,
      );
    } catch (e) {
      flash(e instanceof Error ? e.message : "댓글을 남기지 못했습니다");
    } finally {
      replying = false;
    }
  }

  /** 카드 링크 — 보통 클릭은 모달, 새 탭(⌘·Ctrl·Shift·가운데)은 그대로 */
  const openFromLink = (e: MouseEvent, id: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    openPost(id);
  };

  function pickFiles(e: Event) {
    const input = e.target as HTMLInputElement;
    const picked = [...(input.files ?? [])];
    const room = MAX_PHOTOS - files.length;
    files = [...files, ...picked.slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }))];
    input.value = "";
  }

  function dropFile(i: number) {
    URL.revokeObjectURL(files[i].url);
    files = files.filter((_, j) => j !== i);
  }

  const blockId = () => Math.random().toString(36).slice(2, 10) + "fd";

  async function submit() {
    if (posting || (!text.trim() && !files.length)) return;
    posting = true;
    try {
      const keys: string[] = [];
      for (const f of files) keys.push((await uploadImage(f.file)).key);
      const blocks: any[] = [];
      const s = splitYouTube(text);
      if (s.text) blocks.push({ id: blockId(), type: "text", text: s.text });
      for (const v of s.videos) blocks.push({ id: blockId(), type: "video", video_id: v });
      if (keys.length) blocks.push({ id: blockId(), type: "image", items: keys.map((key) => ({ key })) });
      await api.createPost({ board: BOARD, title: "", blocks });
      files.forEach((f) => URL.revokeObjectURL(f.url));
      text = "";
      files = [];
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : "올리지 못했습니다");
    } finally {
      posting = false;
    }
  }

  async function remove(p: PostSummary) {
    menuFor = null;
    if (
      !(await confirmDialog({
        title: "글 삭제",
        message: "이 글을 삭제할까요?",
        confirmText: "삭제",
        tone: "danger",
      }))
    )
      return;
    try {
      await api.deletePost(p.id);
      posts = posts.filter((x) => x.id !== p.id);
    } catch (e) {
      flash(e instanceof Error ? e.message : "삭제하지 못했습니다");
    }
  }

  /** 수정 — 블록을 글·사진·영상(주소 줄)으로 펼친다. 그 밖의 블록(extra)은 그대로 둔다. */
  async function startEdit(id: string) {
    menuFor = null;
    edit = { id, text: "", keep: [], files: [], extra: [], loading: true, saving: false };
    try {
      const { post } = await api.getPost(id);
      const blocks: any[] = (post as any).blocks ?? [];
      const texts = blocks
        .filter((b) => b.type === "text")
        .map((b) => String(b.text ?? "").trim())
        .filter(Boolean);
      const keep = blocks
        .filter((b) => b.type === "image")
        .flatMap((b) =>
          (b.items ?? []).filter((i: any) => i.key).map((i: any) => ({ key: i.key, view_url: i.view_url })),
        );
      const videos = blocks
        .filter((b) => b.type === "video" && b.video_id)
        .map((b) => `https://youtu.be/${b.video_id}`);
      const extra = blocks.filter((b) => b.type !== "text" && b.type !== "image" && b.type !== "video");
      const body = [texts.join("\n\n"), videos.join("\n")].filter(Boolean).join("\n\n");
      if (edit?.id === id) edit = { ...edit, text: body, keep, extra, loading: false };
    } catch (e) {
      edit = null;
      flash(e instanceof Error ? e.message : "글을 불러오지 못했습니다");
    }
  }

  function closeEdit() {
    if (edit?.saving) return;
    edit?.files.forEach((f) => URL.revokeObjectURL(f.url));
    edit = null;
  }

  function pickEditFiles(e: Event) {
    if (!edit) return;
    const input = e.target as HTMLInputElement;
    const picked = [...(input.files ?? [])];
    const room = Math.max(0, MAX_PHOTOS - edit.keep.length - edit.files.length);
    edit.files = [
      ...edit.files,
      ...picked.slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) })),
    ];
    input.value = "";
  }

  function dropEdit(kind: "keep" | "files", i: number) {
    if (!edit) return;
    if (kind === "keep") edit.keep = edit.keep.filter((_, j) => j !== i);
    else {
      URL.revokeObjectURL(edit.files[i].url);
      edit.files = edit.files.filter((_, j) => j !== i);
    }
  }

  async function saveEdit() {
    if (!edit || edit.saving || edit.loading) return;
    const ed = edit;
    if (!ed.text.trim() && !ed.keep.length && !ed.files.length && !ed.extra.length) return;
    edit.saving = true;
    try {
      const keys: string[] = [];
      for (const f of ed.files) keys.push((await uploadImage(f.file)).key);
      const blocks: any[] = [];
      const s = splitYouTube(ed.text);
      if (s.text) blocks.push({ id: blockId(), type: "text", text: s.text });
      for (const v of s.videos) blocks.push({ id: blockId(), type: "video", video_id: v });
      const items = [...ed.keep.map((k) => ({ key: k.key })), ...keys.map((key) => ({ key }))];
      if (items.length) blocks.push({ id: blockId(), type: "image", items });
      blocks.push(...ed.extra);
      await api.updatePost(ed.id, { title: "", blocks });
      const { post } = await api.getPost(ed.id);
      posts = posts.map((p) =>
        p.id === ed.id
          ? {
              ...p,
              title: post.title,
              attachments: post.attachments,
              excerpt: (post.body_md ?? "").slice(0, 1200),
            }
          : p,
      );
      if (open?.id === ed.id) open = { ...open, post };
      ed.files.forEach((f) => URL.revokeObjectURL(f.url));
      edit = null;
      flash("수정했습니다");
    } catch (e) {
      if (edit) edit.saving = false;
      flash(e instanceof Error ? e.message : "수정하지 못했습니다");
    }
  }

  /** 카드 댓글 */
  async function sendCardReply(p: PostSummary) {
    const body = (drafts[p.id] ?? "").trim();
    if (!body || sendingFor) return;
    sendingFor = p.id;
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: `post:${p.id}`, body, type: "memo" }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "댓글을 남기지 못했습니다");
      posts = posts.map((x) =>
        x.id === p.id
          ? {
              ...x,
              comment_count: x.comment_count + 1,
              last_comment: { body, author: me?.display_name ?? "나", created_at: new Date().toISOString() },
            }
          : x,
      );
      drafts[p.id] = "";
      if (threads[p.id]?.open)
        threads[p.id] = { ...threads[p.id], list: await loadComments(p.id).catch(() => threads[p.id].list) };
    } catch (e) {
      flash(e instanceof Error ? e.message : "댓글을 남기지 못했습니다");
    } finally {
      sendingFor = null;
    }
  }

  async function share(p: { id: string }) {
    const url = new URL(postHref(BOARD, p.id), location.origin).href;
    try {
      if (navigator.share) await navigator.share({ title: "오리알터", url });
      else {
        await navigator.clipboard.writeText(url);
        flash("주소를 복사했습니다");
      }
    } catch {}
  }

  function flash(msg: string) {
    toast = msg;
    setTimeout(() => (toast = null), 2200);
  }

  const loginHref = () => `/login/?next=${encodeURIComponent(location.pathname)}`;

  /** 카드 댓글 입력칸을 글 id 별로 기억 */
  function remember(node: HTMLInputElement, p: PostSummary) {
    replyInputs[p.id] = node;
    return { update: (np: PostSummary) => (replyInputs[np.id] = node) };
  }
</script>

<div class="feed">
  {#if filter.author || filter.q?.length}
    <div class="filterbar" role="status" aria-label="거르는 조건">
      {#if filter.author}
        <span class="chip" title={`${filter.name ?? "회원"}님의 피드`}>
          {#if filter.avatar}
            <img class="chip-av" src={filter.avatar} alt="" />
          {:else}
            <span class="chip-av initial" aria-hidden="true">{(filter.name ?? "회").slice(0, 1)}</span>
          {/if}
          <strong>{filter.name ?? "회원"}</strong>
          <button type="button" aria-label="회원 거르기 해제" onclick={() => clearFilter("author")}>×</button>
        </span>
      {/if}
      {#each filter.q ?? [] as t}
        <span class="chip" title={`‘${t}’ 검색`}>
          <svg class="chip-ico" viewBox="0 0 24 24" width="15" height="15" role="img" aria-label="검색"
            ><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"
            ></circle><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"
            ></path></svg
          >
          <strong>{t}</strong>
          <button type="button" aria-label={`‘${t}’ 검색 해제`} onclick={() => clearFilter("q", t)}>×</button>
        </span>
      {/each}
    </div>
  {/if}

  {#if canPost && !filter.author && !filter.q?.length}
    <form
      class="card composer"
      onsubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea rows="3" placeholder="새로운 소식을 남겨보세요" aria-label="글" bind:value={text}></textarea>
      {#if videoCount(text)}
        <p class="yt-note">
          ▶ 유튜브 영상 {videoCount(text)}개가 글과 함께 올라갑니다(주소는 글에서 빠집니다)
        </p>
      {/if}
      {#if files.length}
        <ul class="picks">
          {#each files as f, i}
            <li>
              <img src={f.url} alt="" />
              <button type="button" class="x" aria-label="사진 빼기" onclick={() => dropFile(i)}>×</button>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="composer-bar">
        <button
          type="button"
          class="tool"
          disabled={files.length >= MAX_PHOTOS}
          onclick={() => fileInput?.click()}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
            ><path
              d="M4 7h3l2-2h6l2 2h3v12H4z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
            ></path><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"
            ></circle></svg
          >
          사진 {files.length ? `${files.length}/${MAX_PHOTOS}` : ""}</button
        >
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          bind:this={fileInput}
          onchange={pickFiles}
        />
        <button class="btn btn-primary go" disabled={posting || (!text.trim() && !files.length)}
          >{posting ? "올리는 중…" : "올리기"}</button
        >
      </div>
    </form>
  {/if}

  {#if loading && !posts.length}
    <p class="state">불러오는 중…</p>
  {:else if error}
    <p class="state err">{error}</p>
  {:else if !posts.length}
    <p class="state">
      {filter.author || filter.q?.length ? "해당하는 글이 없습니다." : "아직 올라온 글이 없습니다."}
    </p>
  {/if}

  {#if fromOlder}
    <button type="button" class="from-bar" onclick={backToLatest}>
      <span>이전 글부터 보고 있습니다</span>
      <strong>최신 글부터 보기 ↑</strong>
    </button>
  {/if}

  {#each posts as p (p.id)}
    {@const photos = mediaOf(p)}
    {@const th = threads[p.id]}
    {@const long =
      (p.excerpt?.length ?? 0) >= 1200 ||
      (p.excerpt?.split("\n").length ?? 0) > 6 ||
      (p.excerpt?.length ?? 0) > 280}
    <article class="card post" data-post={p.id}>
      <header class="head">
        {#if p.author.avatar_url}
          <img class="avatar" src={p.author.avatar_url} alt="" />
        {:else}
          <span class="avatar initial" aria-hidden="true">{(p.author.display_name ?? "회").slice(0, 1)}</span>
        {/if}
        <div class="who">
          <strong
            >{p.author.display_name ?? "회원"}{#if branchName(p.author.branch)}<span class="branch"
                >{branchName(p.author.branch)}</span
              >{/if}</strong
          >
          <a
            class="time"
            href={postHref(BOARD, p.id)}
            title={fullTime(p.created_at)}
            onclick={(e) => openFromLink(e, p.id)}>{snsTime(p.created_at)}</a
          >
        </div>
        {#if canEdit(p)}
          <div class="menu">
            <button
              type="button"
              class="dots"
              aria-label="글 메뉴"
              aria-expanded={menuFor === p.id}
              onclick={(e) => {
                e.stopPropagation();
                menuFor = menuFor === p.id ? null : p.id;
              }}>⋮</button
            >
            {#if menuFor === p.id}
              <div class="menu-list" role="menu">
                <button role="menuitem" type="button" onclick={() => startEdit(p.id)}>수정</button>
                <button role="menuitem" type="button" onclick={() => remove(p)}>삭제</button>
              </div>
            {/if}
          </div>
        {/if}
      </header>
      {#if p.excerpt}
        <div class="text" class:clamp={long && !expanded[p.id]}>{p.excerpt}</div>
        {#if long && !expanded[p.id]}
          <button type="button" class="more-text" onclick={() => (expanded[p.id] = true)}>더보기</button>
        {:else if (p.excerpt?.length ?? 0) >= 1200}
          <a class="more-text" href={postHref(BOARD, p.id)} onclick={(e) => openFromLink(e, p.id)}
            >전체 글 보기</a
          >
        {/if}
      {/if}
      {#if photos.length}
        <a
          class={`photos n${Math.min(photos.length, 4)}`}
          href={postHref(BOARD, p.id)}
          aria-label={photos.some((m) => m.video)
            ? `영상·사진 ${photos.length}개`
            : `사진 ${photos.length}장`}
          onclick={(e) => openFromLink(e, p.id)}
        >
          {#each photos.slice(0, 4) as a, i}
            <span class="ph" class:video={a.video}>
              <img src={a.url} alt="" loading="lazy" />
              {#if a.video}
                <span class="play" aria-hidden="true"
                  ><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"></path></svg></span
                >
              {/if}
              {#if i === 3 && photos.length > 4}<span class="plus">+{photos.length - 4}</span>{/if}
            </span>
          {/each}
        </a>
      {/if}
      <div class="stats"><span class="views">조회 {p.view_count}</span></div>
      <div class="actions">
        <button type="button" aria-expanded={!!th?.open} class:on={th?.open} onclick={() => toggleThread(p)}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
            ><path
              d="M4 5h16v11H9l-5 4z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
            ></path></svg
          >
          댓글쓰기{#if p.comment_count > 0}<span class="cnt" aria-label={`댓글 ${p.comment_count}개`}
              >{p.comment_count}</span
            >{/if}
        </button>
        <button type="button" onclick={() => share(p)}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
            ><path
              d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            ></path></svg
          >
          공유하기</button
        >
      </div>
      {#if th?.open}
        <div class="thread">
          {#if th.loading}
            <p class="thread-state">댓글을 불러오는 중…</p>
          {:else if th.list.length}
            <ul class="om-comments">
              {#each th.list as c (c.id)}
                <li>
                  <span class="avatar sm initial" aria-hidden="true"
                    >{(c.author?.display_name ?? "회").slice(0, 1)}</span
                  >
                  <div>
                    <strong>{c.author?.display_name ?? "회원"}</strong>
                    <div class="c-body">{@html c.body_html}</div>
                    <small title={fullTime(c.created_at)}>{snsTime(c.created_at)}</small>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
          {#if me?.display_name}
            <form
              class="reply"
              onsubmit={(e) => {
                e.preventDefault();
                sendCardReply(p);
              }}
            >
              <input
                placeholder="댓글을 남겨주세요."
                aria-label="댓글"
                maxlength="4000"
                bind:value={drafts[p.id]}
                use:remember={p}
              />
              <button class="send" disabled={sendingFor === p.id || !(drafts[p.id] ?? "").trim()}>등록</button
              >
            </form>
          {:else}
            <p class="om-login thread-login"><a href={loginHref()}>로그인</a>하면 댓글을 남길 수 있습니다.</p>
          {/if}
        </div>
      {:else if p.last_comment}
        <button type="button" class="last" onclick={() => toggleThread(p)}>
          <strong>{p.last_comment.author}</strong>
          <span class="lc-body">{p.last_comment.body}</span>
          <small>{snsTime(p.last_comment.created_at)}</small>
        </button>
      {/if}
    </article>
  {/each}

  {#if next}
    <button class="btn btn-ghost load-more" disabled={loading} onclick={() => load(false)}
      >{loading ? "불러오는 중…" : "더 보기"}</button
    >
  {/if}

  <ModalFrame open={!!open} onclose={closePost} label="오리알터 글">
    {#if open}
      {@const post = open.post}
      <div class="om">
        {#if open.loading}
          <p class="state">불러오는 중…</p>
        {:else if !post}
          <p class="state err">글을 찾을 수 없습니다.</p>
        {:else}
          {@const published = open.comments.filter((c) => c.status === "published")}
          <header class="head">
            {#if post.author.avatar_url}
              <img class="avatar" src={post.author.avatar_url} alt="" />
            {:else}
              <span class="avatar initial" aria-hidden="true"
                >{(post.author.display_name ?? "회").slice(0, 1)}</span
              >
            {/if}
            <div class="who">
              <strong
                >{post.author.display_name ?? "회원"}{#if branchName(post.author.branch)}<span class="branch"
                    >{branchName(post.author.branch)}</span
                  >{/if}</strong
              >
              <span class="time" title={fullTime(post.created_at)}>{snsTime(post.created_at)}</span>
            </div>
          </header>
          <div class="om-body">
            {@html post.body_html}
            <!-- 블록 본문이 아니면(예전 글) 첨부 사진을 따로 -->
            {#if !post.has_blocks}
              {#each post.attachments.filter((a: any) => a.type === "image" && a.url) as a}
                <img class="legacy" src={a.url} alt="" />
              {/each}
            {/if}
          </div>
          <!-- 복원: 배포본 템플릿의 공백으로 보아 이 자리에 주석이 둘 있었다 -->
          <!-- 조회수 · 수정 -->
          <div class="stats om-foot">
            <span>조회 {post.view_count}</span>
            {#if canEdit(post)}
              <button type="button" class="om-edit" onclick={() => startEdit(post.id)}>수정</button>
            {/if}
          </div>
          <div class="actions">
            <button
              type="button"
              onclick={() =>
                me
                  ? replyInput?.scrollIntoView({ behavior: "smooth", block: "center" })
                  : window.dispatchEvent(new CustomEvent("jb:login"))}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
                ><path
                  d="M4 5h16v11H9l-5 4z"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linejoin="round"
                ></path></svg
              >
              댓글쓰기{#if published.length > 0}<span class="cnt" aria-label={`댓글 ${published.length}개`}
                  >{published.length}</span
                >{/if}
            </button>
            <button type="button" onclick={() => share(post)}>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
                ><path
                  d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                ></path></svg
              >
              공유하기</button
            >
          </div>
          <ul class="om-comments">
            {#each published as c (c.id)}
              <li>
                <span class="avatar sm initial" aria-hidden="true"
                  >{(c.author?.display_name ?? "회").slice(0, 1)}</span
                >
                <div>
                  <strong>{c.author?.display_name ?? "회원"}</strong>
                  <div class="c-body">{@html c.body_html}</div>
                  <small>{snsTime(c.created_at)}</small>
                </div>
              </li>
            {/each}
          </ul>
          {#if me?.display_name}
            <form
              class="reply"
              onsubmit={(e) => {
                e.preventDefault();
                sendReply();
              }}
            >
              <input
                placeholder="댓글을 남겨주세요."
                aria-label="댓글"
                maxlength="4000"
                bind:value={reply}
                bind:this={replyInput}
              />
              <button class="send" disabled={replying || !reply.trim()}>등록</button>
            </form>
          {:else}
            <p class="om-login"><a href={loginHref()}>로그인</a>하면 댓글을 남길 수 있습니다.</p>
          {/if}
        {/if}
      </div>
    {/if}
  </ModalFrame>

  <ModalFrame open={!!edit} onclose={closeEdit} label="글 수정" title="글 수정">
    {#if edit}
      {#if edit.loading}
        <p class="state">불러오는 중…</p>
      {:else}
        <form
          class="composer edit-form"
          onsubmit={(e) => {
            e.preventDefault();
            saveEdit();
          }}
        >
          <textarea rows="6" placeholder="새로운 소식을 남겨보세요" aria-label="글" bind:value={edit.text}
          ></textarea>
          {#if videoCount(edit.text)}
            <p class="yt-note">▶ 유튜브 영상 {videoCount(edit.text)}개 — 주소 줄을 지우면 영상이 빠집니다</p>
          {/if}
          {#if edit.keep.length || edit.files.length}
            <ul class="picks">
              {#each edit.keep as k, i (k.key)}
                <li>
                  <img src={k.view_url ?? `/api/files/${k.key}`} alt="" />
                  <button type="button" class="x" aria-label="사진 빼기" onclick={() => dropEdit("keep", i)}
                    >×</button
                  >
                </li>
              {/each}
              {#each edit.files as f, i (f.url)}
                <li>
                  <img src={f.url} alt="" />
                  <button type="button" class="x" aria-label="사진 빼기" onclick={() => dropEdit("files", i)}
                    >×</button
                  >
                </li>
              {/each}
            </ul>
          {/if}
          <div class="composer-bar">
            <button
              type="button"
              class="tool"
              disabled={edit.saving || edit.keep.length + edit.files.length >= MAX_PHOTOS}
              onclick={() => editFileInput?.click()}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
                ><path
                  d="M4 7h3l2-2h6l2 2h3v12H4z"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linejoin="round"
                ></path><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"
                ></circle></svg
              >
              사진 {edit.keep.length + edit.files.length
                ? `${edit.keep.length + edit.files.length}/${MAX_PHOTOS}`
                : ""}</button
            >
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              bind:this={editFileInput}
              onchange={pickEditFiles}
            />
            <span class="edit-btns">
              <button type="button" class="btn btn-ghost go" disabled={edit.saving} onclick={closeEdit}
                >취소</button
              >
              <button
                class="btn btn-primary go"
                disabled={edit.saving ||
                  (!edit.text.trim() && !edit.keep.length && !edit.files.length && !edit.extra.length)}
                >{edit.saving ? "저장 중…" : "저장"}</button
              >
            </span>
          </div>
        </form>
      {/if}
    {/if}
  </ModalFrame>

  {#if toast}
    <div class="toast" role="status" use:portal>{toast}</div>
  {/if}
</div>

<style>
  .feed {
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  .card {
    background: var(--color-surface);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    min-width: 0;
  }
  .state {
    margin: 0;
    padding: 28px 0;
    text-align: center;
    color: var(--color-muted);
  }
  .state.err {
    color: var(--color-primary);
  }
  .composer {
    padding: 12px 14px;
  }
  .composer textarea {
    width: 100%;
    border: 0;
    background: none;
    resize: vertical;
    font: inherit;
    color: var(--color-fg);
    outline: none;
  }
  .picks {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .picks li {
    position: relative;
    width: 72px;
    height: 72px;
  }
  .picks img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: var(--radius-sm);
  }
  .picks .x {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: 50%;
    background: #0009;
    color: #fff;
    cursor: pointer;
    line-height: 1;
  }
  .composer-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--color-rule);
  }
  .tool {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-muted);
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .tool:hover:not(:disabled) {
    background: var(--color-bg);
    color: var(--color-fg);
  }
  .go {
    padding: 7px 16px;
  }
  .edit-form {
    padding: 12px 20px 16px;
  }
  .edit-btns {
    display: inline-flex;
    gap: 6px;
  }
  .post {
    padding: 16px 0 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 16px;
  }
  .avatar {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
  }
  .avatar.initial {
    display: grid;
    place-items: center;
    background: var(--color-secondary-bg);
    color: var(--color-secondary);
    font-weight: 700;
  }
  .who {
    display: grid;
    min-width: 0;
    flex: 1;
    line-height: 1.35;
  }
  .who strong {
    color: var(--color-ink);
    font-size: 0.95rem;
  }
  .branch {
    margin-left: 6px;
    color: var(--color-muted);
    font-size: 0.8rem;
    font-weight: 400;
  }
  .time {
    color: var(--color-muted);
    font-size: 0.8rem;
  }
  .menu {
    position: relative;
  }
  .dots {
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-muted);
    font-size: 1.2rem;
    cursor: pointer;
  }
  .dots:hover {
    background: var(--color-bg);
  }
  .menu-list {
    position: absolute;
    right: 0;
    top: 34px;
    z-index: 5;
    min-width: 96px;
    display: grid;
    padding: 4px;
    background: var(--color-surface);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
  }
  .menu-list button {
    padding: 8px 10px;
    border: 0;
    background: none;
    text-align: left;
    font: inherit;
    font-size: 0.9rem;
    color: var(--color-fg);
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .menu-list button:hover {
    background: var(--color-bg);
  }
  .text {
    margin: 12px 16px 0;
    white-space: pre-line;
    word-break: break-word;
    color: var(--color-fg);
    line-height: 1.7;
  }
  .text.clamp {
    display: -webkit-box;
    -webkit-line-clamp: 5;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .more-text {
    display: inline-block;
    margin: 2px 16px 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-muted);
    font: inherit;
    font-size: 0.88rem;
    cursor: pointer;
  }
  .ph.video {
    position: relative;
  }
  .ph .play {
    position: absolute;
    left: 50%;
    top: 50%;
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: #1f1c1a99;
    color: #fff;
    pointer-events: none;
  }
  .ph .play svg {
    width: 28px;
    height: 28px;
    margin-left: 3px;
  }
  .yt-note {
    margin: 6px 0 0;
    color: var(--color-secondary);
    font-size: 0.85rem;
  }
  .photos {
    display: grid;
    gap: 2px;
    margin-top: 12px;
    background: var(--color-surface-2);
  }
  .photos.n2 {
    grid-template-columns: 1fr 1fr;
  }
  .photos.n3 {
    grid-template-columns: 2fr 1fr;
    grid-template-rows: 1fr 1fr;
  }
  .photos.n3 .ph:first-child {
    grid-row: span 2;
  }
  .photos.n4 {
    grid-template-columns: 1fr 1fr;
  }
  .ph {
    position: relative;
    display: block;
    min-width: 0;
  }
  .ph img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .photos.n1 img {
    height: auto;
    max-height: 640px;
    object-fit: contain;
    margin-inline: auto;
  }
  .photos.n2 .ph,
  .photos.n4 .ph {
    aspect-ratio: 1;
  }
  .photos.n1 .ph.video {
    aspect-ratio: 16 / 9;
  }
  .photos.n1 .ph.video img {
    height: 100%;
    max-height: none;
    object-fit: cover;
  }
  .photos.n3 {
    aspect-ratio: 3 / 2;
  }
  .plus {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: #00000073;
    color: #fff;
    font-size: 1.4rem;
    font-weight: 700;
  }
  .stats {
    display: flex;
    gap: 10px;
    padding: 12px 16px 10px;
    color: var(--color-muted);
    font-size: 0.85rem;
  }
  .views {
    margin-left: auto;
  }
  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-top: 1px solid var(--color-rule);
  }
  .actions button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 11px 0;
    border: 0;
    background: none;
    color: var(--color-fg);
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .actions button:hover {
    background: var(--color-bg);
  }
  .actions button.on {
    color: var(--color-primary);
    font-weight: 600;
  }
  .cnt {
    min-width: 20px;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--color-primary);
    color: #fff;
    font-size: 0.8rem;
    font-weight: 700;
    line-height: 1.4;
    text-align: center;
  }
  .thread {
    border-top: 1px solid var(--color-rule);
  }
  .thread .om-comments {
    padding: 4px 16px;
    border-top: 0;
  }
  .thread-state {
    margin: 0;
    padding: 14px 16px;
    color: var(--color-muted);
    font-size: 0.9rem;
  }
  .thread .reply,
  .thread-login {
    border-top: 1px solid var(--color-rule);
  }
  .thread .thread-login {
    padding: 12px 16px;
  }
  .thread > :first-child {
    border-top: 0;
  }
  .last {
    display: grid;
    gap: 2px;
    width: 100%;
    padding: 12px 16px;
    border: 0;
    border-top: 1px solid var(--color-rule);
    background: none;
    color: var(--color-fg);
    font: inherit;
    font-size: 0.9rem;
    text-align: left;
    cursor: pointer;
  }
  .last:hover {
    background: var(--color-bg);
  }
  .last strong {
    color: var(--color-ink);
    font-size: 0.85rem;
  }
  .lc-body {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .last small {
    color: var(--color-muted);
    font-size: 0.78rem;
  }
  .reply {
    display: flex;
    gap: 6px;
    padding: 10px 16px 12px;
    border-top: 1px solid var(--color-rule);
  }
  .reply input {
    flex: 1;
    min-width: 0;
    padding: 8px 14px;
    border: 1px solid var(--color-rule);
    border-radius: 999px;
    background: var(--color-bg);
    font: inherit;
    font-size: 0.9rem;
  }
  .send {
    padding: 0 12px;
    border: 0;
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-primary);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .send:disabled {
    color: var(--color-faint);
    cursor: default;
  }
  .load-more {
    justify-self: center;
  }
  .from-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    padding: 11px 16px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-secondary-bg);
    color: var(--color-muted);
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .from-bar strong {
    color: var(--color-secondary);
  }
  .from-bar:hover {
    border-color: var(--color-secondary);
  }
  .filterbar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 4px 0 10px;
    border-radius: 999px;
    background: var(--color-secondary);
    color: #fff;
    font-size: 0.88rem;
  }
  .chip strong {
    font-weight: 700;
  }
  .chip-ico {
    flex: none;
  }
  .chip-av {
    flex: none;
    width: 22px;
    height: 22px;
    margin-left: -6px;
    border-radius: 50%;
    object-fit: cover;
  }
  .chip-av.initial {
    display: grid;
    place-items: center;
    background: #fff;
    color: var(--color-secondary);
    font-size: 0.72rem;
    font-weight: 700;
  }
  .chip button {
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 50%;
    background: none;
    color: inherit;
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
  }
  .chip button:hover {
    background: #fff3;
  }
  .om {
    padding: 20px 0 0;
  }
  .om .head {
    padding-right: 60px;
  }
  .om-foot {
    justify-content: space-between;
    align-items: center;
    min-height: 32px;
  }
  .om-edit {
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    font: inherit;
    font-size: 0.85rem;
    color: var(--color-fg);
    cursor: pointer;
  }
  .om-edit:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }
  .om-body {
    --om-pad: 20px;
    padding: 14px var(--om-pad) 0;
    line-height: 1.75;
    word-break: break-word;
  }
  .om-body :global(.blk-image) :global(img),
  .om-body :global(.blk-grid) :global(img),
  .om-body .legacy {
    height: auto;
    border-radius: 0;
  }
  .om-body :global(.blk-image) :global(img),
  .om-body :global(.blk-grid) :global(img),
  .om-body .legacy {
    width: 100%;
  }
  .om-body :global(.blk-gallery) :global(.blk-grid) {
    grid-template-columns: 1fr;
    gap: 4px;
  }
  .om-body :global(.blk-image),
  .om-body :global(.blk-video),
  .om-body .legacy {
    margin-inline: calc(-1 * var(--om-pad));
  }
  .om-body .legacy {
    display: block;
    width: calc(100% + 2 * var(--om-pad));
    max-width: none;
  }
  .om .om-body :global(.blk-image) :global(img),
  .om .om-body :global(.blk-grid) :global(img),
  .om .om-body :global(.blk-video-frame) {
    border-radius: 0;
  }
  .om-body :global(.blk-image) :global(figcaption),
  .om-body :global(.blk-video) :global(figcaption) {
    padding-inline: var(--om-pad);
  }
  .om-comments {
    list-style: none;
    margin: 0;
    padding: 4px 20px;
    border-top: 1px solid var(--color-rule);
  }
  .om-comments li {
    display: flex;
    gap: 10px;
    padding: 12px 0;
    font-size: 0.92rem;
  }
  .om-comments li + li {
    border-top: 1px solid var(--color-rule);
  }
  .om-comments strong {
    font-size: 0.86rem;
    color: var(--color-ink);
  }
  .om-comments small {
    color: var(--color-muted);
    font-size: 0.78rem;
  }
  .c-body :global(p) {
    margin: 0;
  }
  .avatar.sm {
    width: 30px;
    height: 30px;
    font-size: 0.8rem;
  }
  .om-login {
    margin: 0;
    padding: 12px 20px 16px;
    border-top: 1px solid var(--color-rule);
    color: var(--color-muted);
    font-size: 0.9rem;
  }
  @media (max-width: 760px) {
    .om-body {
      --om-pad: 16px;
    }
    .om-comments {
      padding-inline: 16px;
    }
  }
  .toast {
    position: fixed;
    left: 50%;
    bottom: 28px;
    transform: translate(-50%);
    z-index: 50;
    padding: 10px 16px;
    border-radius: var(--radius-md);
    background: var(--color-ink);
    color: #fff;
    font-size: 0.9rem;
    box-shadow: var(--shadow-lg);
  }
  @media (max-width: 760px) {
    .feed {
      gap: 8px;
      margin-inline: calc(-1 * var(--gutter));
    }
    .card,
    .from-bar {
      border-radius: 0;
      border-inline: 0;
    }
    .from-bar,
    .state,
    .filterbar {
      padding-inline: var(--gutter);
    }
  }
</style>
