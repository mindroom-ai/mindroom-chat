import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('folds', () => ({
  config: {
    space: {
      S200: '8px',
    },
  },
}));

vi.mock('./message', () => ({
  AudioContent: () => null,
  DownloadFile: () => null,
  FileContent: () => null,
  ImageContent: () => null,
  MAudio: () => null,
  MBadEncrypted: () => React.createElement('div', { 'data-renderer': 'bad-encrypted' }),
  MEmote: () => React.createElement('div', { 'data-renderer': 'emote' }),
  MFile: () => null,
  MImage: () => null,
  MLocation: () => React.createElement('div', { 'data-renderer': 'location' }),
  MNotice: () => React.createElement('div', { 'data-renderer': 'notice' }),
  MindroomThreadSummaryCard: ({ summaryInfo }: { summaryInfo: { summaryText?: string } }) =>
    React.createElement('div', { 'data-renderer': 'summary-card' }, summaryInfo.summaryText),
  MText: () => React.createElement('div', { 'data-renderer': 'text' }),
  MVideo: () => null,
  ReadPdfFile: () => null,
  ReadTextFile: () => null,
  RenderBody: ({ body }: { body: string }) => React.createElement('span', null, body),
  ThumbnailContent: () => null,
  UnsupportedContent: () => React.createElement('div', { 'data-renderer': 'unsupported' }),
  VideoContent: () => null,
}));

vi.mock('./url-preview', () => ({
  UrlPreviewCard: () => null,
  UrlPreviewHolder: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('./media', () => ({
  Image: () => null,
  MediaControl: () => null,
  Video: () => null,
}));

vi.mock('./image-viewer', () => ({
  ImageViewer: () => null,
}));

vi.mock('./Pdf-viewer', () => ({
  PdfViewer: () => null,
}));

vi.mock('./text-viewer', () => ({
  TextViewer: () => null,
}));

vi.mock('../plugins/matrix-to', () => ({
  testMatrixTo: () => false,
}));

vi.mock('./message/mindroomLongText', () => ({
  getMindroomLongTextSource: () => undefined,
}));

vi.mock('./message/MindroomLongTextText', () => ({
  MindroomLongTextKind: {
    Text: 'text',
    Emote: 'emote',
    Notice: 'notice',
  },
  MindroomLongTextText: () => null,
}));

vi.mock('../plugins/react-custom-html-parser', () => ({
  withMindroomToolTraceMarkerParserOptions: (options: unknown) => options,
}));

describe('RenderMessageContent', () => {
  it('renders the summary card when thread summary metadata is present on a legacy msgtype', async () => {
    const { RenderMessageContent } = await import('./RenderMessageContent');

    const renderer = create(
      React.createElement(RenderMessageContent, {
        displayName: 'MindRoom',
        msgType: 'm.notice',
        ts: 0,
        getContent: (() => ({
          msgtype: 'm.notice',
          body: 'Summary body',
          'io.mindroom.thread_summary': {
            version: 1,
            summary: 'Rendered summary text',
          },
        })) as <T>() => T,
        htmlReactParserOptions: {} as never,
        linkifyOpts: {} as never,
      })
    );

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('summary-card');
    expect(rendered).toContain('Rendered summary text');
    expect(rendered).not.toContain('unsupported');

    renderer.unmount();
  });

  it('keeps rendering edited summaries as summary cards when m.new_content omits metadata', async () => {
    const { RenderMessageContent } = await import('./RenderMessageContent');

    const renderer = create(
      React.createElement(RenderMessageContent, {
        displayName: 'MindRoom',
        msgType: 'm.notice',
        ts: 0,
        edited: true,
        getContent: (() => ({
          msgtype: 'm.notice',
          body: 'Edited summary body',
          'io.mindroom.thread_summary': {
            version: 1,
            summary: 'Stale metadata summary',
          },
          'm.new_content': {
            msgtype: 'm.notice',
            body: 'Edited summary body',
          },
        })) as <T>() => T,
        htmlReactParserOptions: {} as never,
        linkifyOpts: {} as never,
      })
    );

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('summary-card');
    expect(rendered).toContain('Edited summary body');
    expect(rendered).not.toContain('notice');

    renderer.unmount();
  });
});
