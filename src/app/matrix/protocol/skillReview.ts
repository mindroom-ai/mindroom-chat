import { isRecord } from '../../lib/isRecord';

export const SKILL_REVIEW_CONTENT_KEY = 'io.mindroom.skill_review';

export type SkillReviewChange = { skill: string; action: 'created' | 'updated' };

export type SkillReviewFile = {
  path: string;
  action: 'created' | 'updated' | 'removed';
  added: number;
  removed: number;
  diff?: string;
  diffTruncated: boolean;
};

export type SkillReviewNotice = { changes: SkillReviewChange[]; files: SkillReviewFile[] };

const isChangeAction = (value: unknown): value is SkillReviewChange['action'] =>
  value === 'created' || value === 'updated';

const isFileAction = (value: unknown): value is SkillReviewFile['action'] =>
  isChangeAction(value) || value === 'removed';

const isCount = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0;

const readFile = (value: unknown): SkillReviewFile | undefined => {
  if (!isRecord(value)) return undefined;
  const { path, action, added, removed, diff, diff_truncated: truncated } = value;
  if (typeof path !== 'string' || !path || !isFileAction(action)) return undefined;
  if (!isCount(added) || !isCount(removed)) return undefined;
  if (diff !== undefined && typeof diff !== 'string') return undefined;
  if (truncated !== undefined && typeof truncated !== 'boolean') return undefined;
  return {
    path,
    action,
    added,
    removed,
    ...(diff !== undefined && { diff }),
    diffTruncated: truncated ?? false,
  };
};

/**
 * The backend's skill review notice (`io.mindroom.skill_review`): the skills a review created or
 * updated and, from newer backends, each changed file with its line counts and diff.
 * Malformed entries are dropped; null when the content is not one or names no valid change.
 */
export const readSkillReviewNotice = (
  content: Record<string, unknown>
): SkillReviewNotice | null => {
  const review = content[SKILL_REVIEW_CONTENT_KEY];
  if (!isRecord(review) || !isRecord(review.changes)) return null;
  const changes = Object.entries(review.changes).flatMap(([skill, action]) =>
    skill && isChangeAction(action) ? [{ skill, action }] : []
  );
  if (changes.length === 0) return null;
  const files = Array.isArray(review.files)
    ? review.files.flatMap((value) => readFile(value) ?? [])
    : [];
  return { changes, files };
};
