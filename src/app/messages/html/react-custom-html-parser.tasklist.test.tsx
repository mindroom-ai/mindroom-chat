// @vitest-environment jsdom
import parse from 'html-react-parser';
import MarkdownIt from 'markdown-it';
import type { MatrixClient } from 'matrix-js-sdk';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LINKIFY_OPTS, getReactCustomHtmlParser } from './react-custom-html-parser';
import * as customHtmlCss from '../../rich-text/CustomHtml.css';
import * as taskListCss from '../../rich-text/TaskList.css';
import { sanitizeCustomHtml } from '../../rich-text/sanitize';

afterEach(cleanup);

const md = new MarkdownIt({ breaks: true });

const mx = {
  getUserId: () => '@viewer:example.org',
  getRoom: () => undefined,
  getHomeserverUrl: () => 'https://matrix.example',
  mxcUrlToHttp: (url: string) => url,
} as unknown as MatrixClient;

const renderMessageHtml = (html: string) => {
  const sanitized = sanitizeCustomHtml(html);
  const opts = getReactCustomHtmlParser(mx, undefined, { linkifyOpts: LINKIFY_OPTS });
  return render(<div>{parse(sanitized, opts)}</div>);
};

describe('GFM task lists in custom HTML parser', () => {
  it('renders tight markdown task lists including leading inline tags', () => {
    const markdown = [
      '- [x] Done task',
      '- [ ] `run-checks`',
      '- [X] [Guide](https://example.com/guide)',
    ].join('\n');
    const { container } = renderMessageHtml(md.render(markdown));

    const ul = container.querySelector('ul');
    expect(ul?.className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        ...customHtmlCss.List.split(/\s+/),
        ...taskListCss.TaskList.split(/\s+/),
      ])
    );

    const done = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Done task' });
    const cmd = screen.getByRole<HTMLInputElement>('checkbox', { name: 'run-checks' });
    const guide = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Guide' });
    expect(done.checked).toBe(true);
    expect(done.disabled).toBe(true);
    expect(cmd.checked).toBe(false);
    expect(guide.checked).toBe(true);
    expect(container.querySelector('code')?.textContent).toBe('run-checks');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com/guide');
  });

  it('renders loose durable HTML task items with multiple paragraphs and nested lists', () => {
    const html = [
      '<ul>',
      '<li><p>[x] First paragraph</p><p>Follow-up detail</p></li>',
      '<li><p>[ ] <code>build-step</code></p><ul><li>[x] Nested child</li></ul></li>',
      '</ul>',
    ].join('');
    const { container } = renderMessageHtml(html);

    const checkboxes = screen.getAllByRole<HTMLInputElement>('checkbox');
    expect(checkboxes.map((box) => box.checked)).toEqual([true, false, true]);
    expect(container.textContent).toContain('Follow-up detail');
    expect(container.querySelectorAll('ul')).toHaveLength(2);
    for (const ul of container.querySelectorAll('ul')) {
      expect(ul.classList.contains(taskListCss.TaskList)).toBe(true);
    }
  });

  it('keeps normal ul padding on mixed lists while styling task items without bullets', () => {
    const { container } = renderMessageHtml(md.render('- Plain bullet\n- [x] Checked task'));
    const ul = container.querySelector('ul');
    expect(ul?.classList.contains(taskListCss.TaskList)).toBe(false);
    const items = container.querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0]?.classList.contains(taskListCss.TaskListItem)).toBe(false);
    expect(items[1]?.classList.contains(taskListCss.TaskListItem)).toBe(true);
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('handles task lists nested inside regular bullets and leaves ordered lists numbered', () => {
    const markdown = ['- Parent bullet', '  - [x] Nested task', '', '1. [x] Ordered step'].join(
      '\n'
    );
    const { container } = renderMessageHtml(md.render(markdown));

    const lists = container.querySelectorAll('ul');
    expect(lists[0]?.classList.contains(taskListCss.TaskList)).toBe(false);
    expect(lists[1]?.classList.contains(taskListCss.TaskList)).toBe(true);
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(container.querySelector('ol li')?.textContent).toBe('[x] Ordered step');
  });

  it('leaves footnote list items and non-task syntax untouched', () => {
    const html = [
      '<ul>',
      '<li id="fn1" class="footnote-item">[x] Footnote body</li>',
      '<li>[x](https://example.com)</li>',
      '<li>[x]word</li>',
      '<li><code>[x]</code> literal</li>',
      '</ul>',
    ].join('');
    const { container } = renderMessageHtml(html);

    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(container.querySelector('ul')?.classList.contains(taskListCss.TaskList)).toBe(false);
    expect(container.querySelector('li[tabindex="-1"]')?.textContent).toBe('[x] Footnote body');
  });
});
