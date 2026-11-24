// @vitest-environment jsdom
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderSchedulePrompt } from './schedulePrompt';

vi.mock('./roomSchedules.css', () => ({
  InlineCode: 'inline-code',
  PromptMention: 'prompt-mention',
}));

const renderPrompt = (prompt: string) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(<>{renderSchedulePrompt(prompt)}</>);
  });
  return {
    host,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    },
  };
};

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe('renderSchedulePrompt', () => {
  it('leaves plain text unchanged and preserves newlines', () => {
    const view = renderPrompt('Line one\nLine two');
    cleanup = view.unmount;
    expect(view.host.textContent).toBe('Line one\nLine two');
    expect(view.host.querySelectorAll('code, bdi')).toHaveLength(0);
  });

  it('renders single-line inline code spans and @mentions while trimming trailing punctuation', () => {
    const view = renderPrompt('Check `inbox` with @helper. Also ping (@alice:example.org:8448)!');
    cleanup = view.unmount;
    const codes = [...view.host.querySelectorAll('code')];
    const mentions = [...view.host.querySelectorAll('bdi')];
    expect(codes.map((el) => [el.textContent, el.getAttribute('dir'), el.className])).toEqual([
      ['inbox', 'ltr', 'inline-code'],
    ]);
    expect(mentions.map((el) => [el.textContent, el.getAttribute('dir'), el.className])).toEqual([
      ['@helper', 'ltr', 'prompt-mention'],
      ['@alice:example.org:8448', 'ltr', 'prompt-mention'],
    ]);
    expect(view.host.textContent).toBe(
      'Check inbox with @helper. Also ping (@alice:example.org:8448)!'
    );
  });

  it('ignores email addresses, mentions glued after code, and bare @ punctuation', () => {
    const view = renderPrompt('Email a@b.com or `cmd`@bot or @...');
    cleanup = view.unmount;
    expect([...view.host.querySelectorAll('code')].map((el) => el.textContent)).toEqual(['cmd']);
    expect(view.host.querySelectorAll('bdi')).toHaveLength(0);
  });

  it('keeps multi-backtick spans and fenced code blocks verbatim', () => {
    const prompt = [
      'Use ``@bot `raw` `` safely.',
      '  ```ts',
      'const x = `@ignored`;',
      '  ```',
      'Then notify @alice and run `deploy`.',
    ].join('\n');
    const view = renderPrompt(prompt);
    cleanup = view.unmount;
    expect([...view.host.querySelectorAll('code')].map((el) => el.textContent)).toEqual(['deploy']);
    expect([...view.host.querySelectorAll('bdi')].map((el) => el.textContent)).toEqual(['@alice']);
    expect(view.host.textContent).toContain('``@bot `raw` ``');
    expect(view.host.textContent).toContain('const x = `@ignored`;');
  });

  it('leaves unclosed fenced blocks verbatim to EOF', () => {
    const view = renderPrompt('Before @alice\n```\n`code` @bob');
    cleanup = view.unmount;
    expect([...view.host.querySelectorAll('bdi')].map((el) => el.textContent)).toEqual(['@alice']);
    expect(view.host.querySelectorAll('code')).toHaveLength(0);
  });
});
