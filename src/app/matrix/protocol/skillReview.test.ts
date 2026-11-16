import { describe, expect, it } from 'vitest';
import { readSkillReviewNotice, SKILL_REVIEW_CONTENT_KEY } from './skillReview';

const notice = (review: unknown) => ({
  msgtype: 'm.notice',
  body: '💾 Skill review: updated `developing-mindroom-chat`',
  [SKILL_REVIEW_CONTENT_KEY]: review,
});

const file = {
  skill: 'developing-mindroom-chat',
  path: 'developing-mindroom-chat/SKILL.md',
  action: 'updated',
  added: 12,
  removed: 3,
  diff: '@@ -10,4 +10,6 @@\n context\n-old\n+new\n',
  diff_truncated: false,
};

describe('readSkillReviewNotice', () => {
  it('reads the changed skills and files', () => {
    expect(
      readSkillReviewNotice(
        notice({ changes: { 'developing-mindroom-chat': 'updated' }, files: [file] })
      )
    ).toEqual({
      changes: [{ skill: 'developing-mindroom-chat', action: 'updated' }],
      files: [
        {
          path: 'developing-mindroom-chat/SKILL.md',
          action: 'updated',
          added: 12,
          removed: 3,
          diff: '@@ -10,4 +10,6 @@\n context\n-old\n+new\n',
          diffTruncated: false,
        },
      ],
    });
  });

  it('reads an older notice without files', () => {
    expect(readSkillReviewNotice(notice({ changes: { a: 'created', b: 'updated' } }))).toEqual({
      changes: [
        { skill: 'a', action: 'created' },
        { skill: 'b', action: 'updated' },
      ],
      files: [],
    });
  });

  it('keeps a file whose diff the budget left out, flagged as truncated', () => {
    const { diff: _diff, ...noDiff } = file;
    expect(
      readSkillReviewNotice(
        notice({ changes: { s: 'updated' }, files: [{ ...noDiff, diff_truncated: true }] })
      )?.files
    ).toEqual([
      {
        path: 'developing-mindroom-chat/SKILL.md',
        action: 'updated',
        added: 12,
        removed: 3,
        diffTruncated: true,
      },
    ]);
  });

  it('drops malformed changes and files', () => {
    const review = readSkillReviewNotice(
      notice({
        changes: { good: 'updated', bad: 'deleted', '': 'created', num: 3 },
        files: [
          file,
          { ...file, path: '' },
          { ...file, path: 7 },
          { ...file, action: 'renamed' },
          { ...file, added: -1 },
          { ...file, removed: 1.5 },
          { ...file, diff: 4 },
          { ...file, diff_truncated: 'yes' },
          'not a file',
        ],
      })
    );
    expect(review?.changes).toEqual([{ skill: 'good', action: 'updated' }]);
    expect(review?.files).toHaveLength(1);
  });

  it('ignores files that are not a list', () => {
    expect(readSkillReviewNotice(notice({ changes: { s: 'updated' }, files: {} }))?.files).toEqual(
      []
    );
  });

  it('is null for other content and for a review without a valid change', () => {
    expect(readSkillReviewNotice({ msgtype: 'm.notice', body: 'hi' })).toBeNull();
    expect(readSkillReviewNotice(notice(true))).toBeNull();
    expect(readSkillReviewNotice(notice({ changes: [] }))).toBeNull();
    expect(readSkillReviewNotice(notice({ changes: { s: 'deleted' }, files: [file] }))).toBeNull();
  });
});
