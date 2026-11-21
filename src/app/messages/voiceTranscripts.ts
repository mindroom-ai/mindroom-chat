import { useEffect, useRef } from 'react';
import { EventStatus, MsgType, type MatrixEvent } from 'matrix-js-sdk';
import { isConfirmedMatrixEventId } from '../event-store/threads/threadRouteUtils';
import { useForceUpdate } from '../lib/hooks/useForceUpdate';
import { isMindroomResponderForViewer } from '../matrix/protocol/agentIdentity';
import { isVoiceMessageContent } from './content/voiceMessageContent';
import { hasLongTextMetadata } from '../matrix/protocol/longText';
import {
  getVoiceSourceEventId,
  isVisibleRouterVoiceEcho,
  isVoiceRawAudioFallback,
} from '../matrix/protocol/transcribingPlaceholder';

/** The voice messages with a transcript under their player or a local transcribing indicator. */
export type VoiceTranscriptPlan = {
  hiddenEventIds: ReadonlySet<string>;
  byVoiceId: ReadonlyMap<string, MatrixEvent>;
  pendingVoiceIds: ReadonlySet<string>;
};

export const NO_VOICE_TRANSCRIPTS: VoiceTranscriptPlan = {
  hiddenEventIds: new Set(),
  byVoiceId: new Map(),
  pendingVoiceIds: new Set(),
};

const TRANSCRIBING_MS = 60_000;

/**
 * Which voice echoes of `events` show under their voice message instead of their row. An echo
 * moves when a trusted account sent it (the room's binding or a joined account from its roster,
 * excluding ignored accounts), it names its voice message (`getVoiceSourceEventId`, from
 * the version its row shows, `getContent`, which counts only the sender's own edits), that
 * version is a transcript or a legacy placeholder rather than the raw-audio fallback, and
 * holds all of the text rather than a preview of a long-text sidecar,
 * and that message is among `events`, drawn as a voice message (an `m.audio` that `MAudio` plays
 * as voice, `isVoiceMessageContent`), not redacted and not from an ignored sender. Every other
 * echo keeps its row as before: one from an older backend without the name, one whose voice
 * message is not loaded here or is no voice message, one the route or a jump opened
 * (`revealed`), and a second echo naming the same voice message.
 *
 * The viewer's own recent voice messages can show a pending indicator if an agent is joined,
 * until a transcript, a later agent event or a thread reply arrives, or the message ages out.
 */
export const planVoiceTranscripts = ({
  events,
  getContent,
  trustedAccountIds,
  ignored,
  revealed,
  viewerId,
  expectsAnswer,
  hasThreadReplies,
  isHidden,
}: {
  events: readonly MatrixEvent[];
  getContent: (event: MatrixEvent) => Record<string, unknown>;
  trustedAccountIds: ReadonlySet<string>;
  ignored: ReadonlySet<string>;
  revealed: ReadonlySet<string>;
  viewerId: string | undefined;
  expectsAnswer: ((event: MatrixEvent) => boolean) | undefined;
  hasThreadReplies: (event: MatrixEvent) => boolean;
  isHidden: (event: MatrixEvent) => boolean;
}): VoiceTranscriptPlan => {
  // Every version of an echo carries the flag, so the cheap read of the first finds them.
  const echoes =
    trustedAccountIds.size === 0
      ? []
      : events.filter((event) => {
          if (!isVisibleRouterVoiceEcho(event.getOriginalContent())) return false;
          const sender = event.getSender();
          return (
            !!sender && trustedAccountIds.has(sender) && !ignored.has(sender) && !event.isRedacted()
          );
        });
  const byId = new Map(echoes.length > 0 ? events.map((event) => [event.getId(), event]) : []);
  const hiddenEventIds = new Set<string>();
  const byVoiceId = new Map<string, MatrixEvent>();
  echoes.forEach((echo) => {
    const echoId = echo.getId();
    const echoContent = getContent(echo);
    const voiceId = getVoiceSourceEventId(echoContent);
    if (!echoId || !voiceId || revealed.has(echoId) || byVoiceId.has(voiceId)) return;
    if (isVoiceRawAudioFallback(echoContent) || hasLongTextMetadata(echoContent)) return;
    const voice = byId.get(voiceId);
    const voiceSender = voice?.getSender();
    if (!voice || voice.isRedacted() || !voiceSender || ignored.has(voiceSender)) return;
    const voiceContent = getContent(voice);
    if (voiceContent.msgtype !== MsgType.Audio || !isVoiceMessageContent(voiceContent)) return;
    byVoiceId.set(voiceId, echo);
    hiddenEventIds.add(echoId);
  });
  const pendingVoiceIds = new Set<string>();
  if (viewerId && expectsAnswer) {
    // The room window may draw newest first. Compare server timestamps, not row order.
    // An agent event counts even if it has not decrypted.
    let latestAgentTs = -Infinity;
    for (const event of events) {
      const sender = event.getSender();
      if (
        !sender ||
        ignored.has(sender) ||
        !isMindroomResponderForViewer(sender, viewerId, trustedAccountIds) ||
        isHidden(event)
      )
        continue;
      const ts = event.getTs();
      if (Number.isFinite(ts)) latestAgentTs = Math.max(latestAgentTs, ts);
    }
    for (const event of events) {
      if (event.getSender() !== viewerId) continue;
      const ts = event.getTs();
      if (!Number.isFinite(ts) || ts < latestAgentTs) continue;
      const id = event.getId();
      const age = event.getLocalAge();
      if (
        isConfirmedMatrixEventId(id) &&
        (!event.status || event.status === EventStatus.SENT) &&
        age >= 0 &&
        age < TRANSCRIBING_MS &&
        !event.isRedacted() &&
        !byVoiceId.has(id) &&
        event.getType() === 'm.room.message'
      ) {
        const content = getContent(event);
        if (
          content.msgtype === MsgType.Audio &&
          isVoiceMessageContent(content) &&
          !hasThreadReplies(event) &&
          expectsAnswer(event)
        ) {
          pendingVoiceIds.add(id);
        }
      }
    }
  }
  return byVoiceId.size === 0 && pendingVoiceIds.size === 0
    ? NO_VOICE_TRANSCRIPTS
    : { hiddenEventIds, byVoiceId, pendingVoiceIds };
};

/** Whether two plans draw the same: the timeline keeps the older, so its rows do not redraw. */
export const sameVoiceTranscriptPlan = (a: VoiceTranscriptPlan, b: VoiceTranscriptPlan): boolean =>
  a.pendingVoiceIds.size === b.pendingVoiceIds.size &&
  [...a.pendingVoiceIds].every((id) => b.pendingVoiceIds.has(id)) &&
  a.byVoiceId.size === b.byVoiceId.size &&
  [...a.byVoiceId].every(([voiceId, echo]) => b.byVoiceId.get(voiceId) === echo);

/**
 * `planVoiceTranscripts` made again on each render, so an echo that decrypts or loads moves
 * under its voice message on the next one: finding the echoes reads one key of each event. A
 * plan that draws the same as the last is the last, so the timeline's rows do not redraw.
 */
export const useVoiceTranscriptPlan = (
  input: Parameters<typeof planVoiceTranscripts>[0]
): VoiceTranscriptPlan => {
  const last = useRef(NO_VOICE_TRANSCRIPTS);
  const plan = planVoiceTranscripts(input);
  if (!sameVoiceTranscriptPlan(plan, last.current)) last.current = plan;
  // Wake only when the next visible indicator expires, not on a polling interval.
  let nextExpiry = Infinity;
  if (plan.pendingVoiceIds.size > 0) {
    for (const event of input.events) {
      const id = event.getId();
      if (id && plan.pendingVoiceIds.has(id)) {
        nextExpiry = Math.min(nextExpiry, event.localTimestamp + TRANSCRIBING_MS);
      }
    }
  }
  const [expiryTick, refresh] = useForceUpdate();
  useEffect(() => {
    // If the clock moved back, the same deadline may still need another timer.
    void expiryTick;
    if (!Number.isFinite(nextExpiry)) return undefined;
    const timer = setTimeout(refresh, Math.max(0, nextExpiry - Date.now()));
    return () => clearTimeout(timer);
  }, [nextExpiry, expiryTick, refresh]);
  return last.current;
};

const TRANSCRIPT_PREFIX = '🎤 ';

/** The transcript an echo's body holds, without the microphone the backend puts before it. */
export const voiceTranscriptText = (content: Record<string, unknown>): string => {
  const body = typeof content.body === 'string' ? content.body : '';
  return body.startsWith(TRANSCRIPT_PREFIX) ? body.slice(TRANSCRIPT_PREFIX.length) : body;
};

/** The echo's formatted body without the microphone, or undefined when it has none. */
export const voiceTranscriptHtml = (content: Record<string, unknown>): string | undefined => {
  if (content.format !== 'org.matrix.custom.html' || typeof content.formatted_body !== 'string') {
    return undefined;
  }
  return content.formatted_body.replace(/^(\s*<p>)?\s*🎤 /u, '$1') || undefined;
};
