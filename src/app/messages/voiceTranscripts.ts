import { useRef } from 'react';
import { MsgType, type MatrixEvent } from 'matrix-js-sdk';
import { isVoiceMessageContent } from './content/voiceMessageContent';
import { hasLongTextMetadata } from '../matrix/protocol/longText';
import {
  getVoiceSourceEventId,
  isVisibleRouterVoiceEcho,
  isVoiceRawAudioFallback,
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
 * echo moves when the room's router sent it (`routerUserId`, which the room's state names and
 * `trustedRouterUserId` trusts; no other agent or account, none while it names none, and none
 * the viewer ignores), it names its voice message (`getVoiceSourceEventId`, read from the version
 * its row shows, `getContent`, which counts only the sender's own edits), that version is a
 * transcript rather than the fallback text of a failed transcription (`isVoiceRawAudioFallback`)
 * and holds all of it rather than a preview of a long-text sidecar (`hasLongTextMetadata`),
 * and that message is among `events`, drawn as a voice message (an `m.audio` that `MAudio` plays
 * as voice, `isVoiceMessageContent`), not redacted and not from an ignored sender. Every other
 * echo keeps its row as before: one from an older backend without the name, one whose voice
 * message is not loaded here or is no voice message, one the route or a jump opened
 * (`revealed`), and a second echo naming the same voice message.
 */
export const planVoiceTranscripts = ({
  events,
  getContent,
  routerUserId,
  ignored,
  revealed,
}: {
  events: readonly MatrixEvent[];
  getContent: (event: MatrixEvent) => Record<string, unknown>;
  routerUserId: string | undefined;
  ignored: ReadonlySet<string>;
  revealed: ReadonlySet<string>;
}): VoiceTranscriptPlan => {
  // Every version of an echo carries the flag, so the cheap read of the first finds them.
  if (!routerUserId || ignored.has(routerUserId)) return NO_VOICE_TRANSCRIPTS;
  const echoes = events.filter(
    (event) =>
      isVisibleRouterVoiceEcho(event.getOriginalContent()) &&
      !event.isRedacted() &&
      event.getSender() === routerUserId
  );
  if (echoes.length === 0) return NO_VOICE_TRANSCRIPTS;
  const byId = new Map(events.map((event) => [event.getId(), event]));
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

/** The echo's formatted body without the microphone, or undefined when it has none. */
export const voiceTranscriptHtml = (content: Record<string, unknown>): string | undefined => {
  if (content.format !== 'org.matrix.custom.html' || typeof content.formatted_body !== 'string') {
    return undefined;
  }
  return content.formatted_body.replace(/^(\s*<p>)?\s*🎤 /u, '$1') || undefined;
};
