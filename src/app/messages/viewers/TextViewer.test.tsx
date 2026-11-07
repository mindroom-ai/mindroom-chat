import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { TextViewer } from './TextViewer';

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

describe('TextViewer direction controls', () => {
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
});
