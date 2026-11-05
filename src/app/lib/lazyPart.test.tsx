// @vitest-environment jsdom
import { type RefAttributes, Suspense, createRef, forwardRef, useImperativeHandle } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type PartLoadRetry, lazyPart } from './lazyPart';

function Greeting({ name }: { name: string }) {
  return <p>Hello {name}</p>;
}

const loaded = { default: Greeting };

type Greeter = { greet(): string };

/** A part with a handle, as the computer screen has. */
const GreetingWithHandle = forwardRef<Greeter, { name: string }>(function GreetingWithHandle(
  { name },
  ref
) {
  useImperativeHandle(ref, () => ({ greet: () => `Hello ${name}` }), [name]);
  return <p>{name} has a handle</p>;
});
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

  it('hands a ref to the loaded component', async () => {
    const errors = vi.spyOn(console, 'error');
    const Part = lazyPart(() => Promise.resolve({ default: GreetingWithHandle }));
    const handle = createRef<Greeter>();
    render(
      <Suspense fallback={null}>
        <Part ref={handle} name="Ada" />
      </Suspense>
    );
    expect(await screen.findByText('Ada has a handle')).toBeTruthy();
    expect(handle.current?.greet()).toBe('Hello Ada');
    expect(errors).not.toHaveBeenCalled();
  });

  it('leaves the ref empty when the chunk cannot load, and renders the fallback without a ref', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errors = vi.spyOn(console, 'error');
    function Offline({ name }: { name: string }) {
      return <p>{name} is offline</p>;
    }
    const Part = lazyPart<{ name: string } & RefAttributes<Greeter>>(offline, Offline);
    const handle = createRef<Greeter>();
    render(
      <Suspense fallback={null}>
        <Part ref={handle} name="Ada" />
      </Suspense>
    );
    expect(await screen.findByText('Ada is offline')).toBeTruthy();
    expect(handle.current).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  describe('retryLoad', () => {
    function Offline({ name, retryLoad }: { name: string } & PartLoadRetry) {
      return (
        <button
          type="button"
          onClick={() => {
            retryLoad().catch(() => undefined);
          }}
        >
          Retry {name}
        </button>
      );
    }

    it('replaces the fallback with the part, and later mounts use it', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const load = vi.fn<() => Promise<typeof loaded>>().mockImplementationOnce(offline);
      load.mockResolvedValue(loaded);
      const Part = lazyPart<{ name: string }>(load, Offline);

      const first = renderPart(Part);
      fireEvent.click(await screen.findByRole('button', { name: 'Retry Ada' }));
      expect(await screen.findByText('Hello Ada')).toBeTruthy();
      expect(load).toHaveBeenCalledTimes(2);
      first.unmount();

      renderPart(Part, 'Grace');
      expect(await screen.findByText('Hello Grace')).toBeTruthy();
      expect(load).toHaveBeenCalledTimes(2);
    });

    it('hands the ref to the part a retry loaded', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const load = vi
        .fn<() => Promise<{ default: typeof GreetingWithHandle }>>()
        .mockImplementationOnce(offline)
        .mockResolvedValue({ default: GreetingWithHandle });
      const Part = lazyPart<{ name: string } & RefAttributes<Greeter>>(load, Offline);
      const handle = createRef<Greeter>();
      render(
        <Suspense fallback={null}>
          <Part ref={handle} name="Ada" />
        </Suspense>
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Retry Ada' }));
      expect(await screen.findByText('Ada has a handle')).toBeTruthy();
      expect(handle.current?.greet()).toBe('Hello Ada');
    });

    it('rejects and keeps the fallback when the load fails again', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      let retry: (() => Promise<void>) | undefined;
      function Remember({ retryLoad }: { name: string } & PartLoadRetry) {
        retry = retryLoad;
        return <p>Unavailable</p>;
      }
      const load = vi.fn<() => Promise<typeof loaded>>(offline);
      const Part = lazyPart<{ name: string }>(load, Remember);
      renderPart(Part);
      expect(await screen.findByText('Unavailable')).toBeTruthy();

      await act(async () => {
        await expect(retry?.()).rejects.toThrow('Failed to fetch dynamically imported module');
      });
      expect(screen.getByText('Unavailable')).toBeTruthy();
      expect(load).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledTimes(2);
    });
  });
});
