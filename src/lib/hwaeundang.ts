import { getCollection, type CollectionEntry } from "astro:content";

export type Chapter = CollectionEntry<"scripture">;

/** 화은당실기 항목의 라우트 slug 도출. */
export function chapterSlug(entry: Chapter): string {
  if (entry.data.section === "preface") return "preface";
  if (entry.data.section === "appendix") return "appendix";
  if (typeof entry.data.장 === "number") return String(entry.data.장);
  return entry.id.split("/").pop()!;
}

/** 표시용 라벨 (서문 / 제N장 / 부록). */
export function chapterLabel(entry: Chapter): string {
  if (entry.data.section === "preface") return "서문";
  if (entry.data.section === "appendix") return "부록";
  return `제${entry.data.장}장`;
}

/** 파일 id 순(00→99) 정렬된 화은당실기 전체. */
export async function getHwaeundang(): Promise<Chapter[]> {
  const all = await getCollection("scripture");
  return all
    .filter((e) => e.id.startsWith("hwaeundang-silgi/"))
    .sort((a, b) => a.id.localeCompare(b.id));
}
