import { useRef } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import { isMindroomRouterUserIdForViewer } from '../matrix/protocol/agentIdentity';
import {
  getVoiceSourceEventId,
  isVisibleRouterVoiceEcho,
} from '../matrix/protocol/transcribingPlaceholder';

/**
 * The router's voice echoes a timeline draws under the voice messages they transcribe, whose own
 * rows hide: `byVoiceId` maps each voice message's ID to its echo.
 */
export type VoiceTranscriptPlan = {
  hiddenEventIds: ReadonlySet<string>;
  byVoiceId: ReadonlyMap<string, MatrixEvent>;
};

export const NO_VOICE_TRANSCRIPTS: VoiceTranscriptPlan = {
  hiddenEventIds: new Set(),
  byVoiceId: new Map(),
};

/**
 * Which router voice echoes of `events` show under their voice message instead of their row. An
 * echo moves when the router on the viewer's homeserver sent it (`isMindroomRouterUserIdForViewer`;
 * no other agent or account), it names its voice message (`getVoiceSourceEventId`, read from the
 * version its row shows, `getContent`, which counts only the sender's own edits), and that
 * message is among `events`, not
 * redacted and not from an ignored sender. Every other echo keeps its row as before: one from
 * an older backend without the name, one whose voice message is not loaded here, one the route
 * or a jump opened (`revealed`), and a second echo naming the same voice message.
 */
export const planVoiceTranscripts = ({
  events,
  getContent,
  viewerId,
  ignored,
  revealed,
}: {
  events: readonly MatrixEvent[];
  getContent: (event: MatrixEvent) => Record<string, unknown>;
  viewerId: string | undefined;
  ignored: ReadonlySet<string>;
  revealed: ReadonlySet<string>;
}): VoiceTranscriptPlan => {
  // Every version of an echo carries the flag, so the cheap read of the first finds them.
  const echoes = events.filter(
    (event) =>
      isVisibleRouterVoiceEcho(event.getOriginalContent()) &&
      !event.isRedacted() &&
      isMindroomRouterUserIdForViewer(event.getSender(), viewerId)
  );
  if (echoes.length === 0) return NO_VOICE_TRANSCRIPTS;
  const byId = new Map(events.map((event) => [event.getId(), event]));
  const hiddenEventIds = new Set<string>();
  const byVoiceId = new Map<string, MatrixEvent>();
  echoes.forEach((echo) => {
    const echoId = echo.getId();
    const voiceId = getVoiceSourceEventId(getContent(echo));
    if (!echoId || !voiceId || revealed.has(echoId) || byVoiceId.has(voiceId)) return;
    const voice = byId.get(voiceId);
    const voiceSender = voice?.getSender();
    if (!voice || voice.isRedacted() || !voiceSender || ignored.has(voiceSender)) return;
    byVoiceId.set(voiceId, echo);
    hiddenEventIds.add(echoId);
  });
  return byVoiceId.size === 0 ? NO_VOICE_TRANSCRIPTS : { hiddenEventIds, byVoiceId };
};

/** Whether two plans draw the same: the timeline keeps the older, so its rows do not redraw. */
export const sameVoiceTranscriptPlan = (a: VoiceTranscriptPlan, b: VoiceTranscriptPlan): boolean =>
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
  return last.current;
};

const TRANSCRIPT_PREFIX = '🎤 ';

/** The transcript an echo's body holds, without the microphone the backend puts before it. */
export const voiceTranscriptText = (content: Record<string, unknown>): string => {
  const body = typeof content.body === 'string' ? content.body : '';
  return body.startsWith(TRANSCRIPT_PREFIX) ? body.slice(TRANSCRIPT_PREFIX.length) : body;
};
