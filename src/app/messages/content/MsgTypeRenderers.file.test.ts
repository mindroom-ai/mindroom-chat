import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { MsgType } from 'matrix-js-sdk';
import { MAudio, MFile, MImage, MVideo } from './MsgTypeRenderers';
import { FileContent, ReadTextFile } from './FileContent';
import { FileDownloadButton } from './FileHeader';

vi.mock('./FallbackContent', () => ({
  MessageBadEncryptedContent: () => null,
  MessageBrokenContent: () => null,
  MessageDeletedContent: () => null,
  MessageEditedContent: () => null,
  MessageUnsupportedContent: () => null,
}));
vi.mock('./BrokenContent', () => ({
  BrokenContent: () => React.createElement('div', { 'data-renderer': 'broken' }),
}));

// Renders the file name as text, as the real player does.
vi.mock('./VoiceAudioContent', () => ({
  VoiceAudioContent: ({ filename }: { filename: string }) =>
    React.createElement('div', null, filename),
}));

vi.mock('./FileRow.css', () => ({
  FileRow: 'FileRow',
  FileTile: 'FileTile',
  FileInfo: 'FileInfo',
  FileName: 'FileName',
}));

vi.mock('../../ui/glass/GlassPrimitives', () => ({ Modal: () => null }));
vi.mock('../layout/layout', () => ({ MessageTextBody: () => null }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));

describe('file renderers', () => {
  it('render events whose file name or MIME type is not a string', () => {
    // Event content is arbitrary JSON from the sender.
    const fields = { body: 5, filename: { name: 'x' }, url: 'mxc://example.org/file' };
    const renderText = (element: React.ReactElement) => {
      const renderer = create(element);
      const text = JSON.stringify(renderer.toJSON());
      renderer.unmount();
      return text;
    };

    const file = renderText(
      React.createElement(MFile, {
        content: { ...fields, msgtype: MsgType.File, info: { mimetype: 5 } } as never,
        renderFileContent: ({ body, mimeType }) =>
          React.createElement(FileContent, {
            body,
            mimeType,
            renderAsTextFile: () => null,
            renderAsPdfFile: () => null,
          }),
      })
    );
    expect(file).toContain('Unnamed File');
    expect(file).toContain('"File"');

    const video = renderText(
      React.createElement(MVideo, {
        content: { ...fields, msgtype: MsgType.Video, info: { mimetype: 'video/mp4' } } as never,
        renderAsFile: () => null,
        renderVideoContent: () => null,
      })
    );
    expect(video).toContain('Video');

    const audio = renderText(
      React.createElement(MAudio, {
        content: { ...fields, msgtype: MsgType.Audio, info: { mimetype: 'audio/ogg' } } as never,
        renderAsFile: () => null,
      })
    );
    expect(audio).toContain('Audio');
  });
});

describe('MFile', () => {
  it('shows a text file as one row with its type, size, and Open and Download buttons', () => {
    const renderer = create(
      React.createElement(MFile, {
        content: {
          msgtype: MsgType.File,
          body: 'release-notes.txt',
          url: 'mxc://example.org/notes',
          info: { mimetype: 'text/plain', size: 2400 },
        } as never,
        renderFileContent: ({ body, mimeType, url, encInfo }) =>
          React.createElement(
            FileContent,
            {
              body,
              mimeType,
              renderAsTextFile: () =>
                React.createElement(ReadTextFile, {
                  body,
                  mimeType,
                  url,
                  encInfo,
                  iconOnly: true,
                  renderViewer: () => null,
                }),
              renderAsPdfFile: () => null,
            },
            React.createElement(FileDownloadButton, { filename: body, url, mimeType, encInfo })
          ),
      })
    );
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('release-notes.txt');
    expect(text).toContain('Text file · 2.4 KB');
    expect(text).toContain('"TXT"');
    expect(
      renderer.root.findAllByType('button').map((button) => button.props['aria-label'])
    ).toEqual(['Open release-notes.txt', 'Download release-notes.txt']);
    renderer.unmount();
  });

  it('shows a file name with its direction controls as code points and passes the name on as it is', () => {
    const fileName = 'invoice\u202efdp.exe';
    const passedOn: string[] = [];
    const renderer = create(
      React.createElement(MFile, {
        content: {
          msgtype: MsgType.File,
          body: fileName,
          url: 'mxc://example.org/invoice',
          info: { mimetype: 'application/octet-stream', size: 2400 },
        } as never,
        renderFileContent: ({ body }) => {
          passedOn.push(body);
          return null;
        },
      })
    );
    const name = renderer.root.findByProps({ className: 'FileName' });
    expect(name.props.title).toBe('invoice<U+202E>fdp.exe');
    expect(JSON.stringify(renderer.toJSON())).toContain('invoice<U+202E>fdp.exe');
    expect(JSON.stringify(renderer.toJSON())).not.toMatch(/\u202e/);
    // Saving and opening keep the name the sender gave.
    expect(passedOn).toEqual([fileName]);
    renderer.unmount();
  });
});

describe('MImage', () => {
  it.each([
    ['image/svg+xml', 'file'],
    ['image/png', 'image'],
  ])('renders an image declared as %s as %s content', (mimetype, renderedAs) => {
    const renderer = create(
      React.createElement(MImage, {
        content: {
          msgtype: MsgType.Image,
          body: 'diagram',
          url: 'mxc://example.org/diagram',
          info: { mimetype },
        },
        renderAsFile: () => React.createElement('div', { 'data-renderer': 'file' }),
        renderImageContent: () => React.createElement('div', { 'data-renderer': 'image' }),
      })
    );

    expect(JSON.stringify(renderer.toJSON())).toContain(`"data-renderer":"${renderedAs}"`);

    renderer.unmount();
  });
});
