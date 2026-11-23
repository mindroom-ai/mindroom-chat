import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_TEXT_HIGHLIGHT_LENGTH, TextViewer } from './TextViewer';

const copyToClipboard = vi.hoisted(() => vi.fn(async (_text: string) => true));

vi.mock('folds', async () => {
  const actual = await vi.importActual<typeof import('folds')>('folds');
  return {
    ...actual,
    Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Icon: () => null,
    Text: ({ children, title }: { children?: React.ReactNode; title?: string }) => (
      <span title={title}>{children}</span>
    ),
  };
});
vi.mock('../../ui/glass/GlassPrimitives', () => {
  const button = ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  );
  return {
    Chip: button,
    Header: ({ children }: { children?: React.ReactNode }) => <header>{children}</header>,
    IconButton: button,
  };
});
vi.mock('../../ui/page/PageScroll', () => ({
  PageScroll: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../lib/dom', () => ({ copyToClipboard }));
vi.mock('./TextViewer.css', () => ({
  TextViewer: 'TextViewer',
  TextViewerContent: 'TextViewerContent',
  TextViewerHeader: 'TextViewerHeader',
  TextViewerPre: 'TextViewerPre',
}));

const CONTROL = /[؜‎‏‪-‮⁦-⁩]/;

const collectText = (node: ReactTestInstance | string): string => {
  if (typeof node === 'string') return node;
  return node.children.map((child) => collectText(child)).join('');
};

describe('TextViewer', () => {
  beforeEach(() => {
    copyToClipboard.mockClear();
  });

  it('shows the name and text with their controls as code points and copies the text as it is', async () => {
    const text = 'first line\necho hi ‮; rm -rf data #‬ done\n';
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <TextViewer name={'report‮txt.exe'} langName="text" text={text} requestClose={vi.fn()} />
      );
    });

    const name = renderer.root.findByProps({ title: 'report<U+202E>txt.exe' });
    expect(name.props.children).toBe('report<U+202E>txt.exe');
    const code = renderer.root.findByType('code');
    expect(code.props.children).toBe('first line\necho hi <U+202E>; rm -rf data #<U+202C> done\n');
    expect(JSON.stringify(renderer.toJSON())).not.toMatch(CONTROL);

    const copyAll = renderer.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === undefined);
    await act(async () => {
      copyAll?.props.onClick();
    });
    expect(copyToClipboard).toHaveBeenCalledWith(text);
    renderer.unmount();
  });

  it('renders Prism syntax tokens for a known language', () => {
    const codeText = 'def moisture_ok(level):\n    return level > 42\n';
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <TextViewer name="sensor.py" langName="python" text={codeText} requestClose={vi.fn()} />
      );
    });

    const code = renderer.root.findByType('code');
    const tokens = code
      .findAllByType('span')
      .filter((span) => String(span.props.className ?? '').includes('token'));
    expect(tokens.length).toBeGreaterThan(0);
    expect(collectText(code)).toBe(codeText);
    renderer.unmount();
  });

  it('reveals bidi controls inside Prism-highlighted text while Copy All copies raw text', async () => {
    const text = '{"sensor":"greenhouse‮_alert‬","reading":24}';
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <TextViewer name="reading.json" langName="json" text={text} requestClose={vi.fn()} />
      );
    });

    const code = renderer.root.findByType('code');
    const tokens = code
      .findAllByType('span')
      .filter((span) => String(span.props.className ?? '').includes('token'));
    expect(tokens.length).toBeGreaterThan(0);
    expect(collectText(code)).toContain('<U+202E>');
    expect(collectText(code)).toContain('<U+202C>');
    expect(JSON.stringify(renderer.toJSON())).not.toMatch(CONTROL);

    const copyAll = renderer.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === undefined);
    await act(async () => {
      copyAll?.props.onClick();
    });
    expect(copyToClipboard).toHaveBeenCalledWith(text);
    renderer.unmount();
  });

  it('falls back to plain code when text exceeds the highlight length limit', () => {
    const hugeJson = `{"data":"${'a'.repeat(MAX_TEXT_HIGHLIGHT_LENGTH)}"}`;
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <TextViewer name="huge.json" langName="json" text={hugeJson} requestClose={vi.fn()} />
      );
    });

    const code = renderer.root.findByType('code');
    expect(typeof code.props.children).toBe('string');
    expect(code.findAllByType('span')).toHaveLength(0);
    renderer.unmount();
  });

  it('guards against non-string langName values without crashing', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <TextViewer
          name="notes.constructor"
          langName={Object.prototype.constructor as unknown as string}
          text="plain attachment body"
          requestClose={vi.fn()}
        />
      );
    });

    const code = renderer.root.findByType('code');
    expect(code.props.children).toBe('plain attachment body');
    renderer.unmount();
  });
});
