import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Scheduler = {
  unstable_NormalPriority: number;
  unstable_scheduleCallback: (priority: number, callback: () => void) => unknown;
};

const require = createRequire(import.meta.url);

/**
 * Evaluates a shipped React Scheduler build against a deterministic browser host.
 * WebKit brokers MessagePorts through its networking process; when that process
 * exits it discards queued port messages and closes every existing port without
 * an event, while ports created afterwards work. `severPorts` reproduces that loss.
 */
const createSchedulerHost = (build: string) => {
  let now = 0;
  let nextTimerId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const messageTasks: Array<() => void> = [];
  const channels: Array<{ severed: boolean }> = [];

  class HostMessageChannel {
    port1: { onmessage: ((event: { data: unknown }) => void) | null } = { onmessage: null };

    port2: { postMessage: (data: unknown) => void };

    constructor() {
      const channel = { severed: false };
      channels.push(channel);
      this.port2 = {
        postMessage: (data) => {
          if (channel.severed) return;
          messageTasks.push(() => {
            if (!channel.severed) this.port1.onmessage?.({ data });
          });
        },
      };
    }
  }

  const deliverMessages = () => {
    while (messageTasks.length > 0) messageTasks.shift()!();
  };
  const setTimeout = (callback: () => void, delay = 0) => {
    const id = nextTimerId;
    nextTimerId += 1;
    timers.set(id, { at: now + Math.max(0, delay), callback });
    return id;
  };
  const clearTimeout = (id: number) => {
    timers.delete(id);
  };
  const advance = (ms: number, { deliver = true } = {}) => {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort(([leftId, left], [rightId, right]) => left.at - right.at || leftId - rightId)[0];
      if (!due) break;
      const [id, timer] = due;
      timers.delete(id);
      now = timer.at;
      timer.callback();
      if (deliver) deliverMessages();
    }
    now = target;
  };

  const context = {
    exports: {} as Scheduler,
    process: { env: { NODE_ENV: build.includes('production') ? 'production' : 'development' } },
    console,
    Date,
    MessageChannel: HostMessageChannel,
    performance: { now: () => now },
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(readFileSync(require.resolve(build), 'utf8'), context);

  return {
    scheduler: context.exports,
    advance,
    channelCount: () => channels.length,
    deliverMessages,
    pendingTimerCount: () => timers.size,
    severPorts: () => {
      messageTasks.length = 0;
      channels.forEach((channel) => {
        channel.severed = true;
      });
    },
  };
};

const BUILDS = [
  'scheduler/cjs/scheduler.development.js',
  'scheduler/cjs/scheduler.production.min.js',
] as const;

describe.each(BUILDS)('React Scheduler MessagePort loss (%s)', (build) => {
  it('runs work queued behind a wakeup that WebKit discarded', () => {
    const host = createSchedulerHost(build);
    const { scheduler } = host;
    const ran: string[] = [];

    scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
      ran.push('before loss');
    });
    host.severPorts();
    host.deliverMessages();
    expect(ran).toEqual([]);

    host.advance(1000);
    expect(ran).toEqual(['before loss']);

    scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
      ran.push('after recovery');
    });
    host.deliverMessages();
    expect(ran).toEqual(['before loss', 'after recovery']);
  });

  it('recovers when the port dies while the message loop is idle', () => {
    const host = createSchedulerHost(build);
    const { scheduler } = host;
    const ran: string[] = [];

    scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
      ran.push('healthy');
    });
    host.deliverMessages();
    host.severPorts();

    scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
      ran.push('first after loss');
    });
    host.deliverMessages();
    expect(ran).toEqual(['healthy']);

    host.advance(1000);
    scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
      ran.push('second after loss');
    });
    host.deliverMessages();
    expect(ran).toEqual(['healthy', 'first after loss', 'second after loss']);
  });

  it('keeps one port and no idle timer while wakeups arrive', () => {
    const host = createSchedulerHost(build);
    const { scheduler } = host;
    let runs = 0;

    for (let index = 0; index < 50; index += 1) {
      scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
        runs += 1;
      });
      host.deliverMessages();
      host.advance(10);
    }
    host.advance(1000);

    expect(runs).toBe(50);
    expect(host.channelCount()).toBe(1);
    expect(host.pendingTimerCount()).toBe(0);
  });

  it('runs a slow wakeup once when the original port delivers late', () => {
    const host = createSchedulerHost(build);
    const { scheduler } = host;
    let runs = 0;

    scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
      runs += 1;
    });
    // A long task delays the original delivery past the replacement timeout.
    host.advance(1000, { deliver: false });
    host.deliverMessages();
    expect(runs).toBe(1);

    scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => {
      runs += 1;
    });
    host.deliverMessages();
    expect(runs).toBe(2);
  });
});
