import type { WorkItem } from '../types';

const AREA_PATTERN = /(?:^|[\n,])\s*Area\s*:\s*([^\n,]+)/i;

export function extractAreaFromComment(comment: string | null | undefined): string {
  if (!comment) return '';

  const match = comment.match(AREA_PATTERN);
  return match?.[1]?.trim() ?? '';
}

export function getLatestStageArea(workItems: WorkItem[] | undefined, stage: string): string {
  if (!workItems?.length) return '';

  return [...workItems]
    .filter((item) => item.stage === stage)
    .sort((a, b) => {
      const aTime = a.completed_at ? new Date(a.completed_at).getTime() : 0;
      const bTime = b.completed_at ? new Date(b.completed_at).getTime() : 0;
      return bTime - aTime || b.id - a.id;
    })
    .map((item) => extractAreaFromComment(item.comments))
    .find(Boolean) ?? '';
}
