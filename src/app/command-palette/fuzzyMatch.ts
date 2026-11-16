/** A range of a text: the index of its first character and the index after its last. */
export type TextRange = readonly [start: number, end: number];

/** How well a typed word matches a field, and the characters of the folded field it matched. */
export type WordMatch = { score: number; ranges: TextRange[] };

/** A field as the matcher compares it: folded, with a set of flags per character. */
export type PreparedText = { text: string; flags: Uint8Array };

/**
 * The scores that mean something on their own: `exact` is a field that is the typed word, and
 * from `strong` up the word is the start of a word of the field or its initials.
 */
export const MATCH_SCORE = { exact: 100, strong: 56 } as const;

// The flags of a folded character.
const WORD_START = 1;
const WORD_END = 2;
// The start of a word as spaces, punctuation and capitals part them: in text written without
// spaces every character starts a word, and a segment is the whole run.
const SEGMENT_START = 4;
const WORD_CHAR = 8;

const SCORE = {
  fieldStart: 80,
  wordStart: 70,
  wholeWord: 15,
  initials: MATCH_SCORE.strong,
  initialsFromStart: 5,
  initialsOfAll: 3,
  inWord: 44,
  inWordEnd: 5,
  typo: 34,
  typoWholeWord: 5,
  secondTypo: 4,
  abbreviation: 16,
  abbreviationRun: 9,
  // Inside one way of matching: the share of the word that was typed, and the words before it.
  coverage: 4,
  wordBefore: 0.5,
  wordsBeforeCounted: 4,
} as const;

// Text that folds letter for letter: printable ASCII and its white space.
const ASCII = /^[\t\n\r -~]*$/;

// Marks a folded letter loses: the accents of Latin, Greek and Cyrillic letters, the points of
// Hebrew ones, and the vowel marks and the lengthening stroke of Arabic ones. Marks of other
// scripts stay: an Indic vowel sign or a Japanese voicing mark changes the word.
const DROPPED_MARKS =
  /[\u0300-\u036f\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u064b-\u065f\u0670]|\u0640/g;

// Letters that have no accent to drop and are still typed as plain ones.
const PLAIN_LETTERS: Readonly<Record<string, string>> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ł: 'l',
  ı: 'i',
  ς: 'σ',
};
const PLAIN_LETTER = /[ßæœøđðþłıς]/g;

// A character with the marks that follow it, and a Korean syllable written as its letters.
const UNIT = /[^\p{M}ᅠ-ᇿ][\p{M}ᅠ-ᇿ]*|[\p{M}ᅠ-ᇿ]+/gu;

const WORD_LETTER = /^[\p{L}\p{N}]/u;
const SMALL_LETTER = /^\p{Ll}/u;
const CAPITAL_LETTER = /^\p{Lu}/u;
const WRITTEN_WITHOUT_SPACES =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

const foldUnit = (unit: string): string =>
  unit
    .normalize('NFD')
    .replace(DROPPED_MARKS, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(PLAIN_LETTER, (letter) => PLAIN_LETTERS[letter] ?? letter);

/**
 * Text as the matcher compares it: lower case, Latin, Greek and Cyrillic letters without their
 * accents, Arabic and Hebrew ones without their vowel marks, and `ß`, `æ`, `ø` and their like as
 * the plain letters people type for them.
 */
export const foldText = (text: string): string =>
  ASCII.test(text) ? text.toLowerCase() : text.replace(UNIT, foldUnit);

type Unit = {
  /** Where the unit starts and ends in the text as written. */
  start: number;
  end: number;
  folded: string;
  word: boolean;
  small: boolean;
  capital: boolean;
  /** A character of a script written without spaces. */
  unspaced: boolean;
};

const asciiUnit = (text: string, index: number): Unit => {
  const code = text.charCodeAt(index);
  const small = code >= 97 && code <= 122;
  const capital = code >= 65 && code <= 90;
  return {
    start: index,
    end: index + 1,
    folded: capital ? String.fromCharCode(code + 32) : text.charAt(index),
    word: small || capital || (code >= 48 && code <= 57),
    small,
    capital,
    unspaced: false,
  };
};

/** The text in the pieces that fold on their own: a character with its marks. */
const unitsOf = (text: string): Unit[] => {
  if (ASCII.test(text)) return Array.from(text, (_, index) => asciiUnit(text, index));
  return Array.from(text.matchAll(UNIT), (found): Unit => {
    const unit = found[0];
    const start = found.index ?? 0;
    return {
      start,
      end: start + unit.length,
      folded: foldUnit(unit),
      word: WORD_LETTER.test(unit),
      small: SMALL_LETTER.test(unit),
      capital: CAPITAL_LETTER.test(unit),
      unspaced: WRITTEN_WITHOUT_SPACES.test(unit),
    };
  });
};

/**
 * `text` folded, with where its words start and end. A word starts after a character that is no
 * letter or digit and at a capital after a small letter; in text written without spaces every
 * character starts one.
 */
export const prepareText = (text: string): PreparedText => {
  const units = unitsOf(text);
  const folded = units.map((unit) => unit.folded).join('');
  const flags = new Uint8Array(folded.length);
  let position = 0;
  let previous: Unit | undefined;
  // The last character of the word that is open, if one is.
  let wordEnd = -1;
  units.forEach((unit) => {
    const { length } = unit.folded;
    if (length === 0) return;
    if (unit.word) {
      const segmentStart = !previous?.word || (previous.small && unit.capital);
      if (segmentStart || unit.unspaced) {
        if (wordEnd >= 0) flags[wordEnd] |= WORD_END;
        flags[position] |= segmentStart ? WORD_START | SEGMENT_START : WORD_START;
      }
      flags.fill(WORD_CHAR, position + 1, position + length);
      flags[position] |= WORD_CHAR;
      wordEnd = position + length - 1;
    } else if (wordEnd >= 0) {
      flags[wordEnd] |= WORD_END;
      wordEnd = -1;
    }
    position += length;
    previous = unit;
  });
  if (wordEnd >= 0) flags[wordEnd] |= WORD_END;
  return { text: folded, flags };
};

/**
 * Ranges of a text's folded form as ranges of the text as written. A range that holds a part of
 * a character takes all of it: the accent with its letter, both halves of a letter that folds to
 * two.
 */
export const originalRanges = (text: string, ranges: readonly TextRange[]): TextRange[] => {
  if (ASCII.test(text)) return ranges.map(([start, end]): TextRange => [start, end]);
  const starts: number[] = [];
  const ends: number[] = [];
  unitsOf(text).forEach((unit) => {
    for (let index = 0; index < unit.folded.length; index += 1) {
      starts.push(unit.start);
      ends.push(unit.end);
    }
  });
  const merged: [number, number][] = [];
  ranges.forEach(([start, end]) => {
    const from = starts[start];
    const to = ends[end - 1];
    if (from === undefined || to === undefined) return;
    const last = merged[merged.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  });
  return merged;
};

const has = (flags: Uint8Array, index: number, flag: number): boolean =>
  ((flags[index] ?? 0) & flag) !== 0;

/** The words that start before `index`, as far as they count against a match. */
const wordsBefore = (flags: Uint8Array, index: number): number => {
  let count = 0;
  for (let at = 0; at < index && count < SCORE.wordsBeforeCounted; at += 1) {
    if (has(flags, at, WORD_START)) count += 1;
  }
  return count;
};

/** The index after the word that holds `index`. */
const endOfWord = (flags: Uint8Array, index: number): number => {
  let at = index;
  while (at < flags.length && has(flags, at, WORD_CHAR) && !has(flags, at, WORD_END)) at += 1;
  return Math.min(at + 1, flags.length);
};

/** The index of the first character of the word that holds `index`. */
const startOfWord = (flags: Uint8Array, index: number): number => {
  let at = index;
  while (at > 0 && has(flags, at, WORD_CHAR) && !has(flags, at, WORD_START)) at -= 1;
  return at;
};

/** The field holds the word as typed: the best place it does. */
const findHeld = (word: string, { text, flags }: PreparedText, name: boolean) => {
  if (text === word) return { score: MATCH_SCORE.exact, ranges: [[0, word.length]] as TextRange[] };
  const firstWord = flags.findIndex((flag) => (flag & WORD_START) !== 0);
  let best: WordMatch | undefined;
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    const end = at + word.length;
    const atStart = has(flags, at, WORD_START);
    const atEnd = has(flags, end - 1, WORD_END);
    // One or two letters inside a word say little; a name is short enough for them to count.
    if (atStart || name || word.length >= 3) {
      let score: number;
      if (atStart) {
        score =
          (at === firstWord ? SCORE.fieldStart : SCORE.wordStart) + (atEnd ? SCORE.wholeWord : 0);
      } else {
        score = SCORE.inWord + (atEnd ? SCORE.inWordEnd : 0);
      }
      const wordLength = endOfWord(flags, at) - startOfWord(flags, at);
      score +=
        SCORE.coverage * Math.min(1, word.length / Math.max(wordLength, 1)) -
        SCORE.wordBefore * wordsBefore(flags, at);
      if (!best || score > best.score) best = { score, ranges: [[at, end]] };
    }
  }
  return best;
};

/** Where the field's segments start. */
const segmentStarts = (flags: Uint8Array): number[] => {
  const starts: number[] = [];
  flags.forEach((flag, index) => {
    if ((flag & SEGMENT_START) !== 0) starts.push(index);
  });
  return starts;
};

/** The index after the segment that starts at `start`. */
const endOfSegment = (flags: Uint8Array, start: number): number => {
  let at = start + 1;
  while (at < flags.length && has(flags, at, WORD_CHAR) && !has(flags, at, SEGMENT_START)) at += 1;
  return at;
};

/** The word is the first letters of words that follow each other. */
const findInitials = (word: string, { text }: PreparedText, starts: readonly number[]) => {
  if (word.length < 2) return undefined;
  for (let first = 0; first + word.length <= starts.length; first += 1) {
    const places = starts.slice(first, first + word.length);
    if (places.every((place, index) => text.charAt(place) === word.charAt(index))) {
      // The first place found is the one nearest the start, which scores best.
      return {
        score:
          SCORE.initials +
          (first === 0 ? SCORE.initialsFromStart : 0) +
          (word.length === starts.length ? SCORE.initialsOfAll : 0),
        ranges: places.map((place): TextRange => [place, place + 1]),
      };
    }
  }
  return undefined;
};

/**
 * How many typos turn `typed` into `word`, up to `limit`: a wrong, missing or extra letter, or
 * two neighbors swapped. More than `limit` is reported as `limit + 1`.
 */
const typosBetween = (typed: string, word: string, limit: number): number => {
  if (Math.abs(typed.length - word.length) > limit) return limit + 1;
  let twoBack: number[] = [];
  let previous = Array.from({ length: word.length + 1 }, (_, index) => index);
  for (let row = 1; row <= typed.length; row += 1) {
    const current = [row];
    let least = row;
    for (let column = 1; column <= word.length; column += 1) {
      const same = typed.charCodeAt(row - 1) === word.charCodeAt(column - 1);
      let cost = Math.min(
        (previous[column] ?? 0) + 1,
        (current[column - 1] ?? 0) + 1,
        (previous[column - 1] ?? 0) + (same ? 0 : 1)
      );
      if (
        row > 1 &&
        column > 1 &&
        typed.charCodeAt(row - 1) === word.charCodeAt(column - 2) &&
        typed.charCodeAt(row - 2) === word.charCodeAt(column - 1)
      ) {
        cost = Math.min(cost, (twoBack[column - 2] ?? 0) + 1);
      }
      current.push(cost);
      least = Math.min(least, cost);
    }
    if (least > limit) return limit + 1;
    twoBack = previous;
    previous = current;
  }
  return Math.min(previous[word.length] ?? limit + 1, limit + 1);
};

/** `typed` is `word` with two neighboring letters swapped. */
const isSwap = (typed: string, word: string): boolean => {
  if (typed.length !== word.length) return false;
  let at = 0;
  while (at < typed.length && typed.charAt(at) === word.charAt(at)) at += 1;
  return (
    at < typed.length - 1 &&
    typed.charAt(at) === word.charAt(at + 1) &&
    typed.charAt(at + 1) === word.charAt(at) &&
    typed.slice(at + 2) === word.slice(at + 2)
  );
};

// The letters a typed word needs before it takes a typo, two typos, or is compared with the
// start of a longer word.
const SWAP_LENGTH = 4;
const TYPO_LENGTH = 5;
const TWO_TYPOS_LENGTH = 9;
const WORD_START_TYPO_LENGTH = 7;

/** The word is a word of the field with a typo, or from seven letters on the start of one. */
const findTypo = (word: string, { text, flags }: PreparedText, starts: readonly number[]) => {
  const { length } = word;
  if (length < SWAP_LENGTH) return undefined;
  const limit = length >= TWO_TYPOS_LENGTH ? 2 : 1;
  let best: WordMatch | undefined;
  const consider = (start: number, end: number, typos: number, whole: boolean) => {
    const score =
      SCORE.typo +
      (whole ? SCORE.typoWholeWord : 0) -
      (typos > 1 ? SCORE.secondTypo : 0) -
      SCORE.wordBefore * wordsBefore(flags, start);
    if (!best || score > best.score) best = { score, ranges: [[start, end]] };
  };
  starts.forEach((start) => {
    // A typo in the first letter makes another word.
    if (text.charAt(start) !== word.charAt(0)) return;
    const end = endOfSegment(flags, start);
    const segment = text.slice(start, end);
    if (length < TYPO_LENGTH) {
      if (isSwap(word, segment)) consider(start, end, 1, true);
      return;
    }
    const typos = typosBetween(word, segment, limit);
    if (typos <= limit) {
      consider(start, end, typos, true);
      return;
    }
    if (length < WORD_START_TYPO_LENGTH) return;
    // The start as long as the typed word first, so of equal typos the nearest length is marked.
    for (let offset = 0; offset <= 2 * limit; offset += 1) {
      const size = length + (offset % 2 === 0 ? offset / 2 : -(offset + 1) / 2);
      if (size < segment.length) {
        const startTypos = typosBetween(word, segment.slice(0, size), limit);
        if (startTypos <= limit) consider(start, start + size, startTypos, false);
      }
    }
  });
  return best;
};

const ABBREVIATION_LENGTH = 3;

/**
 * The word abbreviates the field: its first letter starts a word, and every later letter comes
 * later in that same word or starts a later word.
 */
const findAbbreviation = (
  word: string,
  { text, flags }: PreparedText,
  starts: readonly number[]
) => {
  if (word.length < ABBREVIATION_LENGTH) return undefined;
  // Places a letter was tried from without an end: no way from there, however it was reached.
  const dead = new Set<number>();
  const places: number[] = [];
  const follow = (letter: number, from: number): boolean => {
    if (letter === word.length) return true;
    const key = letter * (text.length + 1) + from;
    if (dead.has(key)) return false;
    const wanted = word.charAt(letter);
    const take = (place: number): boolean => {
      if (text.charAt(place) !== wanted) return false;
      places.push(place);
      if (follow(letter + 1, place)) return true;
      places.pop();
      return false;
    };
    // The next character first, then the start of a later word, then later in this word.
    const next = from + 1;
    if (next < text.length && has(flags, next, WORD_CHAR) && take(next)) return true;
    if (starts.some((start) => start > next && take(start))) return true;
    // `next` belongs to the word of `from` unless it starts another one.
    if (next < text.length && has(flags, next, WORD_CHAR) && !has(flags, next, SEGMENT_START)) {
      for (
        let place = next + 1;
        place < text.length && has(flags, place, WORD_CHAR) && !has(flags, place, SEGMENT_START);
        place += 1
      ) {
        if (take(place)) return true;
      }
    }
    dead.add(key);
    return false;
  };

  let best: WordMatch | undefined;
  starts.forEach((start) => {
    if (text.charAt(start) !== word.charAt(0)) return;
    places.length = 0;
    places.push(start);
    if (!follow(1, start)) return;
    const runs = places.filter(
      (place, index) =>
        index > 0 && (place === (places[index - 1] ?? 0) + 1 || has(flags, place, SEGMENT_START))
    ).length;
    const score =
      SCORE.abbreviation +
      (SCORE.abbreviationRun * runs) / (word.length - 1) -
      SCORE.wordBefore * wordsBefore(flags, start);
    if (best && score <= best.score) return;
    const ranges: [number, number][] = [];
    places.forEach((place) => {
      const last = ranges[ranges.length - 1];
      if (last && last[1] === place) last[1] = place + 1;
      else ranges.push([place, place + 1]);
    });
    best = { score, ranges };
  });
  return best;
};

/**
 * How `word`, a typed word already folded, matches `field`: the best of the field holding it
 * (whole, at its start, at the start of a later word, inside a word), its initials, a typo, and
 * an abbreviation. `name` says the field is what a row is called by: only a name matches by
 * initials, by abbreviation, and by one or two letters inside a word. The ranges are of the
 * folded field ({@link originalRanges}). Undefined when the word does not match.
 */
export const matchWord = (
  word: string,
  field: PreparedText,
  name: boolean
): WordMatch | undefined => {
  if (!word || !field.text) return undefined;
  const held = findHeld(word, field, name);
  if (held && held.score >= SCORE.initials + SCORE.initialsFromStart + SCORE.initialsOfAll) {
    return held;
  }
  const starts = segmentStarts(field.flags);
  const initials = name ? findInitials(word, field, starts) : undefined;
  if (held || initials) return (initials?.score ?? 0) > (held?.score ?? 0) ? initials : held;
  return (
    findTypo(word, field, starts) ?? (name ? findAbbreviation(word, field, starts) : undefined)
  );
};
