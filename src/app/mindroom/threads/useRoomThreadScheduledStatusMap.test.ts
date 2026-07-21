import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { describe, expect, it, vi } from 'vitest';
import type { ThreadScheduledStatus } from './threadScheduledStatus';
import { useRoomThreadScheduledStatusMap } from './useRoomThreadScheduledStatusMap';

const cronEvaluationSpy = vi.hoisted(() => vi.fn());

vi.mock('croner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('croner')>();
  return {
    ...actual,
    Cron: (...args: Parameters<typeof actual.Cron>) => {
      cronEvaluationSpy(args[0]);
      return actual.Cron(...args);
    },
  };
});

describe('useRoomThreadScheduledStatusMap', () => {
  it('refreshes a stable mutable event array when the overview signal changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-04T18:00:00.000Z'));

    let renderer: ReactTestRenderer | undefined;
    try {
      const room = {} as Room;
      let content: Record<string, unknown> = {
        status: 'pending',
        thread_id: '$thread',
        new_thread: false,
        execute_at: '2026-04-04T18:05:00.000Z',
      };
      const event = {
        getStateKey: () => 'mutable-task',
        getContent: () => content,
      } as unknown as MatrixEvent;
      const scheduledTaskEvents = [event];
      let latestStatusMap: ReadonlyMap<string, ThreadScheduledStatus> = new Map();

      const Harness = ({ refreshSignal }: { refreshSignal: number }) => {
        latestStatusMap = useRoomThreadScheduledStatusMap(
          room,
          scheduledTaskEvents,
          true,
          refreshSignal
        );
        return null;
      };

      act(() => {
        renderer = create(React.createElement(Harness, { refreshSignal: 0 }));
      });

      expect(latestStatusMap.get('$thread')).toEqual({
        scheduledTaskCount: 1,
        nextScheduledTs: Date.parse('2026-04-04T18:05:00.000Z'),
      });
      expect(vi.getTimerCount()).toBe(1);

      vi.setSystemTime(new Date('2026-04-04T18:06:00.000Z'));
      act(() => {
        renderer?.update(React.createElement(Harness, { refreshSignal: 1 }));
      });

      expect(latestStatusMap.get('$thread')).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);

      content = {
        ...content,
        execute_at: '2026-04-04T18:10:00.000Z',
      };
      act(() => {
        renderer?.update(React.createElement(Harness, { refreshSignal: 2 }));
      });

      expect(latestStatusMap.get('$thread')).toEqual({
        scheduledTaskCount: 1,
        nextScheduledTs: Date.parse('2026-04-04T18:10:00.000Z'),
      });
      expect(scheduledTaskEvents[0]).toBe(event);
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      if (renderer) {
        act(() => {
          renderer?.unmount();
        });
      }
      expect(vi.getTimerCount()).toBe(0);
      vi.useRealTimers();
    }
  });

  it('continues deferred room cron work through the existing one-shot lifecycle', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-04T18:02:30.000Z'));

    let renderer: ReactTestRenderer | undefined;
    try {
      const room = {} as Room;
      const events = Array.from({ length: 33 }, (_value, index) => {
        const minute = index % 60;
        const hour = Math.floor(index / 60) % 24;
        return {
          getStateKey: () => `valid-${index}`,
          getContent: () => ({
            status: 'pending',
            thread_id: `$valid-${index}`,
            new_thread: false,
            cron_schedule: `${minute} ${hour} * * *`,
          }),
        } as unknown as MatrixEvent;
      });
      let latestStatusMap: ReadonlyMap<string, ThreadScheduledStatus> = new Map();

      const Harness = () => {
        latestStatusMap = useRoomThreadScheduledStatusMap(room, events, true, 0);
        return null;
      };
      cronEvaluationSpy.mockClear();

      act(() => {
        renderer = create(React.createElement(Harness));
      });

      expect(cronEvaluationSpy).toHaveBeenCalledTimes(32);
      expect(latestStatusMap.get('$valid-32')).toMatchObject({
        scheduledTaskCount: 1,
        nextScheduledTs: undefined,
        hasDeferredCronEvaluation: true,
      });

      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(cronEvaluationSpy).toHaveBeenCalledTimes(33);
      expect(latestStatusMap.get('$valid-32')?.nextScheduledTs).toBeDefined();
      expect(latestStatusMap.get('$valid-32')?.hasDeferredCronEvaluation).toBeUndefined();
    } finally {
      if (renderer) {
        act(() => {
          renderer?.unmount();
        });
      }
      expect(vi.getTimerCount()).toBe(0);
      vi.useRealTimers();
    }
  });

  it('preserves terminal exhaustion across unrelated overview refresh signals', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-04T18:02:30.000Z'));

    let renderer: ReactTestRenderer | undefined;
    try {
      const room = {} as Room;
      const cronSchedules = Array.from({ length: 500 }, (_value, index) => {
        const minute = index % 60;
        const hour = Math.floor(index / 60) % 24;
        return `${minute} ${hour} * * *`;
      });
      const events = Array.from({ length: 500 }, (_value, index) => {
        return {
          getStateKey: () => `bounded-${index}`,
          getContent: () => ({
            status: 'pending',
            thread_id: `$bounded-${index}`,
            new_thread: false,
            cron_schedule: cronSchedules[index],
          }),
        } as unknown as MatrixEvent;
      });
      let latestStatusMap: ReadonlyMap<string, ThreadScheduledStatus> = new Map();

      const Harness = ({ refreshSignal }: { refreshSignal: number }) => {
        latestStatusMap = useRoomThreadScheduledStatusMap(room, events, true, refreshSignal, false);
        return null;
      };
      cronEvaluationSpy.mockClear();

      act(() => {
        renderer = create(React.createElement(Harness, { refreshSignal: 0 }));
      });
      for (let continuation = 0; continuation < 7; continuation += 1) {
        act(() => {
          vi.advanceTimersByTime(1);
        });
      }

      expect(cronEvaluationSpy).toHaveBeenCalledTimes(256);
      expect(latestStatusMap.get('$bounded-255')?.nextScheduledTs).toBeDefined();
      expect(latestStatusMap.get('$bounded-256')).toEqual({
        scheduledTaskCount: 1,
        nextScheduledTs: undefined,
      });

      act(() => {
        renderer?.update(React.createElement(Harness, { refreshSignal: 1 }));
      });
      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(cronEvaluationSpy).toHaveBeenCalledTimes(256);
      expect(latestStatusMap.get('$bounded-256')).toEqual({
        scheduledTaskCount: 1,
        nextScheduledTs: undefined,
      });
      expect(
        [...latestStatusMap.values()].every(
          ({ hasDeferredCronEvaluation }) => hasDeferredCronEvaluation === undefined
        )
      ).toBe(true);

      cronSchedules[499] = '20 9 * * *';
      act(() => {
        renderer?.update(React.createElement(Harness, { refreshSignal: 2 }));
      });

      expect(cronEvaluationSpy).toHaveBeenCalledTimes(288);
      expect(
        [...latestStatusMap.values()].some(
          ({ hasDeferredCronEvaluation }) => hasDeferredCronEvaluation === true
        )
      ).toBe(true);
    } finally {
      if (renderer) {
        act(() => {
          renderer?.unmount();
        });
      }
      vi.useRealTimers();
    }
  });

  it('does not repeat capacity-plus-one failed searches across equivalent rebuilds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-04T18:02:30.000Z'));

    let renderer: ReactTestRenderer | undefined;
    try {
      const room = {} as Room;
      const impossibleCount = 2049;
      const impossibleEvents = Array.from({ length: impossibleCount }, (_value, index) => {
        const minute = index % 60;
        const hour = Math.floor(index / 60) % 24;
        const weekday = Math.floor(index / (60 * 24)) % 7;
        return {
          getStateKey: () => `impossible-${index}`,
          getContent: () => ({
            status: 'pending',
            thread_id: `$impossible-${index}`,
            new_thread: false,
            cron_schedule: `${minute} ${hour} 31 2 ${weekday}`,
          }),
        } as unknown as MatrixEvent;
      });
      const validEvent = {
        getStateKey: () => 'valid',
        getContent: () => ({
          status: 'pending',
          thread_id: '$valid',
          new_thread: false,
          cron_schedule: '*/5 * * * *',
        }),
      } as unknown as MatrixEvent;
      const scheduledTaskEvents = [validEvent, ...impossibleEvents];
      let latestStatusMap: ReadonlyMap<string, ThreadScheduledStatus> = new Map();

      const Harness = ({
        events,
        refreshSignal,
      }: {
        events: readonly MatrixEvent[];
        refreshSignal: number;
      }) => {
        latestStatusMap = useRoomThreadScheduledStatusMap(room, events, true, refreshSignal);
        return null;
      };
      cronEvaluationSpy.mockClear();

      act(() => {
        renderer = create(
          React.createElement(Harness, { events: scheduledTaskEvents, refreshSignal: 0 })
        );
      });

      expect(latestStatusMap.get('$valid')?.nextScheduledTs).toBe(
        Date.parse('2026-04-04T18:05:00.000Z')
      );
      expect(cronEvaluationSpy).toHaveBeenCalledTimes(1);

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(cronEvaluationSpy).toHaveBeenCalledTimes(1);

      const refreshedScheduledTaskEvents = [...scheduledTaskEvents];
      act(() => {
        renderer?.update(
          React.createElement(Harness, { events: refreshedScheduledTaskEvents, refreshSignal: 0 })
        );
      });

      expect(cronEvaluationSpy).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date('2026-04-04T18:05:01.000Z'));
      act(() => {
        renderer?.update(
          React.createElement(Harness, {
            events: refreshedScheduledTaskEvents,
            refreshSignal: 1,
          })
        );
      });

      expect(latestStatusMap.get('$valid')).toEqual({
        scheduledTaskCount: 1,
        nextScheduledTs: undefined,
      });
      expect(cronEvaluationSpy).toHaveBeenCalledTimes(1);
    } finally {
      if (renderer) {
        act(() => {
          renderer?.unmount();
        });
      }
      vi.useRealTimers();
    }
  });

  it('only runs display-cadence refreshes while the compact countdown surface is active', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-04T18:00:00.000Z'));

    let renderer: ReactTestRenderer | undefined;
    try {
      const room = {} as Room;
      const events = [
        {
          getStateKey: () => 'future-task',
          getContent: () => ({
            status: 'pending',
            thread_id: '$thread',
            new_thread: false,
            execute_at: '2026-04-04T18:05:00.000Z',
          }),
        } as unknown as MatrixEvent,
      ];
      let renderCount = 0;

      const Harness = ({ compact }: { compact: boolean }) => {
        renderCount += 1;
        useRoomThreadScheduledStatusMap(room, events, true, 0, compact);
        return null;
      };

      act(() => {
        renderer = create(React.createElement(Harness, { compact: false }));
      });
      expect(renderCount).toBe(1);

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(renderCount).toBe(1);

      act(() => {
        renderer?.update(React.createElement(Harness, { compact: true }));
      });
      expect(renderCount).toBe(2);

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(renderCount).toBe(3);
    } finally {
      if (renderer) {
        act(() => {
          renderer?.unmount();
        });
      }
      expect(vi.getTimerCount()).toBe(0);
      vi.useRealTimers();
    }
  });

  it('refreshes a count-only aggregate when its known sibling occurrence elapses', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-04T18:00:00.000Z'));

    let renderer: ReactTestRenderer | undefined;
    try {
      const room = {} as Room;
      const makeEvent = (stateKey: string, timing: Record<string, unknown>) =>
        ({
          getStateKey: () => stateKey,
          getContent: () => ({
            status: 'pending',
            thread_id: '$thread',
            new_thread: false,
            ...timing,
          }),
        } as unknown as MatrixEvent);
      const events = [
        makeEvent('unknown', { cron_schedule: '0 0 ? * *' }),
        makeEvent('known', { execute_at: '2026-04-04T18:05:00.000Z' }),
      ];
      let latestStatusMap: ReadonlyMap<string, ThreadScheduledStatus> = new Map();

      const Harness = () => {
        latestStatusMap = useRoomThreadScheduledStatusMap(room, events, true, 0, false);
        return null;
      };

      act(() => {
        renderer = create(React.createElement(Harness));
      });
      expect(latestStatusMap.get('$thread')).toMatchObject({
        scheduledTaskCount: 2,
        nextScheduledTs: undefined,
        nextScheduledRefreshTs: Date.parse('2026-04-04T18:05:00.000Z'),
      });

      act(() => {
        vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      });
      expect(latestStatusMap.get('$thread')).toEqual({
        scheduledTaskCount: 1,
        nextScheduledTs: undefined,
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      if (renderer) {
        act(() => {
          renderer?.unmount();
        });
      }
      expect(vi.getTimerCount()).toBe(0);
      vi.useRealTimers();
    }
  });
});
