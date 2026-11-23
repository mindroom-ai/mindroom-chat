import { describe, expect, it } from 'vitest';
import {
  appendTranscriptSegment,
  buildTrailingPrompt,
  joinTranscriptParts,
  needsSpaceBetween,
  stitchTranscript,
} from './stitchTranscript';

describe('joinTranscriptParts', () => {
  it('joins words with a single space and attaches glued punctuation without a leading space', () => {
    expect(joinTranscriptParts('Hello', 'world')).toBe('Hello world');
    expect(joinTranscriptParts('Hello', ', world!')).toBe('Hello, world!');
    expect(joinTranscriptParts('Ready', '?')).toBe('Ready?');
    expect(joinTranscriptParts('Wait', '…')).toBe('Wait…');
    expect(joinTranscriptParts('(draft', ')')).toBe('(draft)');
    expect(joinTranscriptParts('She said "hello"', 'and left.')).toBe('She said "hello" and left.');
    expect(joinTranscriptParts("It's 'fine'", 'really.')).toBe("It's 'fine' really.");
    expect(joinTranscriptParts('She said "', 'hello')).toBe('She said "hello');
    expect(joinTranscriptParts('', 'Start')).toBe('Start');
    expect(joinTranscriptParts('End', '   ')).toBe('End');
  });

  it('handles CJK punctuation and skips spaces between adjacent CJK characters', () => {
    expect(joinTranscriptParts('今日は', 'いい天気です')).toBe('今日はいい天気です');
    expect(joinTranscriptParts('你好', '，世界！')).toBe('你好，世界！');
    expect(joinTranscriptParts('你好。', '再见')).toBe('你好。再见');
    expect(joinTranscriptParts('テスト', '。')).toBe('テスト。');
    expect(needsSpaceBetween('今天', '天气')).toBe(false);
    expect(needsSpaceBetween('hello', 'world')).toBe(true);
  });
});

describe('stitchTranscript overlap deduplication', () => {
  it('deduplicates 1-6 word suffix/prefix overlap when overlapped is true, keeping later words', () => {
    const stitched = stitchTranscript([
      { text: 'We should deploy the new dictation feature,', overlapped: false },
      { text: 'dictation feature before Friday.', overlapped: true },
    ]);
    expect(stitched).toBe('We should deploy the new dictation feature before Friday.');
  });

  it('matches overlap case-insensitively and ignores edge punctuation, up to 6 words', () => {
    const stitched = stitchTranscript([
      { text: 'Intro one two three four five six!', overlapped: false },
      { text: 'One, TWO three four five six and seven.', overlapped: true },
    ]);
    expect(stitched).toBe('Intro One, TWO three four five six and seven.');
  });

  it('preserves real non-overlapping short speech even when it matches prior wording', () => {
    expect(appendTranscriptSegment('Are you sure?', { text: 'Sure.', overlapped: false })).toBe(
      'Are you sure? Sure.'
    );
    const stitched = stitchTranscript([
      { text: 'Very good', overlapped: false },
      { text: 'good point.', overlapped: false },
    ]);
    expect(stitched).toBe('Very good good point.');
  });

  it('caps overlap scanning at 6 words', () => {
    const stitched = stitchTranscript([
      { text: 'a b c d e f g', overlapped: false },
      { text: 'b c d e f g h', overlapped: true },
    ]);
    expect(stitched).toBe('a b c d e f g h');
  });

  it('deduplicates spaceless CJK character suffix/prefix overlap when overlapped is true', () => {
    const stitched = stitchTranscript([
      { text: '我昨天去了上海', overlapped: false },
      { text: '去了上海以后', overlapped: true },
    ]);
    expect(stitched).toBe('我昨天去了上海以后');
  });
});

describe('buildTrailingPrompt', () => {
  it('returns undefined for empty text and trims long prompts on a word boundary', () => {
    expect(buildTrailingPrompt('   ')).toBeUndefined();
    expect(buildTrailingPrompt('Short prompt.')).toBe('Short prompt.');

    const long =
      'Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu extra words here';
    const prompt = buildTrailingPrompt(long, 50);
    expect(prompt).toBeDefined();
    expect(prompt!.length).toBeLessThanOrEqual(50);
    expect(long.endsWith(prompt!)).toBe(true);
    const startIdx = long.length - prompt!.length;
    expect(startIdx === 0 || /\s/.test(long[startIdx - 1] ?? '')).toBe(true);
  });

  it('handles a single unbroken token longer than maxChars cleanly', () => {
    const token = 'a'.repeat(250);
    expect(buildTrailingPrompt(token, 200)).toBe('a'.repeat(200));
  });
});
