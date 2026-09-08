import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const CONTENT = "./content";

/**
 * 소개 — 신앙·역사·인물·교리 등 정적 소개 페이지.
 * kind 로 성격을 구분(인물/교리/연혁/조직/지부/교가/약도)해 한 컬렉션에 모음.
 */
const about = defineCollection({
  loader: glob({ pattern: "*.md", base: `${CONTENT}/about` }),
  schema: z.object({
    title: z.string(),
    title_hanja: z.string().optional(),
    kind: z.enum([
      "person", // 인물 (증산상제·화은당·구암)
      "doctrine", // 교기·교지·교리
      "history", // 법종교 연혁
      "org", // 조직표
      "branches", // 전국지부·지회
      "anthem", // 증산법종교가
      "directions", // 찾아오시는 길
      "overview", // 일반 소개
    ]),
    order: z.number().default(0),
    summary: z.string().optional(),
    hero_image: z.string().optional(),
    // 인물 카드용 보조 필드
    birth: z.string().optional(),
    aliases: z.array(z.string()).optional(),
  }),
});

/**
 * 전각 — 성지 전각 안내. 카카오 지도 좌표·사진 포함.
 */
const jeongak = defineCollection({
  loader: glob({ pattern: "*.md", base: `${CONTENT}/jeongak` }),
  schema: z.object({
    name: z.string(),
    name_hanja: z.string().optional(),
    order: z.number().default(0),
    summary: z.string().optional(),
    built: z.string().optional(), // 건립 시기
    // [lat, lng] 좌표, 또는 위치 비공개·미상이면 "none".
    coord: z.union([z.tuple([z.number(), z.number()]), z.literal("none")]).optional(),
    photos: z
      .array(z.object({ src: z.string(), caption: z.string().optional() }))
      .optional(),
    hero_image: z.string().optional(),
  }),
});

/**
 * 경전 — 화은당실기(jsbooks에서 재활용). sentence-anchor 본문 형식.
 */
const scripture = defineCollection({
  loader: glob({ pattern: "**/*.md", base: `${CONTENT}/scripture` }),
  schema: z.object({
    scripture: z.string().optional(),
    scripture_hanja: z.string().optional(),
    편자: z.string().optional(),
    편자_한자: z.string().optional(),
    장: z.number().optional(),
    장_이름: z.string().optional(),
    section: z.string().optional(), // preface | appendix
  }),
});

export const collections = { about, jeongak, scripture };
