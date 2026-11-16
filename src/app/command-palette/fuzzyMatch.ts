/** A range of a text: the index of its first character and the index after its last. */
export type TextRange = readonly [start: number, end: number];

/**
 * How a typed word matches a field: `score` is the way it matches (the same for every field
 * matched that way), `detail` tells matches of one way apart (the share of the word typed, the
 * words before it), and `ranges` are the characters of the folded field it matched.
 */
export type WordMatch = { score: number; detail: number; ranges: TextRange[] };

/** A field as the matcher compares it. */
export type PreparedText = {
  /** The folded text. */
  text: string;
  /** A set of flags per character of `text`. */
  flags: Uint8Array;
  /** Where the segments start, and the characters there as one text. */
  starts: number[];
  initials: string;
};

/**
 * The scores that mean something on their own: `exact` is a field that is the typed word, from
 * `strong` up the word is the start of a word of the field or its initials, and from `close` up
 * the field holds the word or a typo of it. Below that the word only abbreviates the field.
 */
export const MATCH_SCORE = { exact: 100, strong: 56, close: 28 } as const;

// The flags of a folded character.
const WORD_START = 1;
const WORD_END = 2;
// The start of a word as spaces, punctuation and capitals part them: in text written without
// spaces every character starts a word, and a segment is the whole run.
const SEGMENT_START = 4;
const WORD_CHAR = 8;

// The ways a word matches, best first.
const SCORE = {
  fieldStart: 80,
  wordStart: 70,
  // Added to a start that is the whole word.
  wholeWord: 15,
  initials: MATCH_SCORE.strong,
  inWord: 44,
  typo: 34,
  typoWholeWord: 5,
  secondTypo: 4,
  abbreviation: 16,
} as const;

// What tells two matches of one way apart.
const DETAIL = {
  /** Times the share of the field's word that was typed. */
  coverage: 4,
  /** Per word before the match, up to `wordsBeforeCounted`. */
  wordBefore: -0.5,
  wordsBeforeCounted: 4,
  initialsFromStart: 5,
  initialsOfAll: 3,
  inWordEnd: 5,
  /** Times the share of an abbreviation's letters that follow each other or start a word. */
  abbreviationRun: 9,
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
  '\u00df': 'ss',
  '\u00e6': 'ae',
  '\u0153': 'oe',
  '\u00f8': 'o',
  '\u0111': 'd',
  '\u00f0': 'd',
  '\u00fe': 'th',
  '\u0142': 'l',
  '\u0131': 'i',
  // The Greek sigma at the end of a word.
  '\u03c2': '\u03c3',
};
const PLAIN_LETTER = /[\u00df\u00e6\u0153\u00f8\u0111\u00f0\u00fe\u0142\u0131\u03c2]/g;

// What belongs to the character before it: a mark, or a vowel or final letter of a Korean
// syllable written as its letters.
const FOLLOWS = /[\p{M}\u1160-\u11ff]/u;

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

/** How a piece of text that folds on its own, a character with its marks, is compared. */
type Unit = {
  folded: string;
  word: boolean;
  small: boolean;
  capital: boolean;
  /** A character of a script written without spaces. */
  unspaced: boolean;
};

// A text is made of few different characters, so each is worked out once. The cap only keeps a
// long session with many scripts from growing the map without end.
const UNIT_CACHE_SIZE = 4096;
const unitCache = new Map<string, Unit>();

const unitOf = (unit: string): Unit => {
  const cached = unitCache.get(unit);
  if (cached) return cached;
  const made: Unit = {
    folded: foldUnit(unit),
    word: WORD_LETTER.test(unit),
    small: SMALL_LETTER.test(unit),
    capital: CAPITAL_LETTER.test(unit),
    unspaced: WRITTEN_WITHOUT_SPACES.test(unit),
  };
  if (unitCache.size >= UNIT_CACHE_SIZE) unitCache.clear();
  unitCache.set(unit, made);
  return made;
};

/** `text` in the pieces that fold on their own: a character with what follows it as part of it. */
const unitsOf = (text: string): string[] => {
  const units: string[] = [];
  let start = 0;
  while (start < text.length) {
    const first = text.charCodeAt(start);
    // Both halves of a character of two code units.
    let end = start + (first >= 0xd800 && first <= 0xdbff ? 2 : 1);
    // Nothing below U+0300 follows another character.
    while (end < text.length && text.charCodeAt(end) >= 0x300) {
      const next = String.fromCodePoint(text.codePointAt(end) ?? 0);
      if (!FOLLOWS.test(next)) break;
      end += next.length;
    }
    units.push(text.slice(start, end));
    start = end;
  }
  return units;
};

/**
 * Text as the matcher compares it: lower case, Latin, Greek and Cyrillic letters without their
 * accents, Arabic and Hebrew ones without their vowel marks, and the sharp s, the o with a
 * stroke and their like as the plain letters people type for them.
 */
export const foldText = (text: string): string => {
  if (ASCII.test(text)) return text.toLowerCase();
  let folded = '';
  unitsOf(text).forEach((unit) => {
    folded += unitOf(unit).folded;
  });
  return folded;
};

/** Sets the flags of a text one character at a time, in order. */
const flagger = (length: number) => {
  const flags = new Uint8Array(length);
  const starts: number[] = [];
  // The last character of the word that is open, or -1.
  let open = -1;
  let wasWord = false;
  let wasSmall = false;
  return {
    flags,
    starts,
    /** The next `size` characters, from `at`: one letter of a word, or something else. */
    add(
      at: number,
      size: number,
      word: boolean,
      small: boolean,
      capital: boolean,
      unspaced: boolean
    ) {
      if (size === 0) return;
      if (word) {
        const segmentStart = !wasWord || (wasSmall && capital);
        if (segmentStart || unspaced) {
          if (open >= 0) flags[open] |= WORD_END;
          flags[at] |= segmentStart ? WORD_START | SEGMENT_START : WORD_START;
          if (segmentStart) starts.push(at);
        }
        for (let index = at; index < at + size; index += 1) flags[index] |= WORD_CHAR;
        open = at + size - 1;
      } else if (open >= 0) {
        flags[open] |= WORD_END;
        open = -1;
      }
      wasWord = word;
      wasSmall = small;
    },
    end() {
      if (open >= 0) flags[open] |= WORD_END;
    },
  };
};

/**
 * {@link prepareText} for text that folds letter for letter, which most text is: the same flags
 * as `flagger` sets, without a call per character.
 */
const prepareAscii = (text: string): PreparedText => {
  const { length } = text;
  const folded = text.toLowerCase();
  const flags = new Uint8Array(length);
  const starts: number[] = [];
  let initials = '';
  let wasWord = false;
  let wasSmall = false;
  for (let index = 0; index < length; index += 1) {
    const code = text.charCodeAt(index);
    const small = code >= 97 && code <= 122;
    const capital = code >= 65 && code <= 90;
    const word = small || capital || (code >= 48 && code <= 57);
    if (word) {
      if (!wasWord || (wasSmall && capital)) {
        if (wasWord) flags[index - 1] |= WORD_END;
        flags[index] = WORD_START | SEGMENT_START | WORD_CHAR;
        starts.push(index);
        initials += folded.charAt(index);
      } else {
        flags[index] = WORD_CHAR;
      }
    } else if (wasWord) {
      flags[index - 1] |= WORD_END;
    }
    wasWord = word;
    wasSmall = small;
  }
  if (wasWord) flags[length - 1] |= WORD_END;
  return { text: folded, flags, starts, initials };
};

/**
 * `text` folded, with where its words start and end. A word starts after a character that is no
 * letter or digit and at a capital after a small letter; in text written without spaces every
 * character starts one.
 */
export const prepareText = (text: string): PreparedText => {
  if (ASCII.test(text)) return prepareAscii(text);
  const units = unitsOf(text).map(unitOf);
  let folded = '';
  units.forEach((unit) => {
    folded += unit.folded;
  });
  const marker = flagger(folded.length);
  let at = 0;
  units.forEach(({ folded: part, word, small, capital, unspaced }) => {
    marker.add(at, part.length, word, small, capital, unspaced);
    at += part.length;
  });
  marker.end();
  const { flags, starts } = marker;
  let initials = '';
  starts.forEach((start) => {
    initials += folded.charAt(start);
  });
  return { text: folded, flags, starts, initials };
};

/** Ranges in order, with those that overlap or touch as one. */
const mergeRanges = (ranges: readonly TextRange[]): TextRange[] => {
  const merged: [number, number][] = [];
  ranges.forEach(([start, end]) => {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  });
  return merged;
};

/**
 * Ranges of a text's folded form, in order, as ranges of the text as written. A range that holds
 * a part of a character takes all of it: the accent with its letter, both halves of a letter that
 * folds to two. Ranges that overlap or touch come back as one, so no letter is marked twice.
 */
export const originalRanges = (text: string, ranges: readonly TextRange[]): TextRange[] => {
  if (ASCII.test(text)) return mergeRanges(ranges);
  // Where the unit of each folded character starts and ends in the text as written.
  const starts: number[] = [];
  const ends: number[] = [];
  let at = 0;
  unitsOf(text).forEach((unit) => {
    const { length } = unitOf(unit).folded;
    for (let index = 0; index < length; index += 1) {
      starts.push(at);
      ends.push(at + unit.length);
    }
    at += unit.length;
  });
  return mergeRanges(
    ranges.flatMap(([start, end]): TextRange[] => {
      const from = starts[start];
      const to = ends[end - 1];
      return from === undefined || to === undefined ? [] : [[from, to]];
    })
  );
};

const has = (flags: Uint8Array, index: number, flag: number): boolean =>
  ((flags[index] ?? 0) & flag) !== 0;

/**
 * The words that start before `index`, up to the number that counts. A field is asked for its
 * places in rising order: `from` and `count` are the place asked before and its answer, so the
 * text between two places is read once however many places there are.
 */
const wordStartsBefore = (
  flags: Uint8Array,
  index: number,
  from: number,
  count: number
): number => {
  let starts = count;
  for (let at = from; at < index && starts < DETAIL.wordsBeforeCounted; at += 1) {
    if (has(flags, at, WORD_START)) starts += 1;
  }
  return starts;
};

/** The word that holds `index`: its first index and the index after its last. */
const wordAt = (flags: Uint8Array, index: number): TextRange => {
  let end = index;
  while (end < flags.length && has(flags, end, WORD_CHAR) && !has(flags, end, WORD_END)) end += 1;
  let start = index;
  while (start > 0 && has(flags, start, WORD_CHAR) && !has(flags, start, WORD_START)) start -= 1;
  return [start, Math.min(end + 1, flags.length)];
};

const better = (match: WordMatch, than: WordMatch | undefined): boolean =>
  !than || match.score > than.score || (match.score === than.score && match.detail > than.detail);

/** The field holds the word as typed: the best place it does. */
const findHeld = (word: string, { text, flags, starts }: PreparedText, name: boolean) => {
  let at = text.indexOf(word);
  if (at === -1) return undefined;
  if (text.length === word.length) {
    return { score: MATCH_SCORE.exact, detail: 0, ranges: [[0, word.length]] as TextRange[] };
  }
  let best: WordMatch | undefined;
  // The places come in rising order, so the field is read once for all of them: the words before
  // a place are counted on from the place before it, and a word is measured once.
  let counted = 0;
  let before = 0;
  let around: TextRange = [0, 0];
  for (; at !== -1; at = text.indexOf(word, at + 1)) {
    const end = at + word.length;
    const atStart = has(flags, at, WORD_START);
    const atEnd = has(flags, end - 1, WORD_END);
    // One or two letters inside a word say little; a name is short enough for them to count.
    if (atStart || name || word.length >= 3) {
      let score: number = SCORE.inWord;
      if (atStart) {
        score =
          (at === starts[0] ? SCORE.fieldStart : SCORE.wordStart) + (atEnd ? SCORE.wholeWord : 0);
      }
      // The detail only of a place that can still be the best one.
      if (!best || score >= best.score) {
        before = wordStartsBefore(flags, at, counted, before);
        counted = at;
        if (at >= around[1]) around = wordAt(flags, at);
        const match: WordMatch = {
          score,
          detail:
            DETAIL.coverage * Math.min(1, word.length / (around[1] - around[0])) +
            before * DETAIL.wordBefore +
            (!atStart && atEnd ? DETAIL.inWordEnd : 0),
          ranges: [[at, end]],
        };
        if (better(match, best)) best = match;
      }
    }
  }
  return best;
};

/** The index after the segment that starts at `start`. */
const endOfSegment = (flags: Uint8Array, start: number): number => {
  let at = start + 1;
  while (at < flags.length && has(flags, at, WORD_CHAR) && !has(flags, at, SEGMENT_START)) at += 1;
  return at;
};

/** The word is the first letters of words that follow each other. */
const findInitials = (word: string, { starts, initials }: PreparedText): WordMatch | undefined => {
  if (word.length < 2) return undefined;
  // The first place is the one nearest the start, which is the best one.
  const first = initials.indexOf(word);
  if (first === -1) return undefined;
  return {
    score: SCORE.initials,
    detail:
      (first === 0 ? DETAIL.initialsFromStart : 0) +
      (word.length === starts.length ? DETAIL.initialsOfAll : 0),
    ranges: starts.slice(first, first + word.length).map((place): TextRange => [place, place + 1]),
  };
};

// The three rows `typosBetween` works in, kept between calls: it runs for many words a keystroke.
let typoRows = [new Uint16Array(32), new Uint16Array(32), new Uint16Array(32)];

/**
 * How many typos turn `typed` into `word`, up to `limit`: a wrong, missing or extra letter, or
 * two neighbors swapped. More than `limit` is reported as `limit + 1`.
 */
const typosBetween = (typed: string, word: string, limit: number): number => {
  if (Math.abs(typed.length - word.length) > limit) return limit + 1;
  const width = word.length + 1;
  if ((typoRows[0]?.length ?? 0) < width) {
    typoRows = [new Uint16Array(width * 2), new Uint16Array(width * 2), new Uint16Array(width * 2)];
  }
  let [twoBack, previous, current] = typoRows as [Uint16Array, Uint16Array, Uint16Array];
  for (let column = 0; column < width; column += 1) previous[column] = column;
  for (let row = 1; row <= typed.length; row += 1) {
    const letter = typed.charCodeAt(row - 1);
    current[0] = row;
    let least = row;
    for (let column = 1; column < width; column += 1) {
      const other = word.charCodeAt(column - 1);
      let cost = Math.min(
        (previous[column] ?? 0) + 1,
        (current[column - 1] ?? 0) + 1,
        (previous[column - 1] ?? 0) + (letter === other ? 0 : 1)
      );
      if (
        row > 1 &&
        column > 1 &&
        letter === word.charCodeAt(column - 2) &&
        typed.charCodeAt(row - 2) === other
      ) {
        cost = Math.min(cost, (twoBack[column - 2] ?? 0) + 1);
      }
      current[column] = cost;
      if (cost < least) least = cost;
    }
    if (least > limit) return limit + 1;
    [twoBack, previous, current] = [previous, current, twoBack];
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
const findTypo = (word: string, { text, flags, starts }: PreparedText): WordMatch | undefined => {
  const { length } = word;
  const limit = length >= TWO_TYPOS_LENGTH ? 2 : 1;
  const first = word.charAt(0);
  let best: WordMatch | undefined;
  let counted = 0;
  let before = 0;
  const consider = (start: number, end: number, typos: number, whole: boolean) => {
    before = wordStartsBefore(flags, start, counted, before);
    counted = start;
    const match: WordMatch = {
      score: SCORE.typo + (whole ? SCORE.typoWholeWord : 0) - (typos > 1 ? SCORE.secondTypo : 0),
      detail: before * DETAIL.wordBefore,
      ranges: [[start, end]],
    };
    if (better(match, best)) best = match;
  };
  for (const start of starts) {
    // A typo in the first letter makes another word.
    if (text.charAt(start) === first) {
      const end = endOfSegment(flags, start);
      const segment = text.slice(start, end);
      if (length < TYPO_LENGTH) {
        if (isSwap(word, segment)) consider(start, end, 1, true);
      } else {
        const typos = typosBetween(word, segment, limit);
        if (typos <= limit) {
          consider(start, end, typos, true);
        } else if (length >= WORD_START_TYPO_LENGTH) {
          // The start as long as the typed word first, so of equal typos the nearest length is
          // marked.
          for (let offset = 0; offset <= 2 * limit; offset += 1) {
            const size = length + (offset % 2 === 0 ? offset / 2 : -(offset + 1) / 2);
            if (size < segment.length) {
              const startTypos = typosBetween(word, segment.slice(0, size), limit);
              if (startTypos <= limit) consider(start, start + size, startTypos, false);
            }
          }
        }
      }
    }
  }
  return best;
};

const ABBREVIATION_LENGTH = 3;
// The longest typed word compared for typos and abbreviations. Comparing for typos takes the
// square of its length and following an abbreviation a call inside a call for each letter, and a
// word this long is pasted, not typed: it matches where a field holds it.
const FUZZY_WORD_LENGTH = 64;

/**
 * The word abbreviates the field: the starts of words that follow each other, each as far as it
 * was typed ("engplat"), where the last word may leave letters out once ("crm" for Create Room).
 */
const findAbbreviation = (
  word: string,
  { text, flags, starts }: PreparedText
): WordMatch | undefined => {
  // Places a letter was tried from without an end: no way from there, however it was reached.
  const dead = new Set<number>();
  const places: number[] = [];
  const inWord = (place: number): boolean =>
    place < text.length && has(flags, place, WORD_CHAR) && !has(flags, place, SEGMENT_START);
  // `segment` is the word that holds `from`, as its place in `starts`.
  const follow = (letter: number, from: number, segment: number, jumped: boolean): boolean => {
    if (letter === word.length) return true;
    const key = (letter * (text.length + 1) + from) * 2 + (jumped ? 1 : 0);
    if (dead.has(key)) return false;
    const wanted = word.charAt(letter);
    const take = (place: number, inSegment: number, afterJump: boolean): boolean => {
      if (text.charAt(place) !== wanted) return false;
      places.push(place);
      if (follow(letter + 1, place, inSegment, afterJump)) return true;
      places.pop();
      return false;
    };
    const next = from + 1;
    // The next letter of this word.
    if (inWord(next) && take(next, segment, jumped)) return true;
    if (!jumped) {
      // The start of the word after this one: no word is passed over.
      const nextStart = starts[segment + 1];
      if (nextStart !== undefined && take(nextStart, segment + 1, false)) return true;
      // A later letter of this word, once; nothing but this word's letters may follow it.
      if (inWord(next)) {
        for (let place = next + 1; inWord(place); place += 1) {
          if (take(place, segment, true)) return true;
        }
      }
    }
    dead.add(key);
    return false;
  };

  const first = word.charAt(0);
  let best: WordMatch | undefined;
  let counted = 0;
  let before = 0;
  for (const [segment, start] of starts.entries()) {
    if (text.charAt(start) === first) {
      places.length = 0;
      places.push(start);
      if (follow(1, start, segment, false)) {
        const runs = places.filter(
          (place, index) =>
            index > 0 &&
            (place === (places[index - 1] ?? 0) + 1 || has(flags, place, SEGMENT_START))
        ).length;
        const ranges: [number, number][] = [];
        places.forEach((place) => {
          const last = ranges[ranges.length - 1];
          if (last && last[1] === place) last[1] = place + 1;
          else ranges.push([place, place + 1]);
        });
        before = wordStartsBefore(flags, start, counted, before);
        counted = start;
        const match: WordMatch = {
          score: SCORE.abbreviation,
          detail: (DETAIL.abbreviationRun * runs) / (word.length - 1) + before * DETAIL.wordBefore,
          ranges,
        };
        if (better(match, best)) best = match;
      }
    }
  }
  return best;
};

/**
 * How `word`, a typed word already folded, matches `field`: the best of the field holding it
 * (whole, at its start, at the start of a later word, inside a word), its initials, a typo, and
 * an abbreviation. `name` says the field is what a row is called by: only a name matches by
 * initials, by abbreviation, and by one or two letters inside a word. A word of more than 64
 * letters matches by neither a typo nor an abbreviation. The ranges are of the folded field
 * ({@link originalRanges}). Undefined when the word does not match.
 */
export const matchWord = (
  word: string,
  field: PreparedText,
  name: boolean
): WordMatch | undefined => {
  if (!word || !field.text) return undefined;
  const held = findHeld(word, field, name);
  if (held && held.score > SCORE.initials) return held;
  const initials = name ? findInitials(word, field) : undefined;
  if (initials) return initials;
  if (held) return held;
  // The rest starts at the first letter of a word of the field.
  if (
    word.length < ABBREVIATION_LENGTH ||
    word.length > FUZZY_WORD_LENGTH ||
    !field.initials.includes(word.charAt(0))
  ) {
    return undefined;
  }
  return (
    (word.length >= SWAP_LENGTH ? findTypo(word, field) : undefined) ??
    (name ? findAbbreviation(word, field) : undefined)
  );
};
