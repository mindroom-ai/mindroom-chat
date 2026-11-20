import { describe, expect, it } from 'vitest';
import { VOICE_HOLD_MS, createVoiceHold, type VoiceTargetPhase } from './voiceHold';

type TargetState = {
  active: boolean;
  phase: VoiceTargetPhase;
  content: boolean;
  /** Whether a start is allowed (the mic button's guards). */
  startable: boolean;
};

/** A hold with a hand-driven clock and a composer that records what it was asked to do. */
const setup = (initial: Partial<TargetState> = {}) => {
  let now = 0;
  const timers: Array<{ at: number; run: () => void; live: boolean }> = [];
  const calls: string[] = [];
  const target: TargetState = {
    active: false,
    phase: 'none',
    content: false,
    startable: true,
    ...initial,
  };
  const env = { pending: false, resolvable: true };
  const hold = createVoiceHold({
    delayMs: VOICE_HOLD_MS,
    schedule: (run, ms) => {
      const timer = { at: now + ms, run, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    sendPending: () => env.pending,
    resolve: () =>
      env.resolvable
        ? {
            active: () => target.active,
            phase: () => target.phase,
            hasContent: () => target.content,
            start: () => {
              calls.push('start');
              if (!target.startable) return false;
              target.active = true;
              target.phase = 'requesting';
              return true;
            },
            send: () => calls.push('send'),
            focus: () => calls.push('focus'),
          }
        : undefined,
  });
  const advance = (ms: number) => {
    now += ms;
    timers
      .filter((timer) => timer.live && timer.at <= now)
      .forEach((timer) => {
        timer.live = false;
        timer.run();
      });
  };
  return { hold, advance, calls, target, env };
};

describe('createVoiceHold', () => {
  it('holds for 300 ms', () => {
    expect(VOICE_HOLD_MS).toBe(300);
  });

  describe('with no recording', () => {
    it('starts a hands-free recording on a tap, which keeps running', () => {
      const { hold, advance, calls } = setup();
      hold.keyDown(false);
      advance(299);
      expect(calls).toEqual([]);
      expect(hold.keyUp()).toBe(true);
      advance(1000);
      expect(calls).toEqual(['start']);
      expect(hold.state).toBe('idle');
    });

    it('starts recording once held for 300 ms, and sends it on release (push-to-talk)', () => {
      const { hold, advance, calls, target } = setup();
      hold.keyDown(false);
      advance(300);
      expect(calls).toEqual(['start']);
      expect(hold.state).toBe('talking');
      // Auto-repeat of the held key changes nothing.
      hold.keyDown(true);
      target.phase = 'recording';
      advance(2000);
      expect(hold.keyUp()).toBe(true);
      expect(calls).toEqual(['start', 'send']);
    });

    it('latches on release while the composer holds text or attachments', () => {
      const { hold, advance, calls, target } = setup();
      hold.keyDown(false);
      advance(300);
      target.phase = 'recording';
      target.content = true;
      expect(hold.keyUp()).toBe(true);
      expect(calls).toEqual(['start']);
    });

    it('latches while the microphone permission still prompts, never queueing a send', () => {
      const { hold, advance, calls, target } = setup();
      hold.keyDown(false);
      advance(300);
      expect(target.phase).toBe('requesting');
      hold.keyUp();
      target.phase = 'recording';
      advance(5000);
      expect(calls).toEqual(['start']);
    });

    it('latches when another key, a click, a blur or hiding the page comes during the hold', () => {
      const { hold, advance, calls, target } = setup();
      hold.keyDown(false);
      advance(300);
      target.phase = 'recording';
      hold.interrupt();
      expect(hold.state).toBe('ignored');
      hold.keyDown(true);
      hold.keyUp();
      expect(calls).toEqual(['start']);
      expect(hold.state).toBe('idle');
    });

    it('does nothing when the start is refused (the mic button would be disabled)', () => {
      const { hold, advance, calls } = setup({ startable: false });
      hold.keyDown(false);
      advance(300);
      expect(hold.state).toBe('ignored');
      expect(hold.keyUp()).toBe(false);
      expect(calls).toEqual(['start']);

      hold.keyDown(false);
      expect(hold.keyUp()).toBe(false);
    });
  });

  describe('arming', () => {
    it.each(['another key (as in ⌥- for a dash)', 'a mouse button', 'the wheel', 'a blur'])(
      'is cancelled by %s before the threshold, and nothing happens',
      () => {
        const { hold, advance, calls } = setup();
        hold.keyDown(false);
        advance(100);
        hold.interrupt();
        advance(1000);
        hold.keyDown(true);
        expect(hold.keyUp()).toBe(false);
        expect(calls).toEqual([]);
      }
    );

    it('ignores a repeat with no press before it, and a new press after a lost release starts over', () => {
      const { hold, advance, calls } = setup();
      hold.keyDown(true);
      advance(1000);
      expect(calls).toEqual([]);
      hold.keyUp();
      hold.keyDown(false);
      advance(100);
      // The release happened outside the window.
      hold.interrupt();
      hold.keyDown(false);
      hold.keyUp();
      expect(calls).toEqual(['start']);
    });

    it('does nothing without a composer to record in', () => {
      const { hold, advance, calls, env } = setup();
      env.resolvable = false;
      hold.keyDown(false);
      advance(1000);
      expect(hold.keyUp()).toBe(false);
      expect(calls).toEqual([]);
    });

    it('does nothing while a voice message is being sent', () => {
      const { hold, advance, calls, env } = setup({ active: true, phase: 'recording' });
      env.pending = true;
      hold.keyDown(false);
      advance(1000);
      expect(hold.keyUp()).toBe(false);
      expect(calls).toEqual([]);
    });

    it('starts nothing when a send begins during the hold', () => {
      const { hold, advance, calls, env } = setup();
      hold.keyDown(false);
      env.pending = true;
      advance(300);
      expect(hold.keyUp()).toBe(false);
      expect(calls).toEqual([]);
    });
  });

  describe('with a recording already running', () => {
    it('sends it on a press and release, short or long', () => {
      const { hold, advance, calls } = setup({ active: true, phase: 'recording' });
      hold.keyDown(false);
      expect(hold.keyUp()).toBe(true);
      hold.keyDown(false);
      advance(1000);
      expect(hold.keyUp()).toBe(true);
      expect(calls).toEqual(['send', 'send']);
    });

    it('sends a paused recording too', () => {
      const { hold, calls } = setup({ active: true, phase: 'paused' });
      hold.keyDown(false);
      hold.keyUp();
      expect(calls).toEqual(['send']);
    });

    it('only focuses the composer while it holds text or attachments', () => {
      const { hold, calls } = setup({ active: true, phase: 'recording', content: true });
      hold.keyDown(false);
      expect(hold.keyUp()).toBe(true);
      expect(calls).toEqual(['focus']);
    });

    it('only focuses the composer while the permission prompts or the recording is not sendable', () => {
      (['requesting', 'other'] as const).forEach((phase) => {
        const { hold, calls } = setup({ active: true, phase });
        hold.keyDown(false);
        hold.keyUp();
        expect(calls).toEqual(['focus']);
      });
    });

    it('sends nothing when another key or a click comes before the release', () => {
      const { hold, calls } = setup({ active: true, phase: 'recording' });
      hold.keyDown(false);
      hold.interrupt();
      expect(hold.keyUp()).toBe(false);
      expect(calls).toEqual([]);
    });

    it('sends nothing when a send began during the press', () => {
      const { hold, calls, env } = setup({ active: true, phase: 'recording' });
      hold.keyDown(false);
      env.pending = true;
      expect(hold.keyUp()).toBe(false);
      expect(calls).toEqual([]);
    });
  });
});
