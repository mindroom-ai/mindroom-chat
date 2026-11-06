import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { Room } from 'matrix-js-sdk';
import { fitTextAtWord, getThreadRootTitle } from './ThreadRootTitle';

// One unit per character, so a width reads as a character count.
const fitsIn = (width: number) => (candidate: string) => candidate.length <= width;

describe('fitTextAtWord', () => {
  it('keeps text that fits whole', () => {
    expect(fitTextAtWord('Ship the release notes', fitsIn(30))).toBe('Ship the release notes');
  });

  it('cuts after the last whole word that fits, with an ellipsis', () => {
    expect(fitTextAtWord('Ship the release notes before Friday', fitsIn(20))).toBe(
      'Ship the release…'
    );
    expect(fitTextAtWord('Ship the release notes before Friday', fitsIn(16))).toBe('Ship the…');
  });

  it('drops the punctuation before the cut', () => {
    expect(fitTextAtWord('Morning all, standup moves to 10:30 today', fitsIn(14))).toBe(
      'Morning all…'
    );
  });

  it('leaves a first word that is too wide, or text without spaces, to the line', () => {
    expect(fitTextAtWord('Supercalifragilistic expialidocious', fitsIn(10))).toBe(
      'Supercalifragilistic expialidocious'
    );
    expect(fitTextAtWord('今日の会議は午後三時に始まります', fitsIn(5))).toBe(
      '今日の会議は午後三時に始まります'
    );
  });

  it('cuts right-to-left text at its logical end', () => {
    expect(fitTextAtWord('اجتماع الفريق يبدأ الساعة الثالثة بعد الظهر', fitsIn(20))).toBe(
      'اجتماع الفريق يبدأ…'
    );
  });
});

describe('getThreadRootTitle', () => {
  const room = {
    getMember: (userId: string) =>
      userId === '@sam:example.org' ? { rawDisplayName: 'Sam', name: 'Sam' } : null,
  } as unknown as Room;
  const t = ((key: string) => key) as unknown as TFunction;

  it('reads the first message as plain text with mentions as names', () => {
    expect(
      getThreadRootTitle(
        room,
        { summaryText: undefined, rootPreviewText: '@sam:example.org can you check the build?' },
        t
      )
    ).toBe('Sam can you check the build?');
  });

  it('gives way to an AI summary, and is absent without text', () => {
    expect(
      getThreadRootTitle(room, { summaryText: 'Build check', rootPreviewText: 'Hello' }, t)
    ).toBeUndefined();
    expect(
      getThreadRootTitle(room, { summaryText: undefined, rootPreviewText: undefined }, t)
    ).toBeUndefined();
  });
});
