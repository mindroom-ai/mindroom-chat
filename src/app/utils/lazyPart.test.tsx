// @vitest-environment jsdom
import { Suspense } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lazyPart } from './lazyPart';

function Greeting({ name }: { name: string }) {
  return <p>Hello {name}</p>;
}

const loaded = { default: Greeting };
const offline = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'));

const renderPart = (Part: ReturnType<typeof lazyPart<{ name: string }>>, name = 'Ada') =>
  render(
    <Suspense fallback={<p>Loading</p>}>
      <Part name={name} />
    </Suspense>
  );

describe('lazyPart', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the loaded component with its props', async () => {
    const Part = lazyPart(() => Promise.resolve(loaded));
    renderPart(Part);
    expect(await screen.findByText('Hello Ada')).toBeTruthy();
  });

  it('renders nothing when its chunk cannot load, and the next mount loads it again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const load = vi.fn<() => Promise<typeof loaded>>().mockImplementationOnce(offline);
    load.mockResolvedValue(loaded);
    const Part = lazyPart(load);

    const first = renderPart(Part);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText('Loading')).toBeNull();
    expect(first.container.textContent).toBe('');
    first.unmount();

    renderPart(Part, 'Grace');
    expect(await screen.findByText('Hello Grace')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('renders its fallback with the part props when the chunk cannot load', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    function Offline({ name }: { name: string }) {
      return <p>{name} is offline</p>;
    }
    const Part = lazyPart<{ name: string }>(offline, Offline);
    renderPart(Part);
    expect(await screen.findByText('Ada is offline')).toBeTruthy();
  });

  it('tries once per mount, so a failed part does not keep loading while it stays up', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const load = vi.fn<() => Promise<typeof loaded>>(offline);
    const Part = lazyPart(load);
    const view = renderPart(Part);
    await act(async () => {
      await Promise.resolve();
    });
    view.rerender(
      <Suspense fallback={<p>Loading</p>}>
        <Part name="Lin" />
      </Suspense>
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.container.textContent).toBe('');
    expect(load).toHaveBeenCalledOnce();
  });

  it('shares one load between parts mounted together', async () => {
    const load = vi.fn(() => Promise.resolve(loaded));
    const Part = lazyPart(load);
    render(
      <Suspense fallback={null}>
        <Part name="Ada" />
        <Part name="Grace" />
      </Suspense>
    );
    expect(await screen.findByText('Hello Grace')).toBeTruthy();
    expect(screen.getByText('Hello Ada')).toBeTruthy();
    expect(load).toHaveBeenCalledOnce();
  });
});
