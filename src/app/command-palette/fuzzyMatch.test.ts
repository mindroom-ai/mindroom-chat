import { describe, expect, it } from 'vitest';
import { MATCH_SCORE, foldText, matchWord, originalRanges, prepareText } from './fuzzyMatch';

const match = (word: string, field: string, name = true) =>
  matchWord(foldText(word), prepareText(field), name);

/**
 * A number that orders matches as the matcher does: the way of matching first, then the detail
 * inside it. 0 without a match.
 */
const score = (word: string, field: string, name = true): number => {
  const found = match(word, field, name);
  return found ? found.score + found.detail / 100 : 0;
};

/** The fields in the order their scores put them, best first; a field that does not match is left out. */
const ranked = (word: string, fields: readonly string[], name = true): string[] =>
  fields
    .map((field) => ({ field, value: score(word, field, name) }))
    .filter(({ value }) => value > 0)
    .sort((left, right) => right.value - left.value)
    .map(({ field }) => field);

describe('foldText', () => {
  it.each([
    ['Café Zürich', 'cafe zurich'],
    ['Straße', 'strasse'],
    ['Søren Łukasz', 'soren lukasz'],
    ['Ærø Œuvre', 'aero oeuvre'],
    ['Guðmundsdóttir', 'gudmundsdottir'],
    ['İstanbul', 'istanbul'],
    ['Ёлка', 'елка'],
    // A combining accent written as its own character.
    ['Cafe\u0301', 'cafe'],
  ])('folds %s to %s', (text, folded) => {
    expect(foldText(text)).toBe(folded);
  });

  it('keeps marks that change a word in other scripts', () => {
    expect(foldText('が')).toBe('が');
    expect(foldText('か\u3099')).toBe('が');
    expect(foldText('कि')).toBe('कि');
  });

  it('drops the vowel marks of Arabic and Hebrew letters', () => {
    expect(foldText('مُحَمَّد')).toBe('محمد');
    expect(foldText('أحمد')).toBe('احمد');
    expect(foldText('שָׁלוֹם')).toBe('שלום');
  });

  it('folds the Greek final sigma as the capital folds', () => {
    expect(foldText('οδός')).toBe(foldText('ΟΔΟΣ'));
  });

  it('writes a Korean syllable typed as separate letters as one', () => {
    expect(foldText('\u1112\u1161\u11ab')).toBe('한');
  });
});

describe('matchWord order', () => {
  it('ranks the whole field, its start, a later word, a longer word, then text inside a word', () => {
    expect(ranked('theme', ['Subtheme', 'Themes', 'Toggle Theme', 'Theme Park', 'Theme'])).toEqual([
      'Theme',
      'Theme Park',
      'Toggle Theme',
      'Themes',
      'Subtheme',
    ]);
  });

  it('gives the whole field the exact score', () => {
    expect(match('theme', 'Theme')?.score).toBe(MATCH_SCORE.exact);
    expect(match('theme', 'Theme Park')?.score).toBeLessThan(MATCH_SCORE.exact);
  });

  it('gives matches of one way one score, whatever the words around them', () => {
    expect(match('room', 'Create Room')?.score).toBe(
      match('room', 'Mark Current Room Read')?.score
    );
    expect(match('eng', 'Eng')?.score).toBe(MATCH_SCORE.exact);
    expect(match('eng', 'Engine')?.score).toBe(match('eng', 'Engineering Platform')?.score);
    expect(match('cr', 'Create Room')?.score).toBe(match('cr', 'Crumbs')?.score);
  });

  it('ranks a whole word above a longer word that starts the same', () => {
    expect(ranked('john', ['Johnson Account', 'Johnny Appleseed', 'John Smith'])[0]).toBe(
      'John Smith'
    );
    expect(score('room', 'Create Room')).toBeGreaterThan(score('room', 'Rooms'));
  });

  it('ranks the word the text covers more of first', () => {
    expect(score('eng', 'Engine')).toBeGreaterThan(score('eng', 'Engineering'));
  });

  it('ranks a word nearer the start first', () => {
    expect(score('room', 'Create Room')).toBeGreaterThan(score('room', 'Mark Current Room Read'));
  });

  it('starts a word at a capital after a small letter', () => {
    expect(score('room', 'MindRoom')).toBeGreaterThan(score('room', 'mindroom'));
    expect(score('room', 'MindRoom')).toBe(score('room', 'Mind Room'));
  });

  it('starts a word after punctuation', () => {
    expect(score('plat', '#eng-platform:example.org')).toBe(score('plat', 'eng platform'));
  });

  it('counts every character of text written without spaces as the start of a word', () => {
    expect(score('東京', '東京オフィス')).toBe(score('tokyo', 'Tokyo Office'));
    expect(score('オフィス', '東京オフィス')).toBeGreaterThanOrEqual(MATCH_SCORE.strong);
    expect(score('オフィス', '東京オフィス')).toBeGreaterThan(score('ffice', 'Tokyo Office'));
  });

  it('ranks the ways of matching: start, initials, inside a word, typo, abbreviation', () => {
    const start = score('cr', 'Crumbs');
    const initials = score('ds', 'Design System');
    const inside = score('rea', 'Create Room');
    const typo = score('craete', 'Create Room');
    const abbreviation = score('crm', 'Create Room');
    expect(start).toBeGreaterThan(initials);
    expect(initials).toBeGreaterThanOrEqual(MATCH_SCORE.strong);
    expect(initials).toBeGreaterThan(inside);
    expect(inside).toBeLessThan(MATCH_SCORE.strong);
    expect(inside).toBeGreaterThan(typo);
    expect(typo).toBeGreaterThanOrEqual(MATCH_SCORE.close);
    expect(typo).toBeGreaterThan(abbreviation);
    expect(abbreviation).toBeLessThan(MATCH_SCORE.close);
    expect(abbreviation).toBeGreaterThan(0);
  });
});

describe('matchWord initials and abbreviations', () => {
  it('matches the initials of words that follow each other', () => {
    expect(score('ds', 'Design System')).toBeGreaterThan(0);
    expect(score('js', 'John Smith')).toBeGreaterThan(0);
    expect(score('mcrr', 'Mark Current Room Read')).toBeGreaterThan(0);
    expect(score('rr', 'Mark Current Room Read')).toBeGreaterThan(0);
  });

  it('ranks initials from the first word, and of every word, first', () => {
    expect(score('cr', 'Current Room Read')).toBeGreaterThan(score('cr', 'Mark Current Room'));
    expect(score('ds', 'Design System')).toBeGreaterThan(score('ds', 'Design System Tokens'));
  });

  it('takes no initials of words apart, in two letters', () => {
    expect(score('ml', 'Disable Media Auto Load')).toBe(0);
  });

  it('matches an abbreviation: the starts of words that follow each other', () => {
    expect(score('engplat', 'Engineering Platform')).toBeGreaterThan(0);
    expect(score('opset', 'Open Settings')).toBeGreaterThan(0);
    expect(score('roomset', 'Open Current Room Settings')).toBeGreaterThan(0);
  });

  it('lets the last word of an abbreviation leave letters out once', () => {
    expect(score('crm', 'Create Room')).toBeGreaterThan(0);
    // Twice in one word.
    expect(score('stgs', 'Settings')).toBe(0);
    expect(score('lisa', 'Linked Installations')).toBe(0);
    expect(score('jhon', 'Johnson Account')).toBe(0);
    // Before the start of another word.
    expect(score('crm', 'Cafeteria Menu')).toBe(0);
  });

  it('matches no abbreviation that passes over a word', () => {
    expect(score('peter', 'Url Preview in Encrypted Room')).toBe(0);
    expect(score('paula', 'Pair this chat account with your local MindRoom process')).toBe(0);
  });

  it('ranks an abbreviation without letters left out first', () => {
    expect(score('crom', 'Create Room')).toBeGreaterThan(score('crm', 'Create Room'));
  });

  it('matches no abbreviation that starts inside a word or jumps into the middle of one', () => {
    expect(score('emma', 'Hide Membership Change')).toBe(0);
    expect(score('john', 'Join the channel')).toBe(0);
    expect(score('lisa', 'English')).toBe(0);
  });

  it('takes no abbreviation of two letters', () => {
    expect(score('ct', 'Create')).toBe(0);
  });

  it('matches initials and abbreviations only in a name', () => {
    expect(score('ds', 'Design System', false)).toBe(0);
    expect(score('crm', 'Create Room', false)).toBe(0);
  });

  it('matches one or two letters inside a word only in a name', () => {
    expect(score('oo', 'Create Room')).toBeGreaterThan(0);
    expect(score('oo', 'Create Room', false)).toBe(0);
    expect(score('oom', 'Create Room', false)).toBeGreaterThan(0);
  });
});

describe('matchWord typos', () => {
  it('takes two neighbors swapped in a word of four letters, nothing else', () => {
    expect(score('jhon', 'John Smith')).toBeGreaterThan(0);
    expect(score('jonh', 'John Smith')).toBeGreaterThan(0);
    expect(score('jahn', 'John Smith')).toBe(0);
    expect(score('lise', 'Lisa Simpson')).toBe(0);
    expect(score('hime', 'Go Home')).toBe(0);
  });

  it('takes no typo in a word of three letters', () => {
    expect(score('teh', 'The Menu')).toBe(0);
  });

  it('takes one typo in a word of five to eight letters', () => {
    expect(score('markdwon', 'Markdown Formatting')).toBeGreaterThan(0);
    expect(score('markdxwn', 'Markdown Formatting')).toBeGreaterThan(0);
    expect(score('emmma', 'Emma Watson')).toBeGreaterThan(0);
    expect(score('logot', 'Logout')).toBeGreaterThan(0);
    expect(score('desgin', 'Design')).toBeGreaterThan(0);
    expect(score('mxrkdxwn', 'Markdown Formatting')).toBe(0);
  });

  it('takes two typos in a word of nine letters or more', () => {
    expect(score('notifcatoin', 'Notification Sound')).toBeGreaterThan(0);
    expect(score('enginering', 'Engineering')).toBeGreaterThan(0);
    expect(score('notxfxcatoin', 'Notification Sound')).toBe(0);
  });

  it('needs the first letter right', () => {
    expect(score('harkdown', 'Markdown Formatting')).toBe(0);
    expect(score('amrkdown', 'Markdown Formatting')).toBe(0);
  });

  it('compares with the start of a longer word only from seven letters on', () => {
    // Outside a name, where no abbreviation matches.
    expect(score('markdwo', 'Markdown Formatting', false)).toBeGreaterThan(0);
    expect(score('marko', 'Markdown Formatting', false)).toBe(0);
    expect(score('markdw', 'Markdown Formatting', false)).toBe(0);
  });

  it('ranks a typo of a whole word above one of a word start, and one typo above two', () => {
    expect(score('markdwon', 'Markdown')).toBeGreaterThan(score('markdwo', 'Markdown'));
    expect(score('notifcation', 'Notification')).toBeGreaterThan(
      score('notifcatoin', 'Notification')
    );
  });

  it('takes typos outside names too', () => {
    expect(score('notifcation', 'Play a notification sound', false)).toBeGreaterThan(0);
  });

  it('takes a typo in other scripts', () => {
    expect(score('мосвка', 'Москва офис')).toBeGreaterThan(0);
  });
});

describe('matchWord ranges', () => {
  it('gives the range of text found as written', () => {
    expect(match('plat', 'Engineering Platform')?.ranges).toEqual([[12, 16]]);
  });

  it('gives each letter of initials and of an abbreviation', () => {
    expect(match('ds', 'Design System')?.ranges).toEqual([
      [0, 1],
      [7, 8],
    ]);
    expect(match('crm', 'Create Room')?.ranges).toEqual([
      [0, 1],
      [7, 8],
      [10, 11],
    ]);
  });

  it('joins the letters of an abbreviation that follow each other', () => {
    expect(match('engplat', 'Engineering Platform')?.ranges).toEqual([
      [0, 3],
      [12, 16],
    ]);
  });

  it('gives the word a typo stands for', () => {
    expect(match('markdwon', 'Markdown Formatting')?.ranges).toEqual([[0, 8]]);
    expect(match('markdwo', 'Markdown Formatting')?.ranges).toEqual([[0, 7]]);
  });

  it('matches nothing for an empty word or an empty field', () => {
    expect(match('', 'Create Room')).toBeUndefined();
    expect(match('a', '')).toBeUndefined();
  });
});

/**
 * `text` prepared, with a count of the times its flags and its word starts are read: what the
 * matcher's work on a field comes to, on any machine.
 */
const counting = (text: string) => {
  const prepared = prepareText(text);
  let reads = 0;
  const counted = <T extends object>(target: T): T =>
    new Proxy(target, {
      get: (inner, key): unknown => {
        reads += 1;
        return Reflect.get(inner, key) as unknown;
      },
    });
  return {
    field: { ...prepared, flags: counted(prepared.flags), starts: counted(prepared.starts) },
    length: prepared.text.length,
    reads: () => reads,
  };
};

describe('matchWord on long text', () => {
  it('reads a long word once for a letter it holds many times', () => {
    const { field, length, reads } = counting(`b${'a'.repeat(2000)}`);

    expect(matchWord('a', field, true)).toBeDefined();
    expect(reads()).toBeLessThan(20 * length);
  });

  it('reads the words before its typos once, however many words match', () => {
    const { field, length, reads } = counting(`${'x'.repeat(2000)} ${'abcde '.repeat(300)}`);

    expect(matchWord('abcdx', field, true)).toBeDefined();
    expect(reads()).toBeLessThan(20 * length);
  });

  it('finds the next word of an abbreviation without reading the words before it', () => {
    const { field, length, reads } = counting('ab '.repeat(1000));

    expect(matchWord('abab', field, true)).toBeDefined();
    expect(reads()).toBeLessThan(20 * length);
  });

  it('compares a word of more than 64 letters only as it was typed', () => {
    const most = `a${'b'.repeat(62)}`;
    expect(match(`${most}d`, `${most}c`)).toBeDefined();

    const longer = `a${'b'.repeat(70)}`;
    expect(match(`${longer}d`, `${longer}c`)).toBeUndefined();
    expect(match(longer, `${longer}c`)).toBeDefined();

    const pasted = 'a'.repeat(10000);
    expect(match(`${pasted}d`, `${pasted}c`)).toBeUndefined();
  });

  it('takes a pasted abbreviation of thousands of letters without failing', () => {
    expect(match('ab'.repeat(5000), 'ab '.repeat(5000))).toBeUndefined();
  });
});

describe('originalRanges', () => {
  it('keeps the ranges of text that folds letter for letter', () => {
    expect(originalRanges('Café Zürich', [[5, 8]])).toEqual([[5, 8]]);
  });

  it('gives ranges that overlap or touch as one', () => {
    expect(
      originalRanges('Create Room', [
        [0, 1],
        [0, 6],
      ])
    ).toEqual([[0, 6]]);
    expect(
      originalRanges('abcd', [
        [0, 2],
        [2, 4],
      ])
    ).toEqual([[0, 4]]);
    expect(
      originalRanges('Café Zürich', [
        [0, 2],
        [1, 4],
      ])
    ).toEqual([[0, 4]]);
  });

  it('takes a combining accent with its letter', () => {
    // "e" and its accent are two characters as written and one folded.
    expect(originalRanges('Cafe\u0301 x', [[3, 4]])).toEqual([[3, 5]]);
    expect(originalRanges('Cafe\u0301 x', [[5, 6]])).toEqual([[6, 7]]);
  });

  it('takes the whole letter that folds to two', () => {
    // "ß" folds to "ss": either half of it marks the one letter.
    expect(originalRanges('Straße', [[4, 5]])).toEqual([[4, 5]]);
    expect(originalRanges('Straße', [[4, 6]])).toEqual([[4, 5]]);
    expect(originalRanges('Straße', [[6, 7]])).toEqual([[5, 6]]);
  });

  it('keeps a character of two code units whole', () => {
    // The emoji is two code units as written and folded.
    expect(originalRanges('😀 Room', [[3, 7]])).toEqual([[3, 7]]);
    expect(originalRanges('😀 Room', [[0, 2]])).toEqual([[0, 2]]);
  });

  it('gives the folded ranges of what matchWord found in text that folds shorter', () => {
    const field = 'Cafe\u0301 Français';
    const found = match('francais', field);
    expect(found && originalRanges(field, found.ranges)).toEqual([[6, 14]]);
  });
});
