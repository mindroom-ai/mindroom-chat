// @vitest-environment jsdom

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { create, ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  MindroomMessageExtras as MindroomMessageExtrasData,
  MindroomMessageExtrasSection,
} from './messageExtrasData';
import { MindroomMessageExtras } from './MindroomMessageExtras';

vi.mock('./MindroomMessageExtras.css.ts', () => ({
  Extras: 'Extras',
  Section: 'Section',
  Summary: 'Summary',
  Content: 'Content',
  PlainText: 'PlainText',
  Markdown: 'Markdown',
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createExtras = (sections: MindroomMessageExtrasSection[]): MindroomMessageExtrasData => ({
  version: 1,
  sections,
});

const section = (
  overrides: Partial<MindroomMessageExtrasSection> = {}
): MindroomMessageExtrasSection => ({
  title: 'Details',
  contentType: 'text/plain',
  content: 'payload',
  collapsed: true,
  ...overrides,
});

const getNodeText = (value: ReactTestInstance | string | number): string => {
  if (typeof value === 'string' || typeof value === 'number') return `${value}`;
  return value.children.map((child) => getNodeText(child as ReactTestInstance | string)).join('');
};

describe('MindroomMessageExtras', () => {
  it('renders one details element per section', () => {
    const renderer = create(
      React.createElement(MindroomMessageExtras, {
        extras: createExtras([
          section({ title: 'First' }),
          section({ title: 'Second', content: 'two' }),
        ]),
        htmlReactParserOptions: {},
      })
    );

    expect(renderer.root.findAllByType('details')).toHaveLength(2);
    expect(getNodeText(renderer.root)).toContain('First');
    expect(getNodeText(renderer.root)).toContain('Second');

    renderer.unmount();
  });

  it('opens only sections that start uncollapsed', () => {
    const container = document.createElement('div');
    let root: Root | undefined;

    act(() => {
      root = createRoot(container);
      root.render(
        React.createElement(MindroomMessageExtras, {
          extras: createExtras([
            section({ collapsed: true }),
            section({ title: 'Open', collapsed: false }),
          ]),
          htmlReactParserOptions: {},
        })
      );
    });

    const details = container.querySelectorAll('details');

    expect(details[0].open).toBe(false);
    expect(details[1].open).toBe(true);

    act(() => {
      root?.unmount();
    });
  });

  it('does not reset details state on rerender', () => {
    const container = document.createElement('div');
    const extras = createExtras([section({ collapsed: false })]);
    let root: Root | undefined;

    const render = () =>
      React.createElement(MindroomMessageExtras, {
        extras,
        htmlReactParserOptions: {},
      });

    act(() => {
      root = createRoot(container);
      root.render(render());
    });

    const details = container.querySelector('details');
    expect(details?.open).toBe(true);

    act(() => {
      root?.render(render());
    });

    expect(details?.open).toBe(true);

    if (details) details.open = false;

    act(() => {
      root?.render(render());
    });

    expect(details?.open).toBe(false);

    act(() => {
      root?.unmount();
    });
  });

  it('keeps user-toggled details state when streaming edits change section content', () => {
    const container = document.createElement('div');
    let root: Root | undefined;

    const render = (extras: MindroomMessageExtrasData) =>
      React.createElement(MindroomMessageExtras, {
        extras,
        htmlReactParserOptions: {},
      });

    act(() => {
      root = createRoot(container);
      root.render(render(createExtras([section({ content: 'initial', collapsed: false })])));
    });

    const details = container.querySelector('details');
    expect(details?.open).toBe(true);
    expect(container.textContent).toContain('initial');

    if (details) details.open = false;

    act(() => {
      root?.render(
        render(
          createExtras([
            section({
              content: 'streamed update',
              collapsed: false,
            }),
          ])
        )
      );
    });

    expect(container.querySelector('details')).toBe(details);
    expect(details?.open).toBe(false);
    expect(container.textContent).toContain('streamed update');

    if (details) details.open = true;

    act(() => {
      root?.render(
        render(
          createExtras([
            section({
              content: 'final update',
              collapsed: true,
            }),
          ])
        )
      );
    });

    expect(container.querySelector('details')).toBe(details);
    expect(details?.open).toBe(true);
    expect(container.textContent).toContain('final update');

    act(() => {
      root?.unmount();
    });
  });

  it('renders text/plain literally without markdown or HTML parsing', () => {
    const renderer = create(
      React.createElement(MindroomMessageExtras, {
        extras: createExtras([
          section({
            content: '<strong>literal</strong>\n**not bold**',
          }),
        ]),
        htmlReactParserOptions: {},
      })
    );

    expect(renderer.root.findAllByType('pre')).toHaveLength(1);
    expect(renderer.root.findAllByType('strong')).toHaveLength(0);
    expect(getNodeText(renderer.root)).toContain('<strong>literal</strong>');
    expect(getNodeText(renderer.root)).toContain('**not bold**');

    renderer.unmount();
  });

  it('renders text/markdown through sanitized markdown output', () => {
    const renderer = create(
      React.createElement(MindroomMessageExtras, {
        extras: createExtras([
          section({
            contentType: 'text/markdown',
            content: '**bold**\n```ts\nconst value = 1;\n```',
          }),
        ]),
        htmlReactParserOptions: {},
      })
    );

    expect(renderer.root.findAllByType('strong')).toHaveLength(1);
    expect(renderer.root.findAllByType('pre')).toHaveLength(1);
    expect(renderer.root.findAllByType('code')).toHaveLength(1);
    expect(getNodeText(renderer.root)).toContain('bold');
    expect(getNodeText(renderer.root)).toContain('const value = 1;');

    renderer.unmount();
  });

  it('escapes raw dangerous markdown input before HTML parsing', () => {
    const renderer = create(
      React.createElement(MindroomMessageExtras, {
        extras: createExtras([
          section({
            contentType: 'text/markdown',
            content:
              '<details open><summary>raw</summary>expanded</details><script>alert(1)</script>',
          }),
        ]),
        htmlReactParserOptions: {},
      })
    );

    expect(renderer.root.findAllByType('details')).toHaveLength(1);
    expect(renderer.root.findAllByType('script')).toHaveLength(0);
    expect(getNodeText(renderer.root)).toContain('<details open>');
    expect(getNodeText(renderer.root)).toContain('<script>alert(1)</script>');

    renderer.unmount();
  });

  it('renders titles as escaped React text', () => {
    const renderer = create(
      React.createElement(MindroomMessageExtras, {
        extras: createExtras([
          section({
            title: '<img src=x onerror=alert(1)>',
          }),
        ]),
        htmlReactParserOptions: {},
      })
    );

    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    expect(getNodeText(renderer.root)).toContain('<img src=x onerror=alert(1)>');

    renderer.unmount();
  });
});
