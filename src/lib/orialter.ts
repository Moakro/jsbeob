// 오리알터 글 만들기 공용 — 피드 입력창(OrialterFeed)과 ＋ 버튼 시트(OrialterSheet)가 같이 쓴다 (2026-11-28)
import { parseYouTube } from "./blocks";

export const ORIALTER_BOARD = "orialter";
/** 글 하나에 붙이는 사진 수 */
export const MAX_PHOTOS = 6;
/** 사진 고르기 창 형식 — HEIC 는 브라우저가 열 수 있으면 WebP 로 바꿔 올리고, 못 열면 안내한다(decodeImage) */
export const PHOTO_ACCEPT = "image/*,.heic,.heif";

const blockId = () => Math.random().toString(36).slice(2, 10) + "fd";

/** 글에서 유튜브 주소를 뽑아 영상 블록으로(주소만 있는 줄은 지운다) */
export function splitYouTube(src: string) {
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

/**
 * 오리알터 글 블록 — [제목(소제목 블록, 선택)] 글 · 영상 · 사진 순.
 * 제목은 피드 카드·글 보기에 보이도록 소제목 블록으로도 넣는다(글 제목 칸에는 API 로 따로 보낸다).
 * 나중에 '찍은 장소'(지도 장소 points 중 선택)를 붙일 때는 여기에 map 블록({type:"map", point_id})을 더하면 된다.
 */
export function orialterBlocks(input: { title?: string; text: string; keys: string[] }) {
  const blocks: any[] = [];
  const title = (input.title ?? "").trim();
  if (title) blocks.push({ id: blockId(), type: "heading", text: title });
  const s = splitYouTube(input.text);
  if (s.text) blocks.push({ id: blockId(), type: "text", text: s.text });
  for (const v of s.videos) blocks.push({ id: blockId(), type: "video", video_id: v });
  if (input.keys.length) blocks.push({ id: blockId(), type: "image", items: input.keys.map((key) => ({ key })) });
  return blocks;
}
