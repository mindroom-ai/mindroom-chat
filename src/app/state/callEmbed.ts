import { atom, Getter, Setter } from 'jotai';
import { CallEmbed } from '../plugins/call';
import { acquireCallCleanupGeneration } from '../plugins/call/rtcMembershipCleanup';
import { createCallTerminationOwner, disposeCallTerminationOwner } from './callTerminationOwner';

const baseCallEmbedAtom = atom<CallEmbed | undefined>(undefined);

/**
 * The single publish/replace/clear transition for the active call embed —
 * and therefore the anchor for cleanup ownership. Every embed
 * gets its `CallTermination` owner created synchronously on publish and
 * disposed synchronously on replacement or clear, independent of React
 * commit/effect timing: two publications batched into one commit still run
 * the intermediate embed's abandon cleanup, even though no component ever
 * rendered it.
 *
 * The `get`/`set` pair stays bound to the publishing store (jotai write
 * closures remain valid after the write returns; a late `set` flushes its
 * own notifications), so the owner's currency check and its atom clear are
 * per-store correct. The clear re-enters this transition directly — jotai
 * derived atoms cannot `set` themselves — so replace and clear run the same
 * dispose-owner-then-embed sequence no matter who initiates them.
 */
const transitionCallEmbed = (get: Getter, set: Setter, callEmbed: CallEmbed | undefined): void => {
  const prevCallEmbed = get(baseCallEmbedAtom);
  if (callEmbed === prevCallEmbed) return;

  if (prevCallEmbed) {
    // Detach the owner first: an already-finalized coordinator no-ops, any
    // other (idle or mid-ending) hands its network obligations to the
    // abandon path before the iframe teardown can reject its callbacks.
    disposeCallTerminationOwner(prevCallEmbed);
    try {
      prevCallEmbed.dispose();
    } catch (error) {
      // Disposal must never block publishing or clearing the atom: a
      // failed iframe/control teardown would otherwise leave the old embed
      // latched as the current value and End permanently inert.
      console.warn('[call-embed] failed to dispose the replaced call embed', error);
    }
  }

  if (callEmbed) {
    // A new embed claims its room's end-of-call cleanup: any detached
    // membership-cleanup retry left over from a previous call in the same
    // room is fenced before this call can publish RTC membership there.
    // Clearing the atom must not claim — that happens while the finalizer's
    // own detached cleanup is starting. The owner is created after the
    // claim so its deps capture the just-claimed generation.
    acquireCallCleanupGeneration(callEmbed.roomId);
    createCallTerminationOwner(
      callEmbed,
      () => get(baseCallEmbedAtom) === callEmbed,
      () => transitionCallEmbed(get, set, undefined)
    );
  }

  set(baseCallEmbedAtom, callEmbed);
};

export const callEmbedAtom = atom<CallEmbed | undefined, [CallEmbed | undefined], void>(
  (get) => get(baseCallEmbedAtom),
  transitionCallEmbed
);

export const callChatAtom = atom<boolean>(false);
