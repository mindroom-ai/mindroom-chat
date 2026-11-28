import { describe, expect, it } from 'vitest';
import { isText, type ChildNode } from 'domhandler';
import { sanitizeCustomHtml, sanitizeText } from '../../rich-text/sanitize';
import { getReplySlot, parseRenderedHtml } from '../agent-run/replyDom';
import { isDomElementNode } from '../agent-run/toolRefDom';
import { formatMarkdownTextBodyAsHtml } from '../html/blocks';
import { placeQuestionCardInDom } from './questionBlockSplit';
import type { InteractiveQuestion } from '../../matrix/protocol/interactiveQuestion';

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'wbr']);
const serializeDom = (nodes: readonly ChildNode[]): string =>
  nodes
    .map((node) => {
      if (isText(node)) return sanitizeText(node.data);
      if (!isDomElementNode(node)) return '';
      const attrs = Object.entries(node.attribs)
        .map(([name, value]) => ` ${name}="${sanitizeText(value)}"`)
        .join('');
      return VOID_TAGS.has(node.name)
        ? `<${node.name}${attrs}>`
        : `<${node.name}${attrs}>${serializeDom(node.children)}</${node.name}>`;
    })
    .join('');

const splitQuestionHtml = (html: string | undefined, question: InteractiveQuestion) => {
  if (!html) return undefined;
  const placed = placeQuestionCardInDom(parseRenderedHtml(sanitizeCustomHtml(html), {}), question);
  if (!placed) return undefined;
  const slotIndex = placed.findIndex((node) => getReplySlot(node)?.kind === 'questionCard');
  expect(slotIndex).toBeGreaterThanOrEqual(0);
  expect(placed.filter((node) => getReplySlot(node)?.kind === 'questionCard')).toHaveLength(1);
  return {
    before: serializeDom(placed.slice(0, slotIndex)),
    after: serializeDom(placed.slice(slotIndex + 1)),
  };
};

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

describe('placeQuestionCardInDom', () => {
  it('replaces a question that ends the reply with a questionCard slot', () => {
    expect(splitQuestionHtml(`<p>The build is green.</p>\n${block}`, question)).toEqual({
      before: '<p>The build is green.</p>',
      after: '',
    });
  });

  it('keeps the text on both sides of a question in the middle', () => {
    const split = splitQuestionHtml(
      `<h2>Status</h2>\n${block}\n<p>More <b>after</b>.</p>`,
      question
    );
    expect(split).toEqual({ before: '<h2>Status</h2>', after: '<p>More <b>after</b>.</p>' });
  });

  it('matches a question over several paragraphs', () => {
    const twoParagraphs = { ...question, text: 'First part.\n\nWhich color?' };
    const html = `<p>Intro</p><p>First part.</p>\n<p>Which color?</p>${OPTIONS}${INSTRUCTION}<p>Tail</p>`;
    expect(splitQuestionHtml(html, twoParagraphs)).toEqual({
      before: '<p>Intro</p>',
      after: '<p>Tail</p>',
    });
  });

  it('takes the last block, not an example before it with other symbols or no instruction', () => {
    const greater = { ...question, text: 'Deploy if x > 0?' };
    const asked = `<p>Deploy if x &gt; 0?</p>${OPTIONS}${INSTRUCTION}`;
    expect(splitQuestionHtml(`<p>Deploy if x &lt; 0?</p>${OPTIONS}${INSTRUCTION}`, greater)).toBe(
      undefined
    );
    const example = `<p>Deploy if x &gt; 0?</p>${OPTIONS}<p>Like that.</p>`;
    expect(splitQuestionHtml(`${example}${asked}<p>Tail</p>`, greater)).toEqual({
      before: example,
      after: '<p>Tail</p>',
    });
    const quoted = `${asked}<p>Between</p>${asked}`;
    expect(splitQuestionHtml(quoted, greater)?.before).toBe(`${asked}<p>Between</p>`);
  });

  it('finds nothing when the reply holds more than the question, or other options', () => {
    const image = '<img src="mxc://example.org/abc" alt="chart">';
    expect(splitQuestionHtml(block.replace('\n<ol>', `<p>${image}</p><ol>`), question)).toBe(
      undefined
    );
    expect(splitQuestionHtml(block.replace('take?', `take? ${image}`), question)).toBe(undefined);
    expect(splitQuestionHtml(block.replace(INSTRUCTION, ''), question)).toBeUndefined();
    expect(splitQuestionHtml(block.replace('</ol>', '</ol>stray'), question)).toBeUndefined();
    expect(splitQuestionHtml(block.replace('🟢 Green', '🟡 Green'), question)).toBeUndefined();
    expect(splitQuestionHtml(block.replace('take?', 'get?'), question)).toBeUndefined();
    expect(splitQuestionHtml('<p>The build is green.</p>', question)).toBeUndefined();
  });
});

describe('placeQuestionCardInDom on the HTML the app formats from a body-only reply', () => {
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
  const split = (body: string) => splitQuestionHtml(formatMarkdownTextBodyAsHtml(body), asked);

  it('finds the block in its line-break layout, the text around it kept as formatted', () => {
    const html =
      'The main choice:<br/><br/>Which order should the work take? I recommend tests first (80%).' +
      '<br/><br/><ol data-md="1."><li>🗳️ Tests first, then the code</li><li>⏸️ Park it for now</li>' +
      '</ol><br/>React with an emoji or type the number to respond.<br/><br/>' +
      '<strong data-md="**">TL;DR:</strong> soon.';
    expect(formatMarkdownTextBodyAsHtml(`The main choice:\n\n${BLOCK}\n\n**TL;DR:** soon.`)).toBe(
      html
    );
    expect(splitQuestionHtml(html, asked)).toEqual({
      before: 'The main choice:',
      after: '<strong data-md="**">TL;DR:</strong> soon.',
    });
    expect(split(BLOCK)).toEqual({ before: '', after: '' });
  });

  it('takes the real block, and leaves a copy in a code fence as code', () => {
    const fenced = `\`\`\`text\n${BLOCK}\n\`\`\``;
    const result = split(`${BLOCK}\n\nAn example:\n\n${fenced}`);
    expect(result?.before).toBe('');
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
