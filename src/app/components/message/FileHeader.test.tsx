import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileDownloadButton } from './FileHeader';

const save = vi.hoisted(() => ({
  status: 'idle' as 'idle' | 'loading' | 'error',
  download: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('folds', () => ({
  Icon: (props: Record<string, unknown>) => React.createElement('i', props),
  IconButton: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('button', { ...props, 'data-icon-button': true }, children),
  Icons: { Download: 'download' },
  Spinner: (props: Record<string, unknown>) => React.createElement('span', props),
}));

vi.mock('./attachmentDownload', () => ({
  useAttachmentSave: () => [save.status, save.download],
}));

const render = (label?: string): ReactTestRenderer => {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(
      <FileDownloadButton
        filename="clip.ogg"
        url="mxc://example.org/clip"
        mimeType="audio/ogg"
        label={label}
        className="Row"
      />
    );
  });
  if (!renderer) throw new Error('FileDownloadButton failed to render');
  return renderer;
};

describe('FileDownloadButton', () => {
  beforeEach(() => {
    save.status = 'idle';
    save.download.mockClear();
  });

  it('renders a labeled menu row that saves the file', () => {
    const button = render('Download').root.findByType('button');

    expect(button.props.type).toBe('button');
    expect(button.props.className).toBe('Row');
    expect(button.props['aria-label']).toBe('Download clip.ogg');
    expect(button.findByType('span').props.children).toBe('Download');
    expect(button.findByProps({ src: 'download' })).toBeTruthy();
    expect(button.props['data-error']).toBeUndefined();

    act(() => {
      button.props.onClick();
    });
    expect(save.download).toHaveBeenCalledTimes(1);
  });

  it('marks a failed save on the row', () => {
    save.status = 'error';

    expect(render('Download').root.findByType('button').props['data-error']).toBe(true);
  });

  it('stays an icon button without a label', () => {
    const button = render().root.findByType('button');

    expect(button.props['data-icon-button']).toBe(true);
    expect(button.props.className).toBeUndefined();
    expect(button.props.variant).toBe('SurfaceVariant');
  });
});
