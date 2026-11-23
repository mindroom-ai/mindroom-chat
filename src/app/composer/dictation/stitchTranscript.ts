const GLUED_LEADING_PUNCTUATION = /^[,.;:!?…)\]}]/;
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const MAX_OVERLAP_WORDS = 6;
const MAX_PROMPT_ECHO_WORDS = 6;
const PROMPT_ECHO_MAX_SECONDS = 2.5;
const PROMPT_ECHO_LOUD_RMS = 0.08;

export type StitchSegmentInput = {
  text: string;
  overlapped?: boolean;
  prompt?: string;
  seconds?: number;
  peakRms?: number;
};

type WordSpan = {
  start: number;
  end: number;
  norm: string;
};

const normalizeWord = (word: string): string => word.toLowerCase().replace(EDGE_PUNCTUATION, '');

const scanWords = (text: string): WordSpan[] => {
  const spans: WordSpan[] = [];
  for (const match of text.matchAll(/\S+/g)) {
    const start = match.index ?? 0;
    spans.push({ start, end: start + match[0].length, norm: normalizeWord(match[0]) });
  }
  return spans;
};

/** Returns true when `text` starts with punctuation that attaches with no leading space. */
export const startsWithGluedPunctuation = (text: string): boolean =>
  GLUED_LEADING_PUNCTUATION.test(text);

/** Joins two transcript chunks with punctuation-aware spacing. */
export const joinTranscriptParts = (left: string, right: string): string => {
  const a = left.trimEnd();
  const b = right.trimStart();
  if (!a) return b;
  if (!b) return a;
  return GLUED_LEADING_PUNCTUATION.test(b) ? `${a}${b}` : `${a} ${b}`;
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

/**
 * Returns true when a short or low-energy tail chunk merely echoes a suffix of the sent prompt.
 */
export const isPromptEcho = (
  text: string,
  prompt: string | undefined,
  meta?: { seconds?: number; peakRms?: number }
): boolean => {
  if (!prompt) return false;
  if (meta?.peakRms !== undefined && meta.peakRms >= PROMPT_ECHO_LOUD_RMS) return false;
  if (meta?.seconds !== undefined && meta.seconds > PROMPT_ECHO_MAX_SECONDS) return false;

  const chunkWords = scanWords(text)
    .map((span) => span.norm)
    .filter(Boolean);
  if (chunkWords.length === 0 || chunkWords.length > MAX_PROMPT_ECHO_WORDS) return false;

  const promptWords = scanWords(prompt)
    .map((span) => span.norm)
    .filter(Boolean);
  if (chunkWords.length > promptWords.length) return false;

  const offset = promptWords.length - chunkWords.length;
  for (let i = 0; i < chunkWords.length; i += 1) {
    if (chunkWords[i] !== promptWords[offset + i]) return false;
  }
  return true;
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
  if (
    isPromptEcho(next, segment.prompt, {
      seconds: segment.seconds,
      peakRms: segment.peakRms,
    })
  ) {
    return current;
  }
  if (!current.trim()) return next;
  if (segment.overlapped) return deduplicateOverlap(current, next);
  return joinTranscriptParts(current, next);
};

/** Stitches ordered dictation segments into final composer text. */
export const stitchTranscript = (segments: readonly StitchSegmentInput[]): string =>
  segments.reduce((acc, segment) => appendTranscriptSegment(acc, segment), '');
