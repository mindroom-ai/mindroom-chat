import { describe, expect, it } from 'vitest';
import { BLOCK_MD_RULES, CodeBlockRule } from './rules';
import { parseBlockMD, parseBlockMDWithRules } from './parser';
import { cpuNow } from '../../../test-utils/cpuNow';

const codeBlock = (text: string) => {
  const match = CodeBlockRule.match(text);
  return match && { index: match.index, parts: [...match] };
};

const timed = <T>(run: () => T): { result: T; ms: number } => {
  const start = cpuNow();
  const result = run();
  return { result, ms: cpuNow() - start };
};

describe('fenced code blocks', () => {
  it('reads the fence, the info string and the code up to the closing fence', () => {
    expect(codeBlock('Before\n```text\n---\n```\nAfter')).toEqual({
      index: 7,
      parts: ['```text\n---\n```\n', '```', 'text', '---\n'],
    });
  });

  it('closes only at a line that is exactly the same fence', () => {
    expect(codeBlock('```\na\n````\nb\n```')?.parts[3]).toBe('a\n````\nb\n');
  });

  it('allows single backticks in the info string, but not the fence', () => {
    expect(codeBlock('```foo`bar\nx\n```')?.parts[2]).toBe('foo`bar');
    expect(codeBlock('```a```\nx\n```')).toBeNull();
  });

  it('takes the first opener that closes, even when a later block closes first', () => {
    expect(codeBlock('````a\n```b\n```\n````')?.parts).toEqual([
      '````a\n```b\n```\n````',
      '````',
      'a',
      '```b\n```\n',
    ]);
    expect(codeBlock('````a\n```\nx\n```')).toEqual({
      index: 6,
      parts: ['```\nx\n```', '```', '', 'x\n'],
    });
  });

  it('rejects many unclosed fences in linear time', () => {
    const unclosed = '```a\n'.repeat(20_000);
    const { result, ms } = timed(() => codeBlock(unclosed));
    expect(result).toBeNull();
    expect(parseBlockMD(unclosed)).toBe(unclosed.split('\n').join('<br/>'));
    expect(ms).toBeLessThan(1000);
  });

  it('pairs fences once per parse, so blocks after an unclosed fence stay linear', () => {
    // Each `````a` never closes; each ``` closes the one before it and opens the next block.
    const text = '````a\n```\n'.repeat(6_000);
    const { result, ms } = timed(() => parseBlockMD(text));
    expect(result).toBe('````a<br/><pre data-md="```"><code>````a\n</code></pre>'.repeat(3_000));
    expect(ms).toBeLessThan(1000);
  });

  it.each([
    '````a\n```\nx\n```\n````\n',
    '```\na\n$$\n```\n$$\n```\n',
    '$$\n```\n$$\n```\ny\n```\n',
    '# h\n```\ncode\n```\n> q\n```js\nz\n```',
    '- item\n```\n- not item\n```\n```\n',
    '````a\n```\n```\n````\n```\n',
  ])('finds the same blocks in one pass as by searching each rest: %j', (text) => {
    const searchEachRest = BLOCK_MD_RULES.map((rule) => ({ match: rule.match, html: rule.html }));
    expect(parseBlockMD(text)).toBe(parseBlockMDWithRules(text, searchEachRest));
  });

  it('renders many code blocks in linear time', () => {
    const blocks = '```\nx\n```\n'.repeat(5_000);
    const { result, ms } = timed(() => parseBlockMD(blocks));
    expect(result.match(/<pre data-md="```"><code>x\n<\/code><\/pre>/g)).toHaveLength(5_000);
    expect(ms).toBeLessThan(1000);
  });
});

describe('headings', () => {
  it.each([
    ['## Title ##', '<h2 data-md="##">Title</h2>'],
    ['# Title   ', '<h1 data-md="#">Title</h1>'],
    ['# C#', '<h1 data-md="#">C#</h1>'],
    ['# a #b', '<h1 data-md="#">a #b</h1>'],
    ['# #', '<h1 data-md="#">#</h1>'],
    ['####### seven', '####### seven'],
  ])('renders %j', (markdown, html) => {
    expect(parseBlockMD(markdown)).toBe(html);
  });

  it('handles long runs of whitespace inside a heading in linear time', () => {
    const spaces = ' '.repeat(100_000);
    const { result, ms } = timed(() => [
      parseBlockMD(`# a${spaces}b`),
      parseBlockMD(`# a${' \t'.repeat(50_000)}x`),
      parseBlockMD(`# a${spaces}#${spaces}`),
    ]);
    expect(result[0]).toBe(`<h1 data-md="#">a${spaces}b</h1>`);
    expect(result[1]).toBe(`<h1 data-md="#">a${' \t'.repeat(50_000)}x</h1>`);
    expect(result[2]).toBe('<h1 data-md="#">a</h1>');
    expect(ms).toBeLessThan(1000);
  });
});
