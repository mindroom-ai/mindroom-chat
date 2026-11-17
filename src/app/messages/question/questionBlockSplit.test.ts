import { describe, expect, it } from 'vitest';
import { formatMarkdownTextBodyAsHtml } from '../html/blocks';
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
      before: '<p>The build is green.</p>',
      after: '',
    });
  });

  it('keeps the text on both sides of a question in the middle', () => {
    const split = splitQuestionBlock(
      `<h2>Status</h2>\n${block}\n<p>More <b>after</b>.</p>`,
      question
    );
    expect(split).toEqual({ before: '<h2>Status</h2>', after: '<p>More <b>after</b>.</p>' });
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

describe('splitQuestionBlock on the HTML the app formats from a body-only reply', () => {
  const asked = {
    text: 'Which order should the work take? I recommend tests first (80%).',
    options: [
      { key: '🗳️', label: 'Tests first, then the code' },
      { key: '⏸️', label: 'Park it for now' },
    ],
  };
  // As MindRoom writes the block into the body (`_render_question_text`).
  const BLOCK = [
    asked.text,
    '',
    '1. 🗳️ Tests first, then the code',
    '2. ⏸️ Park it for now',
    '',
    'React with an emoji or type the number to respond.',
  ].join('\n');
  const split = (body: string) => splitQuestionBlock(formatMarkdownTextBodyAsHtml(body), asked);

  it('finds the block in its line-break layout, the text around it kept as formatted', () => {
    const html =
      'The main choice:<br/><br/>Which order should the work take? I recommend tests first (80%).' +
      '<br/><br/><ol data-md="1."><li>🗳️ Tests first, then the code</li><li>⏸️ Park it for now</li>' +
      '</ol><br/>React with an emoji or type the number to respond.<br/><br/>' +
      '<strong data-md="**">TL;DR:</strong> soon.';
    expect(formatMarkdownTextBodyAsHtml(`The main choice:\n\n${BLOCK}\n\n**TL;DR:** soon.`)).toBe(
      html
    );
    expect(splitQuestionBlock(html, asked)).toEqual({
      before: 'The main choice:',
      after: '<strong data-md="**">TL;DR:</strong> soon.',
    });
    expect(split(BLOCK)).toEqual({ before: '', after: '' });
  });

  it('takes the real block, and leaves a copy in a code fence as code', () => {
    const fenced = `\`\`\`text\n${BLOCK}\n\`\`\``;
    const result = split(`${BLOCK}\n\nAn example:\n\n${fenced}`);
    expect(result?.before).toBe('');
    // The parts are the formatter's nodes, written out again as the fold of finished work does.
    expect(result?.after).toMatch(/^An example:<br><br><pre[^>]*><code[^>]*>Which order/);
  });

  it('finds nothing when the only copy is in a fence, display math or a quote', () => {
    expect(split(`Before.\n\n\`\`\`text\n${BLOCK}\n\`\`\`\n\nAfter.`)).toBeUndefined();
    expect(split(`~~~\n${BLOCK}\n~~~`)).toBeUndefined();
    expect(split(`$$\n${BLOCK}\n$$`)).toBeUndefined();
    expect(
      split(
        BLOCK.split('\n')
          .map((line) => `> ${line}`)
          .join('\n')
      )
    ).toBeUndefined();
  });

  it('finds nothing when a line of the block is joined to other text', () => {
    expect(split(`See:\n${BLOCK}`)).toBeUndefined();
    expect(split(`${BLOCK}\nAnd more.`)).toBeUndefined();
    expect(split(BLOCK.replace('\n\nReact', '\n\nStop.\n\nReact'))).toBeUndefined();
  });
});
