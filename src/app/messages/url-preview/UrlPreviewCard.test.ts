import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UrlPreviewCard } from './UrlPreviewCard';

const loadPreview = vi.fn<() => Promise<unknown>>();
const previewState = vi.hoisted(() => ({
  current: { status: 'loading' } as { status: string; data?: unknown },
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');

  const forwardTag = (tag: string) =>
    React.forwardRef<HTMLElement, Record<string, unknown>>(({ children, ...props }, ref) =>
      reactModule.createElement(tag, { ...props, ref }, children)
    );

  return {
    Box: forwardTag('div'),
    Icon: forwardTag('span'),
    IconButton: forwardTag('button'),
    Icons: {
      ArrowLeft: 'ArrowLeft',
      ArrowRight: 'ArrowRight',
    },
    Scroll: forwardTag('div'),
    Spinner: forwardTag('span'),
    Text: forwardTag('span'),
    as: <P extends object>(
      render: (props: P, ref: React.ForwardedRef<HTMLElement>) => React.ReactElement
    ) => React.forwardRef<HTMLElement, P>((props, ref) => render(props, ref)),
    color: {
      Success: {
        Main: 'green',
      },
    },
    config: {
      space: {
        S200: '8px',
      },
    },
  };
});

vi.mock('../../lib/hooks/useAsyncCallback', () => ({
  AsyncStatus: {
    Idle: 'idle',
    Loading: 'loading',
    Success: 'success',
    Error: 'error',
  },
  useAsyncCallback: () => [previewState.current, loadPreview],
}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getUrlPreview: vi.fn(),
  }),
}));

vi.mock('./UrlPreview', () => ({
  UrlPreview: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ children, ...props }, ref) => React.createElement('div', { ...props, ref }, children)
  ),
  UrlPreviewContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  UrlPreviewDescription: ({ children }: { children: React.ReactNode }) =>
    React.createElement('span', null, children),
  UrlPreviewImg: (props: Record<string, unknown>) => React.createElement('img', props),
}));

vi.mock('../../lib/hooks/useIntersectionObserver', () => ({
  getIntersectionObserverEntry: vi.fn(),
  useIntersectionObserver: vi.fn(),
}));

vi.mock('./UrlPreviewCard.css', () => ({ UrlPreviewImageButton: 'UrlPreviewImageButton' }));

vi.mock('../content/ImageOverlay', () => ({
  ImageOverlay: () => null,
}));

vi.mock('../viewers/ImageViewer', () => ({
  ImageViewer: () => null,
}));

vi.mock('../../matrix/matrix', () => ({
  mxcUrlToHttp: vi.fn(() => undefined),
}));

vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../matrix/mediaUrl', () => ({
  mxcUrlToHttp: (_mx: unknown, mxc: string) => mxc.replace('mxc://', 'https://media.example/'),
}));

vi.mock('../../avatars/useAvatarImage', () => ({
  useAvatarImage: (src?: string) => ({ imageSrc: src, onImageError: () => undefined }),
}));

describe('UrlPreviewCard', () => {
  afterEach(() => {
    vi.clearAllMocks();
    previewState.current = { status: 'loading' };
  });

  it('swallows preview load rejection triggered from the effect', async () => {
    loadPreview.mockRejectedValueOnce(new Error('preview failed'));

    await expect(
      act(async () => {
        create(React.createElement(UrlPreviewCard, { url: 'https://example.com', ts: 1 }));
        await Promise.resolve();
      })
    ).resolves.toBeUndefined();

    expect(loadPreview).toHaveBeenCalledTimes(1);
  });

  it("shows the direction controls of the page's site name, title and description as code points", async () => {
    loadPreview.mockResolvedValue(undefined);
    previewState.current = {
      status: 'success',
      data: {
        'og:site_name': 'Ledger \u202eswen\u202c',
        'og:title': 'Quarterly report\u202efdp.exe',
        'og:description': 'Run step\u2067 cleanup\u2069 after the deploy\u200f.',
        'og:image': 'mxc://example.org/picture',
      },
    };
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(UrlPreviewCard, { url: 'https://example.com', ts: 1 }));
      await Promise.resolve();
    });
    const text = JSON.stringify(renderer.toJSON());
    // The thumbnail's alt is the title too.
    expect(renderer.root.findByType('img').props.alt).toBe('Quarterly report<U+202E>fdp.exe');
    expect(text).toContain('Ledger <U+202E>swen<U+202C>');
    expect(text).toContain('Quarterly report<U+202E>fdp.exe');
    expect(text).toContain('Run step<U+2067> cleanup<U+2069> after the deploy<U+200F>.');
    expect(text).not.toMatch(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/);
    act(() => renderer.unmount());
  });
});
