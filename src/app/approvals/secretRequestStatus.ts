import { useEffect, useState } from 'react';
import { atom, useAtomValue } from 'jotai';
import {
  effectiveSecretRequestStatus,
  type SecretRequest,
  type SecretRequestStatus,
} from '../matrix/protocol/secretRequest';

/** What the requester's answer did while the card still reads pending, until the agent edits it. */
export type SecretRequestAnswer = 'saved' | 'declined' | 'inactive';

const ANSWER_STATUSES = {
  saved: 'saved',
  declined: 'declined',
  inactive: 'expired',
} as const satisfies Record<SecretRequestAnswer, SecretRequestStatus>;

/**
 * The answers this page gave, by request ID, for every view of a request (its card, its line in
 * the reply, the reply's cog and fold) to show the same status. Never the secret.
 */
export const secretRequestAnswersAtom = atom<ReadonlyMap<string, SecretRequestAnswer>>(new Map());

export const recordSecretRequestAnswer = atom(
  null,
  (_get, set, requestId: string, answer: SecretRequestAnswer) =>
    set(secretRequestAnswersAtom, (answers) => new Map(answers).set(requestId, answer))
);

const MINUTE_MS = 60_000;

/**
 * The status each request shows now: the agent's edit decides; until it comes, an answer the
 * server took does, whatever the clock says, and otherwise a pending request turns expired at its
 * deadline. Renders again each minute while one is open, for the time left, and at the deadline.
 */
export const useSecretRequestStatuses = (
  requests: readonly SecretRequest[]
): { statuses: SecretRequestStatus[]; now: number } => {
  const answers = useAtomValue(secretRequestAnswersAtom);
  const [tick, setTick] = useState(0);
  const now = Date.now();
  const statuses = requests.map((request) => {
    const answer = request.status === 'pending' ? answers.get(request.requestId) : undefined;
    return answer ? ANSWER_STATUSES[answer] : effectiveSecretRequestStatus(request, now);
  });
  const open = requests.filter((_request, index) => statuses[index] === 'pending');
  const deadline =
    open.length > 0 ? Math.min(...open.map(({ expiresAt }) => expiresAt)) : undefined;
  useEffect(() => {
    if (deadline === undefined) return undefined;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return undefined;
    const timer = setTimeout(
      () => setTick((value) => value + 1),
      remaining % MINUTE_MS || MINUTE_MS
    );
    return () => clearTimeout(timer);
  }, [deadline, tick]);
  return { statuses, now };
};
