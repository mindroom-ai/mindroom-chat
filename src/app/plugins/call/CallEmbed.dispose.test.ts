import { EventEmitter } from 'events';
import { ClientEvent, MatrixEvent, MatrixEventEvent, RoomStateEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallEmbed } from './CallEmbed';

/**
 * `CallEmbed.dispose()` partial-failure behavior: the
 * `callEmbedAtom` setter catches dispose errors and then drops its only
 * reference, so a step that throws must not prevent the remaining steps —
 * otherwise a live iframe/media session leaks unreachably behind a UI that
 * reports no active call.
 *
 * The harness builds an instance over the real prototype without running the
 * constructor (which would require a live widget transport); it pins the
 * dispose sequence only. The listener-identity test below additionally runs
 * the real `start()` registration against a real EventEmitter.
 */

type DisposeHarness = {
  embed: CallEmbed;
  widgetDisposableA: ReturnType<typeof vi.fn>;
  widgetDisposableB: ReturnType<typeof vi.fn>;
  driverDispose: ReturnType<typeof vi.fn>;
  transportStop: ReturnType<typeof vi.fn>;
  removeChild: ReturnType<typeof vi.fn>;
  controlDispose: ReturnType<typeof vi.fn>;
  clientOff: ReturnType<typeof vi.fn>;
};

const createDisposeHarness = (): DisposeHarness => {
  const widgetDisposableA = vi.fn();
  const widgetDisposableB = vi.fn();
  const driverDispose = vi.fn();
  const transportStop = vi.fn();
  const removeChild = vi.fn();
  const controlDispose = vi.fn();
  const clientOff = vi.fn();

  const embed = Object.create(CallEmbed.prototype) as CallEmbed;
  Object.assign(embed as unknown as Record<string, unknown>, {
    disposables: [widgetDisposableA, widgetDisposableB],
    callWidgetDriver: { dispose: driverDispose },
    call: { stop: transportStop },
    iframe: {},
    container: { removeChild },
    control: { dispose: controlDispose },
    mx: { off: clientOff },
    // The bound references start() would have created and registered.
    boundOnEvent: () => undefined,
    boundOnEventDecrypted: () => undefined,
    boundOnStateUpdate: () => undefined,
    boundOnToDeviceEvent: async () => undefined,
    readUpToMap: {},
    eventsToFeed: new WeakSet(),
    disposed: false,
  });

  return {
    embed,
    widgetDisposableA,
    widgetDisposableB,
    driverDispose,
    transportStop,
    removeChild,
    controlDispose,
    clientOff,
  };
};

describe('CallEmbed.dispose', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('attempts every teardown step even when earlier steps throw', () => {
    const h = createDisposeHarness();
    h.widgetDisposableA.mockImplementation(() => {
      throw new Error('listener already removed');
    });
    h.driverDispose.mockImplementation(() => {
      throw new Error('driver broken');
    });
    h.transportStop.mockImplementation(() => {
      throw new Error('transport already stopped');
    });
    h.removeChild.mockImplementation(() => {
      throw new Error('iframe already detached');
    });
    // One throwing client-listener removal must not leak the other three.
    h.clientOff.mockImplementationOnce(() => {
      throw new Error('emitter broken');
    });

    expect(() => h.embed.dispose()).not.toThrow();

    // Every step after each failure still ran: the second widget listener,
    // the transport stop, the iframe removal attempt, the control disposal
    // and all four client listener removals.
    expect(h.widgetDisposableB).toHaveBeenCalledTimes(1);
    expect(h.transportStop).toHaveBeenCalledTimes(1);
    expect(h.removeChild).toHaveBeenCalledTimes(1);
    expect(h.controlDispose).toHaveBeenCalledTimes(1);
    expect(h.clientOff).toHaveBeenCalledTimes(4);
    // One redacted diagnostic per failed step.
    expect(warn).toHaveBeenCalledTimes(5);
  });

  it('is idempotent: a second dispose runs no step again', () => {
    const h = createDisposeHarness();

    h.embed.dispose();
    h.embed.dispose();

    expect(h.widgetDisposableA).toHaveBeenCalledTimes(1);
    expect(h.driverDispose).toHaveBeenCalledTimes(1);
    expect(h.transportStop).toHaveBeenCalledTimes(1);
    expect(h.removeChild).toHaveBeenCalledTimes(1);
    expect(h.controlDispose).toHaveBeenCalledTimes(1);
    expect(h.clientOff).toHaveBeenCalledTimes(4);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a to-device event decrypting across dispose is consumed without feeding the widget', async () => {
    // Review A4 (round 5): dispose() removes the listener, but a callback
    // already awaiting decryptEventIfNeeded stays live. When it resumes over
    // the stopped transport it must feed nothing and reject nothing —
    // emitters never consume async listener results, so any rejection here
    // is unhandled by construction.
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const emitter = new EventEmitter();
      let resolveDecrypt!: () => void;
      const mx = Object.assign(emitter, {
        getRooms: () => [],
        getRoom: () => null,
        decryptEventIfNeeded: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveDecrypt = resolve;
            })
        ),
      });
      const feedToDevice = vi.fn(async () => undefined);
      const embed = Object.create(CallEmbed.prototype) as CallEmbed;
      Object.assign(embed as unknown as Record<string, unknown>, {
        mx,
        call: {
          setViewedRoomId: vi.fn(),
          on: vi.fn(),
          off: vi.fn(),
          stop: vi.fn(),
          feedToDevice,
        },
        room: { roomId: '!todevice-dispose:mindroom.test' },
        iframe: { onload: null },
        container: { removeChild: vi.fn() },
        control: { dispose: vi.fn() },
        callWidgetDriver: { dispose: vi.fn() },
        disposables: [],
        readUpToMap: {},
        eventsToFeed: new WeakSet(),
        disposed: false,
      });
      (embed as unknown as { start: () => void }).start();

      const toDeviceEvent = {
        isDecryptionFailure: () => false,
        isEncrypted: () => true,
        getEffectiveEvent: () => ({ type: 'm.room.encrypted' }),
      } as unknown as MatrixEvent;
      emitter.emit(ClientEvent.ToDeviceEvent, toDeviceEvent);
      expect(mx.decryptEventIfNeeded).toHaveBeenCalledTimes(1);

      embed.dispose();
      resolveDecrypt();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });

      expect(feedToDevice).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      process.off('unhandledRejection', onUnhandledRejection);
    }
    expect(unhandled).toEqual([]);
  });

  it('consumes a widget feed rejection on a live embed instead of rejecting unhandled', async () => {
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const emitter = new EventEmitter();
      const mx = Object.assign(emitter, {
        getRooms: () => [],
        getRoom: () => null,
        decryptEventIfNeeded: vi.fn(async () => undefined),
      });
      const feedToDevice = vi.fn(async () => {
        throw new Error('transport is stopping');
      });
      const embed = Object.create(CallEmbed.prototype) as CallEmbed;
      Object.assign(embed as unknown as Record<string, unknown>, {
        mx,
        call: {
          setViewedRoomId: vi.fn(),
          on: vi.fn(),
          off: vi.fn(),
          stop: vi.fn(),
          feedToDevice,
        },
        room: { roomId: '!todevice-reject:mindroom.test' },
        iframe: { onload: null },
        container: { removeChild: vi.fn() },
        control: { dispose: vi.fn() },
        callWidgetDriver: { dispose: vi.fn() },
        disposables: [],
        readUpToMap: {},
        eventsToFeed: new WeakSet(),
        disposed: false,
      });
      (embed as unknown as { start: () => void }).start();

      const toDeviceEvent = {
        isDecryptionFailure: () => false,
        isEncrypted: () => false,
        getEffectiveEvent: () => ({ type: 'io.element.call.encryption_keys' }),
      } as unknown as MatrixEvent;
      emitter.emit(ClientEvent.ToDeviceEvent, toDeviceEvent);
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });

      expect(feedToDevice).toHaveBeenCalledTimes(1);
      // Consumed with one diagnostic, matching the sibling feed paths.
      expect(error).toHaveBeenCalledTimes(1);
      embed.dispose();
    } finally {
      error.mockRestore();
      process.off('unhandledRejection', onUnhandledRejection);
    }
    expect(unhandled).toEqual([]);
  });

  it('removes the exact listeners start() registered and stops handler activity', () => {
    // Regression for the round-4 A5/B1 leak: `off(..., this.onEvent.bind(this))`
    // removed nothing because each bind creates a new function. Run the real
    // registration path against a real emitter and verify listener counts
    // return to zero and no handler fires after disposal.
    const emitter = new EventEmitter();
    const decryptEventIfNeeded = vi.fn();
    const mx = Object.assign(emitter, {
      getRooms: () => [],
      getRoom: () => null,
      decryptEventIfNeeded,
    });
    const iframe: { onload: null | (() => void) } = { onload: () => undefined };
    const embed = Object.create(CallEmbed.prototype) as CallEmbed;
    Object.assign(embed as unknown as Record<string, unknown>, {
      mx,
      call: { setViewedRoomId: vi.fn(), on: vi.fn(), off: vi.fn(), stop: vi.fn() },
      room: { roomId: '!listener-leak:mindroom.test' },
      iframe,
      container: { removeChild: vi.fn() },
      control: { dispose: vi.fn() },
      callWidgetDriver: { dispose: vi.fn() },
      disposables: [],
      readUpToMap: {},
      eventsToFeed: new WeakSet(),
      disposed: false,
    });
    (embed as unknown as { start: () => void }).start();

    const clientEvents = [
      ClientEvent.Event,
      MatrixEventEvent.Decrypted,
      RoomStateEvent.Events,
      ClientEvent.ToDeviceEvent,
    ];
    clientEvents.forEach((event) => {
      expect(emitter.listenerCount(event)).toBe(1);
    });

    const fakeEvent = {
      relationEventId: undefined,
      replyEventId: undefined,
      getId: () => '$live:mindroom.test',
      getRoomId: () => '!listener-leak:mindroom.test',
    } as unknown as MatrixEvent;
    emitter.emit(ClientEvent.Event, fakeEvent);
    expect(decryptEventIfNeeded).toHaveBeenCalledTimes(1);

    embed.dispose();

    clientEvents.forEach((event) => {
      expect(emitter.listenerCount(event)).toBe(0);
    });
    expect(iframe.onload).toBeNull();
    emitter.emit(ClientEvent.Event, fakeEvent);
    expect(decryptEventIfNeeded).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
