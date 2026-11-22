// @vitest-environment jsdom
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { renderSchedulePrompt } from './schedulePrompt';

vi.mock('./roomSchedules.css', () => ({
  InlineCode: 'inline-code',
  PromptMention: 'prompt-mention',
}));

const renderPrompt = (prompt: string) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('p');
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(<>{renderSchedulePrompt(prompt)}</>);
  });
  return {
    host,
    cleanup: () => {
      act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    },
  };
};

describe('renderSchedulePrompt', () => {
  it('highlights @mentions while keeping exact textContent', () => {
    const { host, cleanup } = renderPrompt('@helper remind me to stretch');
    try {
      expect(host.textContent).toBe('@helper remind me to stretch');
      const mentions = host.querySelectorAll('.prompt-mention');
      expect(mentions).toHaveLength(1);
      expect(mentions[0]!.textContent).toBe('@helper');
    } finally {
      cleanup();
    }
  });

  it('renders single-line inline code spans without raw backticks and ignores mentions inside them', () => {
    const { host, cleanup } = renderPrompt('Run `check @internal` and ping @alice:example.org.');
    try {
      const code = host.querySelectorAll('code.inline-code');
      expect(code).toHaveLength(1);
      expect(code[0]!.textContent).toBe('check @internal');
      const mentions = host.querySelectorAll('.prompt-mention');
      expect(mentions).toHaveLength(1);
      expect(mentions[0]!.textContent).toBe('@alice:example.org');
      expect(host.textContent).toBe('Run check @internal and ping @alice:example.org.');
    } finally {
      cleanup();
    }
  });

  it('ignores email addresses, multi-line backticks, and handles glued to closing backticks', () => {
    const { host, cleanup } = renderPrompt(
      'Email user@example.org, `cmd`@glued then (@helper)\n`open\nclose`'
    );
    try {
      expect(host.querySelectorAll('code.inline-code')).toHaveLength(1);
      expect(host.querySelector('code.inline-code')!.textContent).toBe('cmd');
      const mentions = host.querySelectorAll('.prompt-mention');
      expect(mentions).toHaveLength(1);
      expect(mentions[0]!.textContent).toBe('@helper');
      expect(host.textContent).toContain('`open\nclose`');
    } finally {
      cleanup();
    }
  });

  it('preserves newlines across plain text and multiple mentions', () => {
    const { host, cleanup } = renderPrompt('Line one with @alpha\nLine two with @beta');
    try {
      expect(host.textContent).toBe('Line one with @alpha\nLine two with @beta');
      expect([...host.querySelectorAll('.prompt-mention')].map((el) => el.textContent)).toEqual([
        '@alpha',
        '@beta',
      ]);
    } finally {
      cleanup();
    }
  });
});
