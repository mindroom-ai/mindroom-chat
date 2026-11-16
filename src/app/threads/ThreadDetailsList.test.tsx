// @vitest-environment jsdom
import { lazy, Suspense, type ComponentType } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import type { Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShownThreadDetail, ThreadDetailProps } from '../plugins/threadDetails';
import { ThreadDetailsList } from './ThreadDetailsList';

const mocks = vi.hoisted(() => ({ reportBoundaryError: vi.fn() }));
vi.mock('../bug-reports/error-reporting/errorReporting', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reportBoundaryError: mocks.reportBoundaryError,
}));

const room = { roomId: '!room:example.org' } as Room;

/** A detail that shows its label with the room and thread it was given. */
const named = (label: string) =>
  function Named({ room: detailRoom, threadId }: ThreadDetailProps) {
    return <span data-detail={label}>{`${label} ${detailRoom.roomId} ${threadId}`}</span>;
  };

const Broken = (): never => {
  throw new Error('boom');
};

/** A detail whose code never loads. */
const NeverLoads = lazy<ComponentType<ThreadDetailProps>>(() => new Promise(() => undefined));

const detail = (id: string, Component: ShownThreadDetail['Component']): ShownThreadDetail => ({
  key: `${id}/0`,
  tag: `${id}@1.0.0`,
  Component,
});

const renderDetails = (details: readonly ShownThreadDetail[]) =>
  render(<ThreadDetailsList room={room} threadId="$root" details={details} />);

const shown = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-detail]'), (detail) => detail.textContent);

describe('ThreadDetailsList', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mocks.reportBoundaryError.mockReset();
  });

  it("renders each detail in the order given, with the thread's room and root", () => {
    const { container } = renderDetails([
      detail('alpha', named('first')),
      detail('beta', named('second')),
    ]);
    expect(
      Array.from(container.querySelectorAll('[data-thread-detail]'), (node) =>
        node.getAttribute('data-thread-detail')
      )
    ).toEqual(['alpha/0', 'beta/0']);
    expect(shown(container)).toEqual([
      'first !room:example.org $root',
      'second !room:example.org $root',
    ]);
  });

  it("leaves out a detail that throws, keeps the other, and reports it once under its plugin's tag", () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container } = renderDetails([
      detail('broken', Broken),
      detail('alpha', named('first')),
    ]);
    expect(container.querySelector('[data-thread-detail]')?.childNodes).toHaveLength(0);
    expect(shown(container)).toEqual(['first !room:example.org $root']);
    expect(mocks.reportBoundaryError).toHaveBeenCalledTimes(1);
    expect(mocks.reportBoundaryError).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Error', message: '[plugin broken@1.0.0] boom' }),
      expect.any(String)
    );
    expect(
      vi
        .mocked(console.error)
        .mock.calls.some(([first]) =>
          String(first).includes('[plugin broken@1.0.0] failed to render its thread details')
        )
    ).toBe(true);
  });

  it('keeps the page and the other details while one waits for its code', () => {
    // The page's own boundary, which would show its fallback in place of the page.
    const { container } = render(
      <Suspense fallback={<p>Page loading</p>}>
        <span data-testid="page-text">Thread title</span>
        <ThreadDetailsList
          room={room}
          threadId="$root"
          details={[detail('waiting', NeverLoads), detail('alpha', named('first'))]}
        />
      </Suspense>
    );
    expect(screen.queryByText('Page loading')).toBeNull();
    expect(screen.getByTestId('page-text')).toBeTruthy();
    expect(container.querySelector('[data-thread-detail]')?.childNodes).toHaveLength(0);
    expect(shown(container)).toEqual(['first !room:example.org $root']);
    expect(mocks.reportBoundaryError).not.toHaveBeenCalled();
  });
});
