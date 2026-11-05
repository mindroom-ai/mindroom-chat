import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchClientConfig } from '../config/ClientConfigLoader';
import { ConfigConfigError } from './ConfigConfig';

// Why the configuration did not load, under the screen's title: in words where this client
// knows the failure, and the error's own text for whoever debugs it.

vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children }: { children?: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  Text: ({ children, ...props }: { children?: React.ReactNode }) => (
    <span {...props}>{children}</span>
  ),
  color: { Critical: { Main: 'red' } },
  config: { space: { S400: '16px' } },
}));
vi.mock('../ui/glass/GlassPrimitives', () => ({
  Dialog: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../ui/splash', () => ({
  MindRoomSplashScreen: () => null,
  SplashScreen: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** The red explanation under the title: its own text and the quieter detail line. */
const explanationOf = (error: unknown) => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<ConfigConfigError error={error} retry={vi.fn()} authenticate={vi.fn()} />);
  });
  const explanation = renderer.root.find(
    (node) => node.type === 'span' && node.props.style?.color === 'red'
  );
  const own = explanation.children.filter((child) => typeof child === 'string').join('');
  const detail = explanation.findAllByType('bdi');
  return { own, detail: detail[0]?.children.join('') };
};

const loadFailure = async (answer: () => Promise<Response>): Promise<unknown> => {
  globalThis.fetch = vi.fn(answer);
  return fetchClientConfig('/mindroom').then(
    () => expect.fail('the configuration should not load'),
    (error: unknown) => error
  );
};

describe('ConfigConfigError explanations', () => {
  it("names a server problem for a 5xx answer and keeps the loader's text", async () => {
    const error = await loadFailure(async () => new Response('busy', { status: 503 }));

    expect(explanationOf(error)).toEqual({
      own: 'The server ran into a problem. Try again later.',
      detail: 'Failed to load client configuration (HTTP 503).',
    });
  });

  it('names a missing file for a 404 answer', async () => {
    const error = await loadFailure(async () => new Response('', { status: 404 }));

    expect(explanationOf(error).own).toBe(
      "The server couldn't find this. It may have been removed."
    );
  });

  it('says the server was out of reach when the fetch itself fails', async () => {
    const error = await loadFailure(() => Promise.reject(new TypeError('Failed to fetch')));

    expect(explanationOf(error)).toEqual({
      own: "Couldn't reach the server. Check your connection and try again.",
      detail: undefined,
    });
  });

  it('shows only the text of a failure it cannot name, since the title says what failed', async () => {
    const error = await loadFailure(async () => new Response('[]', { status: 200 }));

    expect(explanationOf(error)).toEqual({
      own: '',
      detail: 'Client configuration must be a JSON object.',
    });
  });
});
