import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Avatar, Icons, Text } from 'folds';
import { useAtomValue, useStore } from 'jotai';
import { Trans, useTranslation } from 'react-i18next';
import {
  EventStatus,
  RoomEvent,
  type MatrixEvent,
  type Room,
  type RoomEventHandlerMap,
} from 'matrix-js-sdk';
import { ReactEditor } from 'slate-react';
import { UserAvatar } from '../avatars/UserAvatar';
import { ComposerMenuButton } from '../composer/ComposerMenuButton';
import { RoomInput } from '../composer/RoomInput';
import * as composerCss from '../composer/RoomInput.css';
import {
  getHomeAskDraftKey,
  type HomeAskDestination,
  homeAskDestinationAtomFamily,
  homeAskPendingAtomFamily,
  roomIdToMsgDraftAtomFamily,
} from '../composer/roomInputDrafts';
import { useEditor } from '../editor/Editor';
import { isLocalEchoEventId } from '../event-store/threads/threadRouteUtils';
import { nameInitials } from '../lib/common';
import { useCapabilities } from '../matrix/hooks/useCapabilities';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { getMxIdLocalPart, mxcUrlToHttp } from '../matrix/matrix';
import { isFailedLocalEchoEvent } from '../matrix/protocol/pendingLocalEcho';
import { getRoomThreadMode } from '../matrix/protocol/roomThreadMode';
import { FailedSendActions } from '../messages/FailedSendActions';
import { ConversationViewContext, HOME_ASK_VIEW } from '../navigation/conversationView';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { IsolatedText, isolateInSentence, revealDirectionControls } from '../ui/directional';
import { MenuEntry } from '../ui/MenuEntry';
import { canAskIn, type HomeAgent, isDirectRoomWith, startDirectChat } from './homeAgents';
import * as css from './Home.css';

const AVATAR_PX = 40;

/** A small picture: round for a person or agent, square for a room, initials while it has none. */
export function Badge({ id, name, mxc, src, square }: BadgeProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const url =
    src ??
    (mxc ? mxcUrlToHttp(mx, mxc, useAuthentication, AVATAR_PX, AVATAR_PX, 'crop') : undefined);
  return (
    <Avatar size="200" radii={square ? '300' : 'Pill'} className={css.PickerAvatar}>
      <UserAvatar
        userId={id}
        src={url ?? undefined}
        alt=""
        renderFallback={() => <Text size="L400">{nameInitials(name)}</Text>}
      />
    </Avatar>
  );
}
type BadgeProps = { id: string; name: string; mxc?: string; src?: string; square?: boolean };

const agentBadge = (agent: HomeAgent) => (
  <Badge id={agent.userId} name={agent.name} mxc={agent.avatarMxc} />
);

/** An agent no longer among the account's, as a choice made before it went names it. */
const goneAgent = (userId: string): HomeAgent => ({
  userId,
  name: getMxIdLocalPart(userId) ?? userId,
  roomIds: [],
  lastUsedTs: 0,
});

/** Where a question to `agent` goes with `roomId` picked: its direct chat, or one of its rooms. */
const destinationOf = (agent: HomeAgent, roomId: string | null): HomeAskDestination => ({
  agentId: agent.userId,
  roomId,
  isDirect: roomId === null || roomId === agent.direct?.roomId,
});

/**
 * Whether a question to `agentId` can go to `room`. A room picked as its direct chat takes one only
 * while it is that: the two alone in it, the agent joined.
 */
const answersIn = (room: Room, agentId: string, isDirect: boolean): boolean =>
  isDirect ? isDirectRoomWith(room, agentId) : canAskIn(room, agentId);

/**
 * Home's ask field: a question to one of the rooms' agents, sent as a new thread, which then
 * opens. It goes to the room the agent last answered in, else its direct chat, which a press on
 * the field starts when there is none yet; the pickers choose another agent or room. The text is
 * Home's own draft, whichever room it is to go to.
 */
export function HomeAsk({ agents }: { agents: HomeAgent[] }) {
  const first = agents[0];
  return first ? <HomeAskField agents={agents} first={first} /> : null;
}

function HomeAskField({ agents, first }: { agents: HomeAgent[]; first: HomeAgent }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const store = useStore();
  const editor = useEditor();
  const version = useCapabilities()['m.room_versions']?.default;
  const userId = mx.getSafeUserId();
  const draftAtom = roomIdToMsgDraftAtomFamily(getHomeAskDraftKey(userId));
  const destinationAtom = homeAskDestinationAtomFamily(userId);
  // One question at a time: while the composer sends it, then until the server confirms its
  // message or that is deleted, nothing else is sent, so one that failed keeps its notice. Kept
  // for the account, not this page: closed and opened again, the page finds it.
  const pendingAtom = homeAskPendingAtomFamily(userId);
  const pending = useAtomValue(pendingAtom);
  const sending = pending?.state === 'sending';
  // Who answers and where, once picked or once the field holds text: sync moves neither then, and
  // the choice stays with the draft across navigation and reloads. A null room is the agent's
  // direct chat, yet to be started; `started` marks one this field started.
  const [choice, setChoice] = useState<(HomeAskDestination & { started?: boolean }) | undefined>(
    () => {
      // A question still being sent holds the field to where it goes.
      const sent = store.get(pendingAtom);
      if (sent?.state === 'sending') {
        return { agentId: sent.agentId, roomId: sent.roomId, isDirect: sent.isDirect };
      }
      if (store.get(draftAtom).length === 0) return undefined;
      // A kept Home draft without its destination requires an explicit choice rather than sending
      // to whatever room is default now.
      return store.get(destinationAtom) ?? { agentId: '', roomId: null };
    }
  );
  const [starts, setStarts] = useState<Record<string, 'busy' | 'failed'>>({});
  const [focusOnMount, setFocusOnMount] = useState(false);
  const [failedSend, setFailedSend] = useState<{ room: Room; event: MatrixEvent }>();
  const typed = useAtomValue(draftAtom).length > 0;
  const selected = choice ?? destinationOf(first, first.defaultRoomId ?? null);
  const agent =
    agents.find((candidate) => candidate.userId === selected.agentId) ??
    goneAgent(selected.agentId);
  const { roomId } = selected;
  const isDirect = !!selected.isDirect;
  if (typed && !choice) setChoice(selected);
  // The draft's text is stored with where it goes, in one entry. This keeps that current, with
  // nothing typed too, so the first letter typed is stored with it. Storage is written only as
  // it changes while there is text, not as the page opens on what is stored.
  useEffect(() => {
    if (agent.userId) store.set(destinationAtom, { agentId: agent.userId, roomId, isDirect });
  }, [agent.userId, destinationAtom, isDirect, roomId, store]);
  const selection = useRef({ agentId: agent.userId, roomId });
  selection.current = { agentId: agent.userId, roomId };
  const { navigateRoom, navigateRoomThreadDirect } = useRoomNavigate();
  // No drop zone: a file dropped on Home is not attached.
  const noDrop = useRef<HTMLElement>(null);
  const agentPickerRef = useRef<HTMLButtonElement | null>(null);
  const roomPickerRef = useRef<HTMLButtonElement | null>(null);
  const refocusPickerRef = useRef<'agent' | 'room' | null>(null);

  // Names read in their own direction in a sentence; an accessible name needs no isolate.
  const name = isolateInSentence(agent.name);
  const { direct } = agent;
  // Its rooms, then its direct chat, or none yet to start (null).
  const roomIds: (string | null)[] = [...agent.roomIds];
  if (!direct) roomIds.push(null);
  else if (!roomIds.includes(direct.roomId)) roomIds.push(direct.roomId);
  const room = roomId ? mx.getRoom(roomId) : null;
  // A room picked as the direct chat stays a choice only while it is that chat, not as a room of
  // the same ID that others have joined since.
  const listed = isDirect
    ? roomId === (direct?.roomId ?? null)
    : roomId !== null && agent.roomIds.includes(roomId);
  // A chat just started is among the choices once the client has it, and waits until the agent
  // joins even if the room arrives before `m.direct` syncs back, or before the agent's invitation
  // does: while the two are alone in it.
  const startedAlone =
    !!choice?.started &&
    (!room || (!direct && isDirectRoomWith(room, agent.userId, ['join', 'invite', undefined])));
  const valid = agents.includes(agent) && (listed || startedAlone);
  const usable = valid && !!room && answersIn(room, agent.userId, isDirect);
  // A direct chat the agent has yet to join.
  const waiting =
    isDirect && valid && !!room && isDirectRoomWith(room, agent.userId, ['invite', undefined]);
  const starting = starts[agent.userId];
  const composerShown = !!room && !waiting;
  useEffect(() => {
    if (!focusOnMount || !composerShown) return;
    ReactEditor.focus(editor);
    setFocusOnMount(false);
  }, [composerShown, editor, focusOnMount]);
  useEffect(() => {
    const target = refocusPickerRef.current;
    if (!target) return;
    refocusPickerRef.current = null;
    (target === 'agent' ? agentPickerRef : roomPickerRef).current?.focus();
  }, [choice, composerShown]);

  // A question opens once the server has it, under the ID it gave: the room at it where agents
  // answer in the room's main timeline, elsewhere its new thread.
  const open = useCallback(
    (openRoomId: string, eventId: string) => {
      if (getRoomThreadMode(mx.getRoom(openRoomId)) === 'room') navigateRoom(openRoomId, eventId);
      else navigateRoomThreadDirect(openRoomId, eventId);
    },
    [mx, navigateRoom, navigateRoomThreadDirect]
  );
  // The question's message as the page opens, and as it is tracked: confirmed or deleted while
  // the page was closed, it is over, and nothing opens; failed, it shows its notice.
  useEffect(() => {
    const echoRoom = pending?.state === 'echo' ? mx.getRoom(pending.roomId) : null;
    const echo = pending?.eventId ? echoRoom?.findEventById(pending.eventId) : undefined;
    setFailedSend(
      echoRoom && echo && isFailedLocalEchoEvent(echo) ? { room: echoRoom, event: echo } : undefined
    );
    if (pending?.state === 'echo' && !echo) store.set(pendingAtom, undefined);
  }, [mx, pending, pendingAtom, store]);
  useEffect(() => {
    const onEcho: RoomEventHandlerMap[RoomEvent.LocalEchoUpdated] = (event, echoRoom, oldId) => {
      const tracked = store.get(pendingAtom);
      if (tracked?.state !== 'echo' || echoRoom.roomId !== tracked.roomId) return;
      const id = event.getId();
      if (oldId !== tracked.eventId && id !== tracked.eventId) return;
      if (id && !isLocalEchoEventId(id)) {
        store.set(pendingAtom, undefined);
        open(echoRoom.roomId, id);
      } else if (event.status === EventStatus.CANCELLED) {
        store.set(pendingAtom, undefined);
      } else {
        setFailedSend(isFailedLocalEchoEvent(event) ? { room: echoRoom, event } : undefined);
      }
    };
    mx.on(RoomEvent.LocalEchoUpdated, onEcho);
    return () => {
      mx.removeListener(RoomEvent.LocalEchoUpdated, onEcho);
    };
  }, [mx, open, pendingAtom, store]);
  // A chat being started, or started but not yet in the client.
  const busy = starting === 'busy' || (!!choice?.started && roomId !== null && !room);

  const startDirect = (agentId: string) => {
    setStarts((all) => ({ ...all, [agentId]: 'busy' }));
    startDirectChat(mx, agentId, version).then(
      (started) => {
        setStarts(({ [agentId]: done, ...others }) => others);
        // A choice made meanwhile stands; the chat itself, shown already as `m.direct` lists it,
        // is no other choice.
        const now = selection.current;
        if (now.agentId !== agentId || (now.roomId !== null && now.roomId !== started)) return;
        setFocusOnMount(true);
        setChoice({ agentId, roomId: started, isDirect: true, started: true });
      },
      () => setStarts((all) => ({ ...all, [agentId]: 'failed' }))
    );
  };
  // A pick, which nothing takes while a question is being sent: where that goes stays put.
  const pick = (picker: 'agent' | 'room', destination: HomeAskDestination) => {
    if (sending) return;
    setFocusOnMount(false);
    refocusPickerRef.current = picker;
    setChoice(destination);
  };

  const shown = (id: string | null) => {
    const choiceRoom = id ? mx.getRoom(id) : null;
    // The direct chat, also one just started that `m.direct` has yet to list.
    if (!choiceRoom || id === direct?.roomId || (isDirect && id === roomId && valid)) {
      return { label: t('home.ask.directChat'), badge: agentBadge(agent) };
    }
    const label = revealDirectionControls(choiceRoom.name);
    const mxc = choiceRoom.getMxcAvatarUrl() ?? undefined;
    return { label, badge: <Badge id={choiceRoom.roomId} name={label} mxc={mxc} square /> };
  };
  const current = shown(roomId);
  const radio = (
    key: string,
    icon: typeof Icons.User,
    checked: boolean,
    { label, badge }: { label: string; badge: ReactNode },
    onSelect: () => void,
    description?: string
  ) => (
    <MenuEntry
      key={key}
      role="menuitemradio"
      aria-checked={checked}
      className={composerCss.ComposerMenuItem}
      label={label}
      description={description}
      icon={icon}
      after={badge}
      onSelect={onSelect}
    />
  );
  const pickers = (
    <>
      <ComposerMenuButton
        label={t('home.ask.chooseAgent')}
        icon={Icons.ChevronBottom}
        triggerButtonRef={agentPickerRef}
        face={{
          content: (
            <>
              {agent.userId && agentBadge(agent)}
              <span className={css.PickerText}>{agent.name || t('home.ask.chooseAgent')}</span>
            </>
          ),
          label: agent.name
            ? t('home.ask.agentChoice', { name: agent.name })
            : t('home.ask.chooseAgent'),
        }}
      >
        {({ choose }) =>
          agents.map((option) =>
            radio(
              option.userId,
              Icons.User,
              option === agent,
              { label: option.name, badge: agentBadge(option) },
              choose(() => pick('agent', destinationOf(option, option.defaultRoomId ?? null))),
              // Agents of one name are told apart by their IDs.
              agents.some((other) => other !== option && other.name === option.name)
                ? revealDirectionControls(option.userId)
                : undefined
            )
          )
        }
      </ComposerMenuButton>
      {/* A kept draft whose agent is not known has no rooms to offer until one is picked. */}
      {agent.userId && (
        <ComposerMenuButton
          label={t('home.ask.chooseRoom')}
          icon={Icons.ChevronBottom}
          triggerButtonRef={roomPickerRef}
          face={{
            content: (
              <span className={css.PickerText}>
                <Trans
                  i18nKey="home.ask.inRoom"
                  values={{ room: isolateInSentence(current.label) }}
                  tOptions={{ interpolation: { escapeValue: true } }}
                  shouldUnescape
                  components={{ avatar: <>{current.badge}</> }}
                />
              </span>
            ),
            label: t('home.ask.roomChoice', { room: current.label }),
          }}
        >
          {({ choose }) =>
            roomIds.map((id) =>
              radio(
                id ?? 'new-direct',
                Icons.Hash,
                id === roomId && valid,
                shown(id),
                choose(() => pick('room', destinationOf(agent, id))),
                id === null ? t('home.ask.startsDirectChat', { name }) : undefined
              )
            )
          }
        </ComposerMenuButton>
      )}
    </>
  );
  const placeholder = agent.name ? t('home.ask.placeholder', { name }) : t('home.ask.chooseAgent');
  // A choice that no longer works keeps the text and asks for another.
  const chooseAgain = (
    <Text role="alert" size="T200" className={css.StandInError}>
      {t('home.ask.chooseAgain')}
    </Text>
  );
  // Sent again, the question goes where it went: offered only while the agent still answers there.
  const failedNotice = failedSend && pending && (
    <FailedSendActions
      room={failedSend.room}
      event={failedSend.event}
      canRetry={() => answersIn(failedSend.room, pending.agentId, pending.isDirect)}
    />
  );

  if (room && composerShown) {
    return (
      <div className={css.Ask}>
        <ConversationViewContext.Provider value={HOME_ASK_VIEW}>
          <RoomInput
            editor={editor}
            room={room}
            roomId={room.roomId}
            fileDropContainerRef={noDrop}
            onRoomMessageSent={(eventId) => {
              if (isLocalEchoEventId(eventId)) {
                const sent = { roomId: room.roomId, agentId: agent.userId, isDirect, eventId };
                store.set(pendingAtom, { state: 'echo', ...sent });
              } else {
                store.set(pendingAtom, undefined);
                open(room.roomId, eventId);
              }
              return false;
            }}
            ask={{
              agentUserId: agent.userId,
              placeholder,
              pickers,
              // Read again at the press, and for the question on its way (`sent`) just before
              // its message goes out: the room or the agent may have changed since.
              canSend: (sent) =>
                (sent || !store.get(pendingAtom)) &&
                valid &&
                answersIn(room, agent.userId, isDirect),
              // Heard also after this page has gone, to the send's end.
              onSendingChange: (now) => {
                if (now) {
                  const sent = { roomId: room.roomId, agentId: agent.userId, isDirect };
                  store.set(pendingAtom, { state: 'sending', ...sent });
                } else if (store.get(pendingAtom)?.state === 'sending') {
                  store.set(pendingAtom, undefined);
                }
              },
            }}
          />
        </ConversationViewContext.Provider>
        {failedNotice}
        {!usable && chooseAgain}
      </div>
    );
  }
  // No chat with the agent yet: a press starts one, whose composer then takes the field.
  let label = placeholder;
  if (waiting) label = t('home.ask.waitingForAgent', { name });
  else if (busy) label = t('home.ask.startingDirectChat', { name });
  return (
    <div className={css.Ask}>
      <div className={css.StandIn}>
        <button
          type="button"
          className={css.StandInField}
          aria-busy={busy}
          disabled={waiting || !valid}
          onClick={() => !busy && startDirect(agent.userId)}
        >
          <IsolatedText text={label} />
        </button>
        {starting === 'failed' && (
          <Text role="alert" size="T200" className={css.StandInError}>
            <IsolatedText text={t('home.ask.directChatFailed', { name })} />
          </Text>
        )}
        {!valid && chooseAgain}
        <div className={css.StandInRow}>{pickers}</div>
      </div>
      {failedNotice}
    </div>
  );
}
