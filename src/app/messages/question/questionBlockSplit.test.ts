import { describe, expect, it } from 'vitest';
import { splitQuestionBlock } from './questionBlockSplit';

const question = {
  text: 'Which **color** should the `snake_case_name` take?',
  options: [
    { key: '🔴', label: 'Red' },
    { key: '🟢', label: 'Green, *bright*' },
  ],
};

// As MindRoom renders its question text: the question, the numbered options, the instruction.
const block = [
  '<p>Which <strong>color</strong> should the <code>snake_case_name</code> take?</p>',
  '<ol>\n<li>🔴 Red</li>\n<li>🟢 Green, <em>bright</em></li>\n</ol>',
  '<p>React with an emoji or type the number to respond.</p>',
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

  it('matches a question over several paragraphs, and one without the instruction line', () => {
    const twoParagraphs = { ...question, text: 'First part.\n\nWhich color?' };
    const html =
      '<p>Intro</p><p>First part.</p>\n<p>Which color?</p><ol><li>🔴 Red</li><li>🟢 Green, bright</li></ol><p>Tail</p>';
    expect(splitQuestionBlock(html, twoParagraphs)).toEqual({
      before: '<p>Intro</p>',
      after: '<p>Tail</p>',
    });
  });

  it('finds nothing when the options or the question differ from what the reply shows', () => {
    expect(splitQuestionBlock('<p>The build is green.</p>', question)).toBeUndefined();
    expect(splitQuestionBlock(block.replace('🟢 Green', '🟡 Green'), question)).toBeUndefined();
    expect(splitQuestionBlock(block.replace('take?', 'get?'), question)).toBeUndefined();
    expect(
      splitQuestionBlock(`<p>Other text</p>${block.replace(/<p>Which.*?<\/p>/, '')}`, question)
    ).toBeUndefined();
  });
});
