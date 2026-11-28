export type StitchSegmentInput = {
  text: string;
  overlapped?: boolean;
};

const MAX_OVERLAP_WORDS = 6;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const MIN_CJK_OVERLAP_CHARS = 2;
const MAX_CJK_OVERLAP_CHARS = 12;
const GLUED_LEADING_PUNCTUATION = /^[,.;:!?…)\]}>。、，！？：；」』】）]/;
const OPENING_NO_SPACE = /[([{\u201c\u2018「『【（]$/;
const OPENING_ASCII_QUOTE = /(?:^|\s)["']$/;
const CJK_CLOSING_PUNCTUATION = /[。、，！？：；」』】）]$/;
const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const PURE_CJK_RUN = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u;

type WordSpan = {
  norm: string;
  start: number;
  end: number;
};

const previousCodePointStart = (text: string, end: number): number => {
  const last = text.charCodeAt(end - 1);
  if (last >= 0xdc00 && last <= 0xdfff) {
    const first = text.charCodeAt(end - 2);
    if (first >= 0xd800 && first <= 0xdbff) return end - 2;
  }
  return end - 1;
};

const normalizeWord = (word: string): string => {
  const lower = word.toLowerCase();
  const start = lower.search(WORD_CHAR);
  if (start === -1) return '';
  // Walking in from the ends avoids backtracking over large interior punctuation runs.
  let end = lower.length;
  while (end > start) {
    const prev = previousCodePointStart(lower, end);
    if (WORD_CHAR.test(lower.slice(prev, end))) break;
    end = prev;
  }
  return lower.slice(start, end);
};

const scanTrailingWords = (text: string, maxWords: number, maxRightNormLen: number): WordSpan[] => {
  const spans: WordSpan[] = [];
  if (!maxRightNormLen) return spans;
  let start = text.length;
  while (start > 0 && spans.length < maxWords) {
    while (start > 0 && /\s/.test(text.charAt(start - 1))) start -= 1;
    const end = start;
    let wordChars = 0;
    while (start > 0 && /\S/.test(text.charAt(start - 1))) {
      const prev = previousCodePointStart(text, start);
      if (WORD_CHAR.test(text.slice(prev, start))) wordChars += 1;
      // Case conversion and edge trimming preserve at least one code unit per letter/number.
      // Keep two units of headroom; no suffix match can cross a token larger than every candidate.
      if (wordChars > maxRightNormLen + 2) return spans.reverse();
      start = prev;
    }
    if (start < end) spans.push({ norm: normalizeWord(text.slice(start, end)), start, end });
  }
  return spans.reverse();
};

const scanLeadingWords = (text: string, maxWords: number): WordSpan[] => {
  const spans: WordSpan[] = [];
  const matcher = /\S+/g;
  while (spans.length < maxWords) {
    const match = matcher.exec(text);
    if (!match) break;
    const raw = match[0];
    spans.push({ norm: normalizeWord(raw), start: match.index, end: match.index + raw.length });
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
  if (
    OPENING_NO_SPACE.test(lastChar) ||
    OPENING_ASCII_QUOTE.test(left.slice(-2)) ||
    CJK_CLOSING_PUNCTUATION.test(lastChar)
  ) {
    return false;
  }
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
  const rightWords = scanLeadingWords(right, MAX_OVERLAP_WORDS);
  const maxRightNormLen = Math.max(0, ...rightWords.map((word) => word.norm.length));
  const leftWords = scanTrailingWords(left, MAX_OVERLAP_WORDS, maxRightNormLen);
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
  const leftTrimmed = left.trimEnd();
  let suffixEnd = leftTrimmed.length;
  while (suffixEnd > 0 && /[。、，！？.,!?]/.test(leftTrimmed.charAt(suffixEnd - 1)))
    suffixEnd -= 1;
  const rightTrimmed = right.trimStart();
  const leftTail = leftTrimmed.slice(Math.max(0, suffixEnd - MAX_CJK_OVERLAP_CHARS * 2), suffixEnd);
  const rightHead = rightTrimmed.slice(0, MAX_CJK_OVERLAP_CHARS * 2);
  if (CJK_CHAR.test(leftTail) && CJK_CHAR.test(rightHead)) {
    const leftChars = Array.from(leftTail);
    const rightChars = Array.from(rightHead);
    const maxChars = Math.min(MAX_CJK_OVERLAP_CHARS, leftChars.length, rightChars.length);
    for (let k = maxChars; k >= MIN_CJK_OVERLAP_CHARS; k -= 1) {
      const suffix = leftChars.slice(leftChars.length - k).join('');
      const prefix = rightChars.slice(0, k).join('');
      if (suffix === prefix && PURE_CJK_RUN.test(suffix)) {
        const kept = leftTrimmed.slice(0, suffixEnd - suffix.length);
        return joinTranscriptParts(kept, rightTrimmed);
      }
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
