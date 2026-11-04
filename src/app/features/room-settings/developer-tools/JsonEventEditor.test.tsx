// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
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
});
