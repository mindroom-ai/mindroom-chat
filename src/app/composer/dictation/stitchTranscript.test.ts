import { describe, expect, it } from 'vitest';
import {
  appendTranscriptSegment,
  buildTrailingPrompt,
  isPromptEcho,
  joinTranscriptParts,
  stitchTranscript,
} from './stitchTranscript';

describe('joinTranscriptParts', () => {
  it('joins words with a single space and attaches glued punctuation without a leading space', () => {
    expect(joinTranscriptParts('Hello', 'world')).toBe('Hello world');
    expect(joinTranscriptParts('Hello', ', world!')).toBe('Hello, world!');
    expect(joinTranscriptParts('Ready', '?')).toBe('Ready?');
    expect(joinTranscriptParts('Wait', '…')).toBe('Wait…');
    expect(joinTranscriptParts('(draft', ')')).toBe('(draft)');
    expect(joinTranscriptParts('', 'Start')).toBe('Start');
    expect(joinTranscriptParts('End', '   ')).toBe('End');
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

  it('does not deduplicate repeated words when overlapped is false', () => {
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
    // Must not start mid-word.
    expect(long.endsWith(prompt!)).toBe(true);
    const startIdx = long.length - prompt!.length;
    expect(startIdx === 0 || /\s/.test(long[startIdx - 1] ?? '')).toBe(true);
  });

  it('handles a single unbroken token longer than maxChars cleanly', () => {
    const token = 'a'.repeat(250);
    expect(buildTrailingPrompt(token, 200)).toBe('a'.repeat(200));
  });
});

describe('prompt-echo guard', () => {
  it('drops short low-energy tail chunks that merely repeat a suffix of the sent prompt', () => {
    const prompt = 'Let us meet in the lobby on Tuesday.';
    expect(isPromptEcho('on Tuesday.', prompt, { seconds: 0.7, peakRms: 0.02 })).toBe(true);
    expect(
      appendTranscriptSegment(prompt, {
        text: 'on Tuesday.',
        prompt,
        seconds: 0.7,
        peakRms: 0.02,
      })
    ).toBe(prompt);
  });

  it('preserves loud deliberate repetitions and longer speech', () => {
    const prompt = 'Please confirm yes.';
    expect(isPromptEcho('Yes.', prompt, { seconds: 0.6, peakRms: 0.2 })).toBe(false);
    expect(isPromptEcho('confirm yes.', prompt, { seconds: 3.2, peakRms: 0.03 })).toBe(false);
    expect(isPromptEcho('no problem.', prompt, { seconds: 0.5, peakRms: 0.02 })).toBe(false);
  });
});
