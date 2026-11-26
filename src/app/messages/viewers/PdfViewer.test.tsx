import React from 'react';
import { Capacitor } from '@capacitor/core';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfViewer } from './PdfViewer';

const saveFile = vi.hoisted(() =>
  vi.fn<(source: Blob | string, fileName: string) => Promise<boolean>>(async () => true)
);
const openNativeFile = vi.hoisted(() =>
  vi.fn<(source: Blob | string, fileName: string, mimeType?: string) => Promise<boolean>>(
    async () => true
  )
);

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => 'web'),
    isNativePlatform: vi.fn(() => false),
  },
  registerPlugin: vi.fn(),
}));

vi.mock('folds', async () => {
  const actual = await vi.importActual<typeof import('folds')>('folds');
  return {
    ...actual,
    Box: ({ children, ...props }: { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
    Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Icon: () => null,
    Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
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
vi.mock('../../native/nativeFileSave', () => ({ openNativeFile, saveFile }));
vi.mock('./PdfViewer.css', () => ({
  PdfViewer: 'PdfViewer',
  PdfViewerContent: 'PdfViewerContent',
  PdfViewerFallback: 'PdfViewerFallback',
  PdfViewerFallbackCard: 'PdfViewerFallbackCard',
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

const buttonByText = (renderer: ReactTestRenderer, label: string) =>
  renderer.root
    .findAllByType('button')
    .find((button) =>
      button.findAllByType('span').some((span) => span.children.join('') === label)
    );

describe('PdfViewer sources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
    saveFile.mockResolvedValue(true);
    openNativeFile.mockResolvedValue(true);
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

  it('keeps the inline iframe viewer on native iOS', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');

    const renderer = render('blob:https://chat.example.org/ios');
    expect(renderer.root.findByType('iframe').props.src).toBe(
      `/pdf-frame.html#${encodeURIComponent('blob:https://chat.example.org/ios')}`
    );
  });

  it('names the file with its direction controls as code points and saves it as it is', async () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <PdfViewer
          name={'report\u202etxt.pdf'}
          src="blob:https://chat.example.org/1"
          requestClose={vi.fn()}
        />
      );
    });
    expect(renderer.root.findAllByType('span').map((span) => span.children.join(''))).toContain(
      'report<U+202E>txt.pdf'
    );
    // The frame's accessible name is the file's name as shown.
    expect(renderer.root.findByType('iframe').props.title).toBe('report<U+202E>txt.pdf');
    await act(async () => {
      downloadChip(renderer)?.props.onClick();
    });
    expect(saveFile).toHaveBeenCalledWith('blob:https://chat.example.org/1', 'report\u202etxt.pdf');
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

  describe('Android native fallback card', () => {
    beforeEach(() => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
      vi.mocked(Capacitor.getPlatform).mockReturnValue('android');
    });

    it('renders Open PDF and Download actions instead of an iframe and opens natively', async () => {
      const renderer = render('blob:https://chat.example.org/android');

      expect(renderer.root.findAllByType('iframe')).toHaveLength(0);
      const openButton = buttonByText(renderer, 'Open PDF');
      const cardDownloadButton = renderer.root
        .findAllByType('button')
        .filter((button) =>
          button.findAllByType('span').some((span) => span.children.join('') === 'Download')
        )
        .at(-1);
      expect(openButton).toBeDefined();
      expect(cardDownloadButton).toBeDefined();

      await act(async () => {
        openButton?.props.onClick();
      });

      expect(openNativeFile).toHaveBeenCalledWith(
        'blob:https://chat.example.org/android',
        'report.pdf',
        'application/pdf'
      );
      expect(saveFile).not.toHaveBeenCalled();

      await act(async () => {
        cardDownloadButton?.props.onClick();
      });
      expect(saveFile).toHaveBeenCalledWith('blob:https://chat.example.org/android', 'report.pdf');
    });

    it('falls back to saveFile when Android has no installed PDF viewer', async () => {
      openNativeFile.mockResolvedValueOnce(false);
      const renderer = render('blob:https://chat.example.org/no-viewer');

      await act(async () => {
        buttonByText(renderer, 'Open PDF')?.props.onClick();
      });

      expect(openNativeFile).toHaveBeenCalledWith(
        'blob:https://chat.example.org/no-viewer',
        'report.pdf',
        'application/pdf'
      );
      expect(saveFile).toHaveBeenCalledWith(
        'blob:https://chat.example.org/no-viewer',
        'report.pdf'
      );
    });

    it('renders no fallback card for non-blob URLs on Android', () => {
      const renderer = render('https://matrix.example.org/_matrix/media/v3/download/x/y');

      expect(renderer.root.findAllByType('iframe')).toHaveLength(0);
      expect(buttonByText(renderer, 'Open PDF')).toBeUndefined();
      expect(downloadChip(renderer)?.props.disabled).toBe(true);
    });
  });
});
