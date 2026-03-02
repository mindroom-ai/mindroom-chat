import React from 'react';
import parse, { Element, HTMLReactParserOptions, domToReact } from 'html-react-parser';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, ReactTestRenderer, ReactTestRendererJSON } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { withMindroomToolTraceMarkerParserOptions } from './react-custom-html-parser';

vi.mock('folds', async () => {
  const ReactModule = await import('react');
  const ReactLib = ReactModule.default;
  const passthrough =
    (tag: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      ReactLib.createElement(tag, props, children);

  return {
    Box: passthrough('div'),
    Chip: passthrough('span'),
    Spinner: passthrough('span'),
    Header: passthrough('div'),
    Icon: ({ children, ...props }: Record<string, unknown>) =>
      ReactLib.createElement('span', props, children),
    IconButton: passthrough('button'),
    Scroll: passthrough('div'),
    Text: ({ as = 'div', children, truncate, ...props }: Record<string, unknown>) =>
      ReactLib.createElement(
        typeof as === 'string' ? as : 'div',
        {
          ...props,
          'data-truncate': truncate ? 'true' : undefined,
        },
        children
      ),
    config: {
      space: {
        S400: '16px',
      },
    },
    Icons: new Proxy(
      {},
      {
        get: (_, prop) => String(prop),
      }
    ),
    toRem: (value: number) => `${value / 16}rem`,
  };
});

vi.mock('../styles/CustomHtml.css', () => ({
  MindroomBlock: 'MindroomBlock',
  MindroomBlockHeader: 'MindroomBlockHeader',
  MindroomBlockHeaderMeta: 'MindroomBlockHeaderMeta',
  MindroomBlockInlineResult: 'MindroomBlockInlineResult',
  MindroomBlockBody: 'MindroomBlockBody',
  MindroomBlockResult: 'MindroomBlockResult',
  MindroomToolGroupList: 'MindroomToolGroupList',
  MindroomToolGroupItem: 'MindroomToolGroupItem',
}));

const createBaseOpts = (): HTMLReactParserOptions => {
  const opts: HTMLReactParserOptions = {
    replace: (domNode) => {
      if (domNode instanceof Element && domNode.name === 'p') {
        return React.createElement('p', null, domToReact(domNode.children, opts));
      }

      return undefined;
    },
  };

  return opts;
};

const renderWithToolTrace = (html: string, content: Record<string, unknown>) => {
  const opts = withMindroomToolTraceMarkerParserOptions(createBaseOpts(), content);
  const parsed = parse(html, opts);
  return renderToStaticMarkup(React.createElement(React.Fragment, null, parsed));
};

const renderTreeWithToolTrace = (
  html: string,
  content: Record<string, unknown>
): ReactTestRenderer => {
  const opts = withMindroomToolTraceMarkerParserOptions(createBaseOpts(), content);
  const parsed = parse(html, opts);
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(React.createElement(React.Fragment, null, parsed));
  });

  if (!renderer) {
    throw new Error('Failed to create tool trace renderer');
  }

  return renderer;
};

const collectTextContent = (
  node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null
): string => {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map((child) => collectTextContent(child)).join('');

  const self = typeof node.children === 'object' ? collectTextContent(node.children) : '';
  return self;
};

describe('withMindroomToolTraceMarkerParserOptions', () => {
  it('renders tool blocks only when hydrated content carries tool-trace metadata', () => {
    const html = '<p>🔧 <code>search_web</code> [1]</p>';

    const previewMarkup = renderWithToolTrace(html, {
      body: 'preview',
      formatted_body: html,
    });
    expect(previewMarkup).not.toContain('>Tool<');

    const hydratedMarkup = renderWithToolTrace(html, {
      body: 'full response',
      formatted_body: html,
      'io.mindroom.tool_trace': {
        version: 2,
        events: [{ type: 'tool_call_completed', tool_name: 'search_web', result_preview: 'Done' }],
      },
    });
    expect(hydratedMarkup).toContain('>Tool<');
    expect(hydratedMarkup).toContain('search_web');
    expect(hydratedMarkup).toContain('Done');
  });

  it('groups consecutive markers into one tool-calls block', () => {
    const renderer = renderTreeWithToolTrace(
      [
        '<p>🔧 <code>tool1</code> [1]</p>',
        '<p>🔧 <code>tool2</code> [2]</p>',
        '<p>🔧 <code>tool3</code> [3]<br/>Done</p>',
      ].join(''),
      {
        'io.mindroom.tool_trace': {
          version: 2,
          events: [
            { type: 'tool_call_completed', tool_name: 'first_tool', result_preview: 'FIRST' },
            { type: 'tool_call_started', tool_name: 'second_tool' },
            { type: 'tool_call_completed', tool_name: 'third_tool', result_preview: 'THIRD' },
          ],
        },
      }
    );

    const collapsed = collectTextContent(renderer.toJSON());
    expect(collapsed).toContain('3 tool calls');
    expect(renderer.root.findAllByType('button')).toHaveLength(1);

    const toggle = renderer.root.findByType('button');
    act(() => {
      toggle.props.onClick();
    });

    const expanded = collectTextContent(renderer.toJSON());
    expect(expanded).toContain('Tool #1: first_tool');
    expect(expanded).toContain('FIRST');
    expect(expanded).toContain('Tool #2: second_tool ⏳');
    expect(expanded).toContain('Tool #3: third_tool');
    expect(expanded).toContain('THIRD');
    expect(expanded).toContain('Done');
  });

  it('does not merge marker-prefix paragraphs when each has trailing text', () => {
    const markup = renderWithToolTrace(
      [
        '<p>🔧 <code>run_shell_command</code> [1]<br/>Now let me find one</p>',
        '<p>🔧 <code>run_shell_command</code> [2]<br/>Now let me find two</p>',
      ].join(''),
      {
        'io.mindroom.tool_trace': {
          version: 2,
          events: [
            {
              type: 'tool_call_completed',
              tool_name: 'run_shell_command',
              result_preview: 'FIRST',
            },
            { type: 'tool_call_started', tool_name: 'run_shell_command' },
          ],
        },
      }
    );

    expect(markup).not.toContain('2 tool calls');
    expect(markup.match(/>Tool</g)).toHaveLength(2);
    expect(markup).toContain('run_shell_command');
    expect(markup).toContain('Now let me find one');
    expect(markup).toContain('Now let me find two');
    expect(markup).not.toContain('🔧');
  });

  it('preserves trailing content after a marker prefix, including br and text', () => {
    const markup = renderWithToolTrace('<p>🔧 <code>tool3</code> [3]<br/>Done</p>', {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_completed', tool_name: 'tool1' },
          { type: 'tool_call_completed', tool_name: 'tool2' },
          { type: 'tool_call_completed', tool_name: 'tool3', result_preview: 'third result' },
        ],
      },
    });

    expect(markup).toContain('<p>Done</p>');
    expect(markup).toContain('Done');
  });

  it('consumes pending hourglass as part of the marker and does not render it as trailing text', () => {
    const markup = renderWithToolTrace('<p>🔧 <code>tool3</code> [3] ⏳<br/>Waiting</p>', {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_completed', tool_name: 'tool1' },
          { type: 'tool_call_completed', tool_name: 'tool2' },
          { type: 'tool_call_started', tool_name: 'tool3' },
        ],
      },
    });

    expect(markup).toContain('tool3');
    expect(markup).toContain('<p>Waiting</p>');
    expect(markup).not.toContain('⏳');
  });

  it('does not leak a raw hourglass for a standalone pending marker paragraph', () => {
    const markup = renderWithToolTrace('<p>🔧 <code>tool3</code> [3] ⏳</p>', {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_completed', tool_name: 'tool1' },
          { type: 'tool_call_completed', tool_name: 'tool2' },
          { type: 'tool_call_started', tool_name: 'tool3' },
        ],
      },
    });

    expect(markup).toContain('tool3');
    expect(markup).not.toContain('⏳');
  });

  it('shows single-line inline result inside expanded body for copyability', () => {
    const renderer = renderTreeWithToolTrace('<p>🔧 <code>tool3</code> [3]</p>', {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_completed', tool_name: 'tool1' },
          { type: 'tool_call_completed', tool_name: 'tool2' },
          { type: 'tool_call_completed', tool_name: 'tool3', result_preview: 'Single-line output' },
        ],
      },
    });

    expect(() => renderer.root.findByType('pre')).toThrow();

    const toggle = renderer.root.findByType('button');
    act(() => {
      toggle.props.onClick();
    });

    const resultBody = renderer.root.findByType('pre');
    expect(resultBody.children.join('')).toContain('Single-line output');
  });
});
