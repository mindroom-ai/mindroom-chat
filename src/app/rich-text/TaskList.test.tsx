// @vitest-environment jsdom
import parseDOM from 'html-dom-parser';
import { isTag, isText, type Element } from 'domhandler';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskListItem, extractTaskListItem } from './TaskList';

afterEach(cleanup);

const parseLi = (html: string): Element => {
  const [node] = parseDOM(html);
  if (!node || !isTag(node) || node.name !== 'li') {
    throw new Error(`Expected <li> root, got: ${html}`);
  }
  return node;
};

describe('extractTaskListItem', () => {
  it.each<[string, boolean, string]>([
    ['<li>[x] Ship widget</li>', true, 'Ship widget'],
    ['<li>[X] Update docs</li>', true, 'Update docs'],
    ['<li>[ ] Review draft</li>', false, 'Review draft'],
    ['<li>\n  [x] Pretty HTML</li>', true, 'Pretty HTML'],
  ])('extracts tight task item %s', (html, checked, text) => {
    const result = extractTaskListItem(parseLi(html).children);
    expect(result?.checked).toBe(checked);
    expect(result?.bodyNodes).toHaveLength(1);
    const first = result?.bodyNodes[0];
    expect(first && isText(first) && first.data).toBe(text);
  });

  it('keeps sibling inline tags intact when marker text node ends right after space', () => {
    const codeItem = extractTaskListItem(parseLi('<li>[ ] <code>run-checks</code></li>').children);
    expect(codeItem?.checked).toBe(false);
    expect(codeItem?.bodyNodes).toHaveLength(1);
    expect(
      codeItem?.bodyNodes[0] && isTag(codeItem.bodyNodes[0]) && codeItem.bodyNodes[0].name
    ).toBe('code');

    const linkItem = extractTaskListItem(
      parseLi('<li>[X] <a href="https://example.com/guide">Guide</a></li>').children
    );
    expect(linkItem?.checked).toBe(true);
    expect(linkItem?.bodyNodes).toHaveLength(1);
    expect(
      linkItem?.bodyNodes[0] && isTag(linkItem.bodyNodes[0]) && linkItem.bodyNodes[0].name
    ).toBe('a');
  });

  it('extracts loose items with paragraphs and nested lists', () => {
    const multiPara = extractTaskListItem(
      parseLi('<li>\n<p>[x] First line</p>\n<p>Second line</p>\n</li>').children
    );
    expect(multiPara?.checked).toBe(true);
    const paraTags = (multiPara?.bodyNodes ?? []).filter(isTag);
    expect(paraTags.map((n) => n.name)).toEqual(['p', 'p']);
    expect(
      paraTags[0]?.children[0] && isText(paraTags[0].children[0]) && paraTags[0].children[0].data
    ).toBe('First line');

    const withSublist = extractTaskListItem(
      parseLi('<li><p>[ ] <code>run-checks</code></p><ul><li>Sub</li></ul></li>').children
    );
    expect(withSublist?.checked).toBe(false);
    const tags = (withSublist?.bodyNodes ?? []).filter(isTag);
    expect(tags.map((n) => n.name)).toEqual(['p', 'ul']);
    expect(tags[0]?.children[0] && isTag(tags[0].children[0]) && tags[0].children[0].name).toBe(
      'code'
    );
  });

  it.each([
    '<li><a href="https://example.com">x</a></li>',
    '<li>[x](https://example.com)</li>',
    '<li>[x]word</li>',
    '<li><code>[x]</code> foo</li>',
    '<li><p><code>[x]</code> foo</p></li>',
    '<li>[x]</li>',
    '<li>[ ] </li>',
    '<li>[y] unknown marker</li>',
  ])('returns undefined for non-task item %s', (html) => {
    expect(extractTaskListItem(parseLi(html).children)).toBeUndefined();
  });

  it('does not mutate input DOM nodes and is idempotent for tight and loose items', () => {
    const tight = parseLi('<li>[x] Keep <code>flag</code></li>');
    const tightText = tight.children[0] as { data: string };
    expect(extractTaskListItem(tight.children)?.checked).toBe(true);
    expect(extractTaskListItem(tight.children)?.checked).toBe(true);
    expect(tightText.data).toBe('[x] Keep ');

    const loose = parseLi('<li><p>[x] Keep <code>flag</code></p><p>More</p></li>');
    const originalP = loose.children[0] as Element;
    const originalFirstText = (originalP.children[0] as { data: string }).data;
    const first = extractTaskListItem(loose.children);
    const second = extractTaskListItem(loose.children);
    expect((originalP.children[0] as { data: string }).data).toBe(originalFirstText);
    expect(first?.bodyNodes[0]).not.toBe(originalP);
    expect(second?.bodyNodes[0]).not.toBe(originalP);
  });
});

describe('TaskListItem', () => {
  it.each([true, false])('renders a disabled accessible checkbox when checked=%s', (checked) => {
    render(
      <ul>
        <TaskListItem checked={checked}>Verify release notes</TaskListItem>
      </ul>
    );
    const checkbox = screen.getByRole<HTMLInputElement>('checkbox', {
      name: 'Verify release notes',
    });
    expect(checkbox.checked).toBe(checked);
    expect(checkbox.disabled).toBe(true);
  });
});
