import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfViewer } from './PdfViewer';

const saveFile = vi.hoisted(() =>
  vi.fn<(source: Blob | string, fileName: string) => Promise<boolean>>(async () => true)
);

vi.mock('folds', async () => {
  const actual = await vi.importActual<typeof import('folds')>('folds');
  return {
    ...actual,
    Box: ({ children, ...props }: { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
    Icon: () => null,
    Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  };
});
vi.mock('../../../ui/glass/GlassPrimitives', () => {
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
vi.mock('../../../native/nativeFileSave', () => ({ saveFile }));
vi.mock('./PdfViewer.css', () => ({
  PdfViewer: 'PdfViewer',
  PdfViewerContent: 'PdfViewerContent',
  PdfViewerHeader: 'PdfViewerHeader',
}));

const render = (src: string): ReactTestRenderer => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<PdfViewer name="report.pdf" src={src} requestClose={vi.fn()} />);
  });
  return renderer;
};

const downloadChip = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByType('button').find((button) => button.props['aria-label'] === undefined);

describe('PdfViewer sources', () => {
  beforeEach(() => {
    saveFile.mockClear();
  });

  it('shows and saves a blob URL', async () => {
    const renderer = render('blob:https://chat.example.org/1234');

    expect(renderer.root.findByType('iframe').props.src).toBe(
      `/pdf-frame.html#${encodeURIComponent('blob:https://chat.example.org/1234')}`
    );
    await act(async () => {
      downloadChip(renderer)?.props.onClick();
    });
    expect(saveFile).toHaveBeenCalledWith('blob:https://chat.example.org/1234', 'report.pdf');
  });

  it.each(['https://matrix.example.org/_matrix/media/v3/download/x/y', 'javascript:alert(1)'])(
    'neither frames nor saves %s',
    async (src) => {
      const renderer = render(src);

      expect(renderer.root.findAllByType('iframe')).toHaveLength(0);
      expect(downloadChip(renderer)?.props.disabled).toBe(true);
      await act(async () => {
        downloadChip(renderer)?.props.onClick();
      });
      expect(saveFile).not.toHaveBeenCalled();
    }
  );
});
