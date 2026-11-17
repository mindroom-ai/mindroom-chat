import { describe, expect, it } from 'vitest';
import { splitQuestionBlock } from './questionBlockSplit';

const question = {
  text: 'Which **color** should the `snake_case_name` take?',
  options: [
    { key: '🔴', label: 'Red' },
    { key: '🟢', label: 'Green, *bright*' },
  ],
};

const OPTIONS = '<ol>\n<li>🔴 Red</li>\n<li>🟢 Green, <em>bright</em></li>\n</ol>';
const INSTRUCTION = '<p>React with an emoji or type the number to respond.</p>';
// As MindRoom renders its question text: the question, the numbered options, the instruction.
const block = [
  '<p>Which <strong>color</strong> should the <code>snake_case_name</code> take?</p>',
  OPTIONS,
  INSTRUCTION,
].join('\n');

describe('splitQuestionBlock', () => {
  it('splits off the text before a question that ends the reply', () => {
    expect(splitQuestionBlock(`<p>The build is green.</p>\n${block}`, question)).toEqual({
      before: '<p>The build is green.</p>\n',
      after: '',
    });
  });

  it('keeps the text on both sides of a question in the middle', () => {
    const split = splitQuestionBlock(
      `<h2>Status</h2>\n${block}\n<p>More <b>after</b>.</p>`,
      question
    );
    expect(split).toEqual({ before: '<h2>Status</h2>\n', after: '\n<p>More <b>after</b>.</p>' });
  });

  it('matches a question over several paragraphs', () => {
    const twoParagraphs = { ...question, text: 'First part.\n\nWhich color?' };
    const html = `<p>Intro</p><p>First part.</p>\n<p>Which color?</p>${OPTIONS}${INSTRUCTION}<p>Tail</p>`;
    expect(splitQuestionBlock(html, twoParagraphs)).toEqual({
      before: '<p>Intro</p>',
      after: '<p>Tail</p>',
    });
  });

  it('takes the last block, not an example before it with other symbols or no instruction', () => {
    const greater = { ...question, text: 'Deploy if x > 0?' };
    const asked = `<p>Deploy if x &gt; 0?</p>${OPTIONS}${INSTRUCTION}`;
    expect(splitQuestionBlock(`<p>Deploy if x &lt; 0?</p>${OPTIONS}${INSTRUCTION}`, greater)).toBe(
      undefined
    );
    const example = `<p>Deploy if x &gt; 0?</p>${OPTIONS}<p>Like that.</p>`;
    expect(splitQuestionBlock(`${example}${asked}<p>Tail</p>`, greater)).toEqual({
      before: example,
      after: '<p>Tail</p>',
    });
    const quoted = `${asked}<p>Between</p>${asked}`;
    expect(splitQuestionBlock(quoted, greater)?.before).toBe(`${asked}<p>Between</p>`);
  });

  it('finds nothing when the reply holds more than the question, or other options', () => {
    const image = '<img src="mxc://example.org/abc" alt="chart">';
    expect(splitQuestionBlock(block.replace('\n<ol>', `<p>${image}</p><ol>`), question)).toBe(
      undefined
    );
    expect(splitQuestionBlock(block.replace('take?', `take? ${image}`), question)).toBe(undefined);
    expect(splitQuestionBlock(block.replace(INSTRUCTION, ''), question)).toBeUndefined();
    expect(splitQuestionBlock(block.replace('</ol>', '</ol>stray'), question)).toBeUndefined();
    expect(splitQuestionBlock(block.replace('🟢 Green', '🟡 Green'), question)).toBeUndefined();
    expect(splitQuestionBlock(block.replace('take?', 'get?'), question)).toBeUndefined();
    expect(splitQuestionBlock('<p>The build is green.</p>', question)).toBeUndefined();
  });
});
