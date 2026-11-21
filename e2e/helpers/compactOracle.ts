import type { ListFrame, ListInput } from './listRecorder';

export type Invariant = 'I1' | 'I2' | 'I3' | 'I4' | 'I5' | 'I6' | 'I7';
export const away = (frame: ListFrame) => frame.y > frame.height / 2;
const changed = (a: number, b: number) => Math.abs(a - b) > 1;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const rows = (frame: ListFrame) => frame.visible.filter((r) => !r.key.startsWith('header:'));
export const fullyVisible = (frame: ListFrame) =>
  rows(frame).filter((r) => r.painted >= frame.start - 1 && r.bottom <= frame.end + 1);

export function compactOracle(report: (id: Invariant, reason: string) => void) {
  let calm = false;
  let lastAct = -Infinity;
  let rest = Infinity;
  let stable = 0;
  let scope = false;
  let direction: ListInput | undefined;
  let scrolled = false;
  let active = false;
  let enteredCalm = false;
  const baseline = new Map<string, number>();
  let nav:
    | { from: ListFrame; target?: string; moved?: string; placements: number; done?: number }
    | undefined;
  const start = (from: ListFrame, target?: string, moved?: string) => {
    nav = { from, target, moved, placements: 0 };
  };
  return {
    scope: () => {
      scope = true;
    },
    start,
    settle(frame: ListFrame, winner?: string) {
      if (nav && nav.done === undefined) {
        const { target, from, moved } = nav;
        nav.done = frame.y;
        if (target && !fullyVisible(frame).some((row) => row.key === target))
          report('I6', 'linked card not fully inside the readable viewport');
        if (
          !target &&
          (from.y <= 1
            ? frame.y > 1
            : !rows(frame).some((row) =>
                rows(from).some(
                  (old) =>
                    old.key === row.key && old.key !== moved && !changed(old.painted, row.painted)
                )
              ))
        )
          report('I6', 'Back did not restore a surviving witness');
      }
      if (winner && frame.replySeen && !frame.pending && frame.order[0]?.[0] !== winner) {
        if (calm && !frame.pill)
          report('I7', 'shown leader differs from the evidenced live leader without a pill');
        if (!calm && !frame.held) report('I2', 'live reply did not lead newest-first list');
      }
    },
    sample(a: ListFrame, b: ListFrame) {
      const fresh = a.view !== b.view;
      const keys = new Set(b.order.map(([key]) => key));
      const motion = b.writes.filter((w) => w.before !== w.after);
      const explicit = b.writes.filter((w) => w.method !== 'focus' && w.method !== 'scrollTop');
      if (keys.size !== b.order.length) report('I4', 'duplicate displayed key');
      if (new Set([...motion, ...explicit]).size > 1)
        report('I3', 'multiple scroll writes or calls in one frame');
      const unchanged = same(a.order, b.order);
      const old = rows(a);
      const now = new Map(rows(b).map((row) => [row.key, row]));
      const first = old.find((row) => now.has(row.key));
      const next = first && now.get(first.key)!;
      const stationary = !!(
        first &&
        next &&
        unchanged &&
        !changed(first.top + a.y, next.top + b.y)
      );
      if (fresh || scope) {
        direction = undefined;
        active = false;
        enteredCalm = false;
        rest = Infinity;
      }
      let undo = false;
      for (const event of [...b.input, ...motion].sort((l, r) => l.seq - r.seq)) {
        if ('type' in event) {
          if (event.direction && event.inside) {
            direction = event;
            scrolled = false;
            active = true;
            stable = 0;
          } else if (['keydown', 'pointerdown', 'touchstart'].includes(event.type))
            direction = undefined;
          if (nav && nav.done === undefined && !fresh && event.type !== 'pointermove')
            nav.done = a.y;
          if (event.mouse) rest = event.inside ? b.time + 3000 : Infinity;
        } else if (
          direction &&
          !fresh &&
          stationary &&
          (scrolled || (event.before - direction.y) * direction.direction > 1) &&
          (event.after - event.before) * direction.direction < -1
        ) {
          undo = true;
          report('I3', 'JS write undid reader scrolling with unchanged order and anchor layout');
        }
      }
      if (nav && motion.length) {
        if (nav.done === undefined) {
          nav.placements += motion.length;
          if (nav.placements > 1)
            report('I6', 'more than one effective write for a placement request');
        } else if (
          undo ||
          (stationary &&
            motion.some((w) => changed(w.before, nav!.done!) && !changed(w.after, nav!.done!)))
        ) {
          report('I6', 'a write reclaimed a completed placement offset');
        }
      }
      if (b.input.length || scope || fresh) lastAct = b.time;
      const acted = b.input.length > 0 || scope || fresh;
      const nativeDelta = fresh
        ? 0
        : b.y - a.y - motion.reduce((sum, w) => sum + w.after - w.before, 0);
      if (direction && nativeDelta * direction.direction > 0.1) scrolled = true;
      stable = Math.abs(nativeDelta) < 0.1 ? stable + 1 : 0;
      // Keep direction for I3 after settling, but don't treat a later passive correction as a gesture.
      active &&= !!direction && stable < 5;
      const gesture = active;
      const readerScroll = gesture && Math.abs(nativeDelta) >= 0.1;
      const jump =
        (nav && nav.done === undefined) ||
        (b.input.some((e) => e.type === 'click') && motion.length);
      const calmBefore = calm;
      if (fresh || scope || readerScroll || jump || (acted && Math.abs(nativeDelta) >= 0.1))
        calm = away(b);
      if (!fresh && a.held !== b.held && b.time - lastAct > 150 && !gesture) {
        if (!a.held || b.time < rest - 50 || b.time > rest + 200)
          report('I5', 'hold changed without reader action or mouse-rest expiry');
        else rest = Infinity;
      }
      if (readerScroll && !calmBefore && calm) enteredCalm = true;
      if (!gesture && enteredCalm) {
        if (calm && !b.held) report('I5', 'reader entered calm without a hold');
        enteredCalm = false;
      }
      scope = false;
      if (acted || gesture || jump || !calm) baseline.clear();
      if (fresh || acted || gesture || jump) return;
      if (calm) {
        const survivors = a.order.filter(([key]) => keys.has(key));
        const oldKeys = new Set(survivors.map(([key]) => key));
        if (
          !same(
            survivors,
            b.order.filter(([key]) => oldKeys.has(key))
          )
        )
          report('I1', 'calm survivor order/group changed');
        if (b.reattached.some((key) => oldKeys.has(key)))
          report('I1', 'calm survivor detached and reattached');
        const clamp = b.max < a.max && a.y > b.max && !changed(b.y, b.max) ? a.y - b.y : 0;
        const oldAt = new Map(a.order.map(([key], i) => [key, i]));
        const newAt = new Map(b.order.map(([key], i) => [key, i]));
        let before: typeof first;
        let affected = false;
        for (const row of old) {
          if (before && now.has(before.key)) {
            const between = (frame: ListFrame, index: Map<string, number>) =>
              index.has(row.key)
                ? frame.order.slice(index.get(before!.key)! + 1, index.get(row.key))
                : [];
            affected ||=
              changed(before.height, now.get(before.key)!.height) ||
              (keys.has(row.key) && !same(between(a, oldAt), between(b, newAt)));
          } else if (before) affected = true;
          if (now.has(row.key) || !keys.has(row.key)) before = row;
          if (!keys.has(row.key) || affected) {
            baseline.delete(row.key);
            continue;
          }
          const origin = (baseline.get(row.key) ?? row.painted) + clamp;
          baseline.set(row.key, origin);
          const painted = now.get(row.key)?.painted;
          if (painted === undefined || changed(origin, painted))
            report('I1', 'calm visible survivor drifted');
        }
        return;
      }
      if (changed(b.y, Math.min(a.y, b.max))) report('I2', 'live offset changed');
      if (!unchanged)
        for (const row of old) {
          const later = now.get(row.key);
          if (!later || (row.glide === later.glide && !changed(row.top, later.top))) continue;
          const origin = row.glide !== later.glide ? later.origin ?? later.painted : later.painted;
          if (changed(row.painted, origin))
            report('I2', 'live survivor teleported instead of gliding');
        }
    },
  };
}
