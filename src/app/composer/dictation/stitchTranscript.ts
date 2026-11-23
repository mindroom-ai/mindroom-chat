export type StitchSegmentInput = {
  text: string;
  overlapped?: boolean;
};

const MAX_OVERLAP_WORDS = 6;
const GLUED_LEADING_PUNCTUATION = /^[,.;:!?…)\]}>。、，！？：；」』】）]/;
const OPENING_NO_SPACE = /[([{"'「『【（]$/;
const CJK_CLOSING_PUNCTUATION = /[。、，！？：；」』】）]$/;
const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

type WordSpan = {
  norm: string;
  start: number;
  end: number;
};

const normalizeWord = (word: string): string =>
  word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

const scanWords = (text: string): WordSpan[] => {
  const spans: WordSpan[] = [];
  const matcher = /\S+/g;
  let match: RegExpExecArray | null = matcher.exec(text);
  while (match !== null) {
    const raw = match[0];
    spans.push({
      norm: normalizeWord(raw),
      start: match.index,
      end: match.index + raw.length,
    });
    match = matcher.exec(text);
  }
  return spans;
};

/** Returns true when `text` starts with punctuation that attaches directly to the prior word. */
export const startsWithGluedPunctuation = (text: string): boolean =>
  GLUED_LEADING_PUNCTUATION.test(text.trimStart());

/**
 * Returns true when inserting `right` immediately after `left` should include a single ASCII space.
 * Skips spaces around whitespace, opening brackets, glued punctuation, and adjacent CJK characters.
 */
export const needsSpaceBetween = (left: string, right: string): boolean => {
  if (!left || !right) return false;
  const lastChar = left.slice(-1);
  const firstChar = right.slice(0, 1);
  if (/\s/.test(lastChar) || /\s/.test(firstChar)) return false;
  if (GLUED_LEADING_PUNCTUATION.test(firstChar)) return false;
  if (OPENING_NO_SPACE.test(lastChar) || CJK_CLOSING_PUNCTUATION.test(lastChar)) return false;
  if (CJK_CHAR.test(lastChar) && CJK_CHAR.test(firstChar)) return false;
  return true;
};

/** Joins two transcript chunks with punctuation- and CJK-aware spacing. */
export const joinTranscriptParts = (left: string, right: string): string => {
  const a = left.trimEnd();
  const b = right.trimStart();
  if (!a) return b;
  if (!b) return a;
  return needsSpaceBetween(a, b) ? `${a} ${b}` : `${a}${b}`;
};

/** Trims trailing context to at most `maxChars` on a word boundary for Whisper prompt chaining. */
export const buildTrailingPrompt = (text: string, maxChars = 200): string | undefined => {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= maxChars) return trimmed;

  const cutStart = trimmed.length - maxChars;
  const tail = trimmed.slice(cutStart);
  const charBefore = trimmed[cutStart - 1];
  if (charBefore === undefined || /\s/.test(charBefore)) return tail.trimStart();

  const firstSpace = tail.search(/\s/);
  if (firstSpace === -1) return tail;
  const bounded = tail.slice(firstSpace + 1).trimStart();
  return bounded || tail;
};

const deduplicateOverlap = (left: string, right: string): string => {
  const leftWords = scanWords(left);
  const rightWords = scanWords(right);
  const maxK = Math.min(MAX_OVERLAP_WORDS, leftWords.length, rightWords.length);

  for (let k = maxK; k >= 1; k -= 1) {
    let matched = true;
    for (let i = 0; i < k; i += 1) {
      const a = leftWords[leftWords.length - k + i]?.norm ?? '';
      const b = rightWords[i]?.norm ?? '';
      if (!a || a !== b) {
        matched = false;
        break;
      }
    }
    if (matched) {
      const keepUntil = leftWords[leftWords.length - k]?.start ?? 0;
      const prefix = left.slice(0, keepUntil).trimEnd();
      return joinTranscriptParts(prefix, right);
    }
  }
  return joinTranscriptParts(left, right);
};

/** Appends one transcribed segment onto accumulated transcript text. */
export const appendTranscriptSegment = (current: string, segment: StitchSegmentInput): string => {
  const next = segment.text.trim();
  if (!next) return current;
  if (!current.trim()) return next;
  if (segment.overlapped) return deduplicateOverlap(current, next);
  return joinTranscriptParts(current, next);
};

/** Stitches ordered dictation segments into final composer text. */
export const stitchTranscript = (segments: readonly StitchSegmentInput[]): string =>
  segments.reduce((acc, segment) => appendTranscriptSegment(acc, segment), '');
