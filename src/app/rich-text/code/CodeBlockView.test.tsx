// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CodeBlockView } from './CodeBlockView';
import { MAX_TEXT_HIGHLIGHT_LENGTH } from './codeHighlightLimits';

const copyToClipboard = vi.hoisted(() => vi.fn<(text: string) => Promise<boolean>>());

vi.mock('../../lib/dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/dom')>()),
  copyToClipboard,
}));
vi.mock('../CustomHtml.css', () =>
  Object.fromEntries(
    [
      'MarginSpaced',
      'CodeBlock',
      'CodeBlockHeader',
      'CodeBlockLabel',
      'CodeBlockLabelText',
      'CodeBlockLanguageIcon',
      'CodeBlockActions',
      'CodeBlockAction',
      'CodeBlockActionIcon',
      'CodeBlockScroll',
      'CodeBlockInternal',
      'CodeBlockBottomShadow',
      'CodeBlockDiff',
      'DiffLine',
      'DiffMeta',
      'DiffAdded',
      'DiffRemoved',
    ].map((name) => [name, name])
  )
);

afterEach(cleanup);

const readCode = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('pre code#code-block-content')!;

it('tones full rows for additions, removals and diff metadata without changing spacing', () => {
  const meta = [
    'diff --git a/orbit.txt b/orbit.txt',
    'index 2468ace..1234abc 100644',
    'old mode 100644',
    'new file mode 100755',
    'similarity index 88%',
    'rename from orbit.txt',
    'copy to orbit-copy.txt',
    'Binary files differ',
    'GIT binary patch',
    '--- a/orbit.txt',
    '+++ b/orbit.txt',
    '@@ -1,3 +1,3 @@',
    '\\ No newline at end of file',
  ];
  const source = [...meta, '-  before', '+\tafter  ', '  context', ''].join('\n');
  const { container } = render(<CodeBlockView source={source} language="DiFf" />);
  const code = readCode(container);

  expect(Array.from(code.children, (row) => row.className)).toEqual([
    ...meta.map(() => 'DiffLine DiffMeta'),
    'DiffLine DiffRemoved',
    'DiffLine DiffAdded',
    'DiffLine',
    'DiffLine',
  ]);
  expect(code.textContent).toBe(source);
});

it('reveals direction controls in an LTR diff and copies its exact raw source', async () => {
  const source = '+ note \u202Etxt\u202C\r\n+\tend  \r\n';
  copyToClipboard.mockResolvedValueOnce(true);
  const { container } = render(
    <div dir="rtl">
      <CodeBlockView source={source} language="diff" label={'orbit\u202E.patch'} />
    </div>
  );
  const code = readCode(container);

  expect(code.closest('pre')?.hasAttribute('dir')).toBe(false);
  expect(code.dir).toBe('ltr');
  expect(code.textContent).toBe('+ note <U+202E>txt<U+202C>\r\n+\tend  \r\n');
  expect(screen.getByText('orbit<U+202E>.patch')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy());
  expect(copyToClipboard).toHaveBeenCalledExactlyOnceWith(source);
});

it('does not override frame or code direction for a non-diff Markdown block', () => {
  const { container } = render(
    <div dir="rtl">
      <CodeBlockView source="const data = 1;" language="js" />
    </div>
  );
  const code = readCode(container);

  expect(code.closest('pre')?.hasAttribute('dir')).toBe(false);
  expect(code.hasAttribute('dir')).toBe(false);
});

it('uses the supplied collapse size and keeps the diff scroller keyboard reachable when unwrapped', () => {
  const { container } = render(
    <CodeBlockView
      source={`+${'x'.repeat(160)}`}
      language="diff"
      embedded
      collapsedLines={1}
      longLinesThreshold={2}
      headerExtraActions={<button type="button">Open preview</button>}
    />
  );
  const code = readCode(container);
  const pre = code.closest('pre');
  const scroller = screen.getByRole('region', { name: 'Code' });
  const group = screen.getByRole('group', { name: 'Code block actions' });
  const wrap = within(group).getByRole('button', { name: 'Wrap lines' });

  expect(pre?.hasAttribute('data-code-block-embedded')).toBe(true);
  expect(group.hasAttribute('data-code-block-actions')).toBe(true);
  expect(within(group).getByRole('button', { name: 'Open preview' })).toBeTruthy();
  expect(pre?.dataset.wrap).toBe('true');
  expect(code.style.whiteSpace).toBe('pre-wrap');
  expect(scroller.style.maxHeight).toBe('1.5em');
  expect(within(group).getByRole('button', { name: 'Expand' })).toBeTruthy();

  fireEvent.click(wrap);

  expect(pre?.dataset.wrap).toBe('false');
  expect(wrap.getAttribute('aria-pressed')).toBe('false');
  expect(code.style.whiteSpace).toBe('pre');
  expect(scroller.style.maxHeight).toBe('');
  expect(scroller.tabIndex).toBe(0);
  expect(code.parentElement).toBe(scroller);
  expect(within(group).queryByRole('button', { name: 'Expand' })).toBeNull();
});

it('shows a custom search body instead of diff rows', () => {
  const { container } = render(
    <CodeBlockView source="+found" language="diff" customBody={<mark>+found</mark>} />
  );

  expect(readCode(container).querySelector('mark')?.textContent).toBe('+found');
  expect(readCode(container).querySelector('.DiffLine')).toBeNull();
});

it.each(['diff', 'js'])(
  'shows overlarge %s source without building highlight spans',
  (language) => {
    const data = 'x'.repeat(MAX_TEXT_HIGHLIGHT_LENGTH);
    const source = language === 'diff' ? `+${data}` : `const data = '${data}';`;
    const { container } = render(<CodeBlockView source={source} language={language} />);
    const code = readCode(container);

    expect(code.textContent).toBe(source);
    expect(code.childElementCount).toBe(0);
  }
);
