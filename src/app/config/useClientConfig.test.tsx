import { useEffect, type ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { ClientConfigProvider, getClientConfig } from './useClientConfig';

const OUTER = { createRoom: { defaultFederation: true } };
const INNER = { createRoom: { defaultFederation: false } };

describe('getClientConfig', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const render = (ui: ReactElement) => {
    act(() => {
      if (renderer) renderer.update(ui);
      else renderer = create(ui);
    });
  };

  it("is the inner provider's of two that mount together, as useClientConfig is below it", () => {
    render(
      <ClientConfigProvider value={OUTER}>
        <ClientConfigProvider value={INNER} />
      </ClientConfigProvider>
    );
    expect(getClientConfig()).toBe(INNER);

    render(
      <ClientConfigProvider value={{ createRoom: { defaultFederation: true } }}>
        <ClientConfigProvider value={INNER} />
      </ClientConfigProvider>
    );
    expect(getClientConfig()).toBe(INNER);
  });

  it('is there for a mount effect of what the provider renders', () => {
    let seen: unknown;
    function Child() {
      useEffect(() => {
        seen = getClientConfig();
      }, []);
      return null;
    }
    render(
      <ClientConfigProvider value={INNER}>
        <Child />
      </ClientConfigProvider>
    );
    expect(seen).toBe(INNER);
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

  it('is the later of two providers, and the earlier once the later one unmounts', () => {
    render(<ClientConfigProvider value={OUTER} />);
    let later: ReactTestRenderer | undefined;
    act(() => {
      later = create(<ClientConfigProvider value={INNER} />);
    });
    expect(getClientConfig()).toBe(INNER);

    act(() => later?.unmount());
    expect(getClientConfig()).toBe(OUTER);
  });

  it('keeps the later of two providers of one configuration when the earlier one unmounts', () => {
    const roots = [OUTER, INNER, OUTER].map((config) => {
      let root: ReactTestRenderer | undefined;
      act(() => {
        root = create(<ClientConfigProvider value={config} />);
      });
      return root!;
    });

    act(() => roots[0]?.unmount());
    expect(getClientConfig()).toBe(OUTER);

    act(() => roots.slice(1).forEach((root) => root.unmount()));
  });
});
