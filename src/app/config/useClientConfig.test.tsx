import React, { type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { ClientConfigProvider, getClientConfig, useClientConfig } from './useClientConfig';

const OUTER = { createRoom: { defaultFederation: true } };
const INNER = { createRoom: { defaultFederation: false } };

/** What `useClientConfig` gives where it renders. */
function Shown({ onShow }: { onShow: (config: unknown) => void }) {
  onShow(useClientConfig());
  return null;
}

describe('getClientConfig', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const render = (ui: ReactNode) => {
    act(() => {
      if (renderer) renderer.update(<>{ui}</>);
      else renderer = create(<>{ui}</>);
    });
  };

  it("is the innermost provider's configuration, as useClientConfig gives it there", () => {
    let shown: unknown;
    render(
      <ClientConfigProvider value={OUTER}>
        <ClientConfigProvider value={INNER}>
          <Shown onShow={(config) => (shown = config)} />
        </ClientConfigProvider>
      </ClientConfigProvider>
    );

    expect(getClientConfig()).toBe(INNER);
    expect(shown).toBe(INNER);
  });

  it("goes back to the outer provider's when the inner one unmounts, and to none when both have", () => {
    const tree = (inner: boolean) => (
      <ClientConfigProvider value={OUTER}>
        {inner && <ClientConfigProvider value={INNER} />}
      </ClientConfigProvider>
    );
    render(tree(false));
    expect(getClientConfig()).toBe(OUTER);
    render(tree(true));
    expect(getClientConfig()).toBe(INNER);

    render(tree(false));
    expect(getClientConfig()).toBe(OUTER);

    render(tree(true));
    act(() => renderer?.unmount());
    renderer = undefined;
    expect(getClientConfig()).toBeUndefined();
  });

  it("keeps the inner provider's when the outer one changes", () => {
    const tree = (outer: typeof OUTER) => (
      <ClientConfigProvider value={outer}>
        <ClientConfigProvider value={INNER} />
      </ClientConfigProvider>
    );
    render(tree(OUTER));
    render(tree({ createRoom: { defaultFederation: true } }));

    expect(getClientConfig()).toBe(INNER);
  });

  it('is none while no provider is mounted', () => {
    expect(getClientConfig()).toBeUndefined();
  });
});
