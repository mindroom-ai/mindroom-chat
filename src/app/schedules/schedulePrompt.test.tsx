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

  it('supports Matrix IDs with ports, +, =, and / while stripping trailing sentence punctuation', () => {
    const { host, cleanup } = renderPrompt(
      'Notify @bot+ops=1/2:matrix.example.org:8448. Also @helper: check status!'
    );
    try {
      const mentions = [...host.querySelectorAll('.prompt-mention')].map((el) => el.textContent);
      expect(mentions).toEqual(['@bot+ops=1/2:matrix.example.org:8448', '@helper']);
      expect(host.textContent).toBe(
        'Notify @bot+ops=1/2:matrix.example.org:8448. Also @helper: check status!'
      );
    } finally {
      cleanup();
    }
  });

  it('leaves escaped backticks, double-backtick spans, and fenced JS blocks with embedded backticks verbatim', () => {
    const fenced =
      '```js\nconst fence = "```";\nconst s = `hi ${x}`;\n@decorator\n```\nThen run `npm test`.';
    const { host, cleanup } = renderPrompt(fenced);
    try {
      const codes = [...host.querySelectorAll('code.inline-code')].map((el) => el.textContent);
      expect(codes).toEqual(['npm test']);
      expect(host.querySelectorAll('.prompt-mention')).toHaveLength(0);
      expect(host.textContent).toBe(
        '```js\nconst fence = "```";\nconst s = `hi ${x}`;\n@decorator\n```\nThen run npm test.'
      );
    } finally {
      cleanup();
    }

    const inlineMulti = 'Escaped \\`not code\\` and double ``has `inner` ticks`` then `real`';
    const second = renderPrompt(inlineMulti);
    try {
      const codes = [...second.host.querySelectorAll('code.inline-code')].map(
        (el) => el.textContent
      );
      expect(codes).toEqual(['real']);
      expect(second.host.textContent).toBe(
        'Escaped \\`not code\\` and double ``has `inner` ticks`` then real'
      );
    } finally {
      second.cleanup();
    }
  });

  it('handles CRLF closing fences and multiline double-backtick spans verbatim', () => {
    const crlf = '```js\r\nconst x = `inner`;\r\n```\r\nPing @helper and run `build`';
    const first = renderPrompt(crlf);
    try {
      expect(
        [...first.host.querySelectorAll('code.inline-code')].map((el) => el.textContent)
      ).toEqual(['build']);
      expect(
        [...first.host.querySelectorAll('.prompt-mention')].map((el) => el.textContent)
      ).toEqual(['@helper']);
      expect(first.host.textContent).toBe(
        '```js\r\nconst x = `inner`;\r\n```\r\nPing @helper and run build'
      );
    } finally {
      first.cleanup();
    }

    const multiLineDouble = 'Use ``line 1 `inner`\nline 2`` then `ok`';
    const second = renderPrompt(multiLineDouble);
    try {
      expect(
        [...second.host.querySelectorAll('code.inline-code')].map((el) => el.textContent)
      ).toEqual(['ok']);
      expect(second.host.textContent).toBe('Use ``line 1 `inner`\nline 2`` then ok');
    } finally {
      second.cleanup();
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

  it('prevents an unclosed inline backtick run before a fenced block from corrupting the fence or trailing code', () => {
    const prompt = '``unclosed before\n```\n``inside`` `code`\n```\n`after`';
    const { host, cleanup } = renderPrompt(prompt);
    try {
      const codes = [...host.querySelectorAll('code.inline-code')].map((el) => el.textContent);
      expect(codes).toEqual(['after']);
      expect(host.textContent).toBe('``unclosed before\n```\n``inside`` `code`\n```\nafter');
    } finally {
      cleanup();
    }

    const mentionAfterFence = '```\nconst x = 1;\n```\n@helper check `status`';
    const second = renderPrompt(mentionAfterFence);
    try {
      expect(
        [...second.host.querySelectorAll('.prompt-mention')].map((el) => el.textContent)
      ).toEqual(['@helper']);
      expect(
        [...second.host.querySelectorAll('code.inline-code')].map((el) => el.textContent)
      ).toEqual(['status']);
      expect(second.host.textContent).toBe('```\nconst x = 1;\n```\n@helper check status');
    } finally {
      second.cleanup();
    }
  });

  it('wraps @handle mentions in <bdi dir="ltr"> for RTL-safe rendering', () => {
    const { host, cleanup } = renderPrompt('تذكّر @helper run tests');
    try {
      const mention = host.querySelector('bdi.prompt-mention');
      expect(mention).not.toBeNull();
      expect(mention?.getAttribute('dir')).toBe('ltr');
      expect(mention?.textContent).toBe('@helper');
      expect(host.textContent).toBe('تذكّر @helper run tests');
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

  it('does not treat a same-line triple-backtick span as a fenced block opener', () => {
    const prompt = '```status```\n```\necho `date`\n```\nRun `check`';
    const { host, cleanup } = renderPrompt(prompt);
    try {
      expect([...host.querySelectorAll('code.inline-code')].map((el) => el.textContent)).toEqual([
        'check',
      ]);
      expect(host.textContent).toBe('```status```\n```\necho `date`\n```\nRun check');
    } finally {
      cleanup();
    }
  });

  it('preserves tilde-fenced code blocks verbatim', () => {
    const prompt = '~~~sh\necho `date`\n~~~\nThen run `ok`';
    const { host, cleanup } = renderPrompt(prompt);
    try {
      expect([...host.querySelectorAll('code.inline-code')].map((el) => el.textContent)).toEqual([
        'ok',
      ]);
      expect(host.textContent).toBe('~~~sh\necho `date`\n~~~\nThen run ok');
    } finally {
      cleanup();
    }
  });
});
