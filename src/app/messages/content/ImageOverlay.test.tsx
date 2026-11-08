import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { ImageOverlay } from './ImageOverlay';

const saveFile = vi.hoisted(() =>
  vi.fn<(source: Blob | string, fileName: string) => Promise<boolean>>(async () => true)
);

const passThrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;

vi.mock('folds', async () => {
  const actual = await vi.importActual<typeof import('folds')>('folds');
  return {
    ...actual,
    Box: ({ children, ...props }: { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
    Icon: () => null,
    Overlay: passThrough,
    OverlayBackdrop: () => null,
    OverlayCenter: passThrough,
    Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  };
});
vi.mock('focus-trap-react', () => ({ default: passThrough }));
vi.mock('../../ui/glass/GlassPrimitives', () => ({
  Header: ({ children }: { children?: React.ReactNode }) => <header>{children}</header>,
  IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Modal: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));
vi.mock('./viewerFrame', () => ({
  useViewerFrame: () => ({ centerStyle: undefined, modalStyle: {} }),
  viewerTrapOptions: () => ({}),
}));
vi.mock('../../matrix/matrix', () => ({ downloadMedia: async () => new Blob(['picture']) }));
vi.mock('../../native/nativeFileSave', () => ({ saveFile }));

// A link preview's picture is named after the page's title, which the page chose.
const TITLE = 'Quarterly report\u202efdp.exe';
const TITLE_SHOWN = 'Quarterly report<U+202E>fdp.exe';

it('names the picture viewer with the direction controls of its name as code points, and saves the file under the name as it is', async () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <ImageOverlay src="https://media.example/picture" alt={TITLE} requestClose={vi.fn()} />
    );
  });

  const dialog = renderer.root.find((node) => node.props.role === 'dialog');
  expect(dialog.props['aria-label']).toBe(TITLE_SHOWN);
  expect(renderer.root.findByType('img').props.alt).toBe(TITLE_SHOWN);
  expect(renderer.root.findByType('header').findAllByType('span')[0]?.props.children).toBe(
    TITLE_SHOWN
  );

  const download = renderer.root
    .findAll((node) => node.type === 'button' && node.props['aria-label'] === undefined)
    .at(-1);
  await act(async () => {
    download?.props.onClick();
    await Promise.resolve();
  });
  expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), TITLE);
  act(() => renderer.unmount());
});
