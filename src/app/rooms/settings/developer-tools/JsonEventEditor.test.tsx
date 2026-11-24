// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixError } from 'matrix-js-sdk';
import { JsonEventEditor } from './JsonEventEditor';

describe('JsonEventEditor failures', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const submitRejectedWith = async (error: unknown) => {
    const onSubmit = vi.fn(() => Promise.reject(error));
    act(() =>
      root.render(
        <JsonEventEditor
          kind="state"
          initial={{ type: 'm.room.topic', stateKey: '', content: { topic: 'Hello' } }}
          onSubmit={onSubmit}
          onDone={vi.fn()}
        />
      )
    );
    await act(async () => {
      host.querySelector('form')?.requestSubmit();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onSubmit).toHaveBeenCalledOnce();
    return host.querySelector('[role="alert"]');
  };

  it("says what the server's refusal means and keeps its code and explanation", async () => {
    const alert = await submitRejectedWith(
      new MatrixError(
        { errcode: 'M_FORBIDDEN', error: 'You don’t have permission to post that to the room.' },
        403,
        'https://example.org/_matrix/client/v3/rooms/!r/state/m.room.topic/'
      )
    );

    expect(alert?.firstChild?.textContent).toBe("You don't have permission to do this.");
    expect(alert?.querySelector('bdi')?.textContent).toBe(
      'M_FORBIDDEN: You don’t have permission to post that to the room.'
    );
    expect(alert?.textContent).not.toContain('https://');
  });

  it("says something went wrong for an error it does not know, beside the error's text", async () => {
    const alert = await submitRejectedWith(new Error('Event too old to replace'));

    expect(alert?.firstChild?.textContent).toBe('Something went wrong.');
    expect(alert?.querySelector('bdi')?.textContent).toBe('Event too old to replace');
  });

  it('rejects invalid JSON, disables controls while pending, and ignores a queued double-submit', async () => {
    let resolveSubmit!: () => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        })
    );
    const onDone = vi.fn();
    act(() =>
      root.render(
        <JsonEventEditor
          kind="state"
          initial={{ type: 'm.room.topic', stateKey: '', content: { topic: 'Hello' } }}
          onSubmit={onSubmit}
          onDone={onDone}
        />
      )
    );
    const form = host.querySelector('form')!;
    const textarea = host.querySelector('textarea')!;
    const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;

    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => {
      setValue.call(textarea, '{bad');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      form.requestSubmit();
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      'Give the event a type and content that is a JSON object.'
    );
    expect(textarea.value).toBe('{bad');

    act(() => {
      setValue.call(textarea, '{"topic":"Next"}');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      form.requestSubmit();
      form.requestSubmit();
    });
    expect(submit.disabled).toBe(true);
    expect(textarea.disabled).toBe(true);
    expect(host.querySelector('[role="alert"]')).toBeNull();

    await act(async () => {
      resolveSubmit();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
