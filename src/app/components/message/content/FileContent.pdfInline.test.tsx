import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileContent } from './FileContent';

vi.mock('../../glass/GlassPrimitives', () => ({ Modal: () => null }));
vi.mock('focus-trap-react', () => ({ default: () => null }));
vi.mock('folds', async () => {
  const { createElement } = await import('react');
  const tag =
    (name: string) =>
    ({ children }: { children?: React.ReactNode }) =>
      createElement(name, null, children);
  return {
    Box: tag('div'),
    Button: tag('button'),
    Icon: () => null,
    IconButton: tag('button'),
    Icons: {},
    Overlay: () => null,
    OverlayBackdrop: () => null,
    OverlayCenter: tag('div'),
    Spinner: () => null,
    Text: tag('span'),
  };
});

/** Renders a file row's actions with marker elements standing in for each action. */
const renderActions = (mimeType: string): ReactTestRenderer => {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(
      <FileContent
        body="report"
        mimeType={mimeType}
        renderAsTextFile={() => <i data-action="open-text" />}
        renderAsPdfFile={() => <i data-action="open-pdf" />}
      >
        <i data-action="download" />
      </FileContent>
    );
  });
  if (!renderer) throw new Error('FileContent did not render');
  return renderer;
};

const actionsOf = (renderer: ReactTestRenderer): string[] =>
  renderer.root
    .findAll((node) => typeof node.props['data-action'] === 'string')
    .map((node) => node.props['data-action'] as string);

/** A navigator as the browser reports it; `undefined` stands for one without the flag. */
const browserReports = (pdfViewerEnabled: boolean | undefined) => {
  vi.stubGlobal('navigator', pdfViewerEnabled === undefined ? {} : { pdfViewerEnabled });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FileContent PDF open action', () => {
  it('offers Open PDF and Download where the browser shows PDFs inline', () => {
    browserReports(true);

    expect(actionsOf(renderActions('application/pdf'))).toEqual(['open-pdf', 'download']);
  });

  it('keeps Open PDF in browsers that predate navigator.pdfViewerEnabled', () => {
    browserReports(undefined);

    expect(actionsOf(renderActions('application/pdf'))).toEqual(['open-pdf', 'download']);
  });

  it('leaves only Download where the browser cannot show PDFs inline, as on Android', () => {
    browserReports(false);

    expect(actionsOf(renderActions('application/pdf; charset=binary'))).toEqual(['download']);
  });

  it('still opens text files where the browser cannot show PDFs inline', () => {
    browserReports(false);

    expect(actionsOf(renderActions('text/plain'))).toEqual(['open-text', 'download']);
  });
});
