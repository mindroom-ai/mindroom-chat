import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Avatar, Box, Icon, Icons, Text } from 'folds';
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
import { useAlive } from '../lib/hooks/useAlive';
import { useCapabilities } from '../matrix/hooks/useCapabilities';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { getMxIdLocalPart, mxcUrlToHttp } from '../matrix/matrix';
import { isFailedLocalEchoEvent } from '../matrix/protocol/pendingLocalEcho';
import { getRoomThreadMode } from '../matrix/protocol/roomThreadMode';
import { FailedSendActions } from '../messages/FailedSendActions';
import { ConversationViewContext, HOME_ASK_VIEW } from '../navigation/conversationView';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { crossRoomThreadIndexAtom } from '../threads/cross-room/crossRoomThreadIndex';
import {
  IsolatedText,
  isolateInSentence,
  ownDirectionLine,
  revealDirectionControls,
} from '../ui/directional';
import { MenuEntry } from '../ui/MenuEntry';
import {
  agentNameIn,
  canAskIn,
  type HomeAgent,
  isDirectRoomWith,
  pendingDirectStart,
  startDirectChat,
} from './homeAgents';
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
    <Avatar
      size="200"
      radii={square ? '300' : 'Pill'}
      className={css.PickerAvatar}
      aria-hidden="true"
    >
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

/**
 * Where a question to an agent goes: one of its rooms, or, as its direct chat, a chat of the two
 * (a null room: one yet to be started). One room can be either: as the direct chat it takes a
 * question only while the two are alone in it.
 */
type Place = { roomId: string | null; isDirect: boolean };

/** Where a question to `agent` goes by default, `roomId` being its default room. */
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
 * Opens a question once the server has it, under the ID it gave: the room at it where agents
 * answer in the room's main timeline, elsewhere its new thread.
 */
const useOpenQuestion = () => {
  const mx = useMatrixClient();
  const { navigateRoom, navigateRoomThreadDirect } = useRoomNavigate();
  return useCallback(
    (roomId: string, eventId: string) => {
      if (getRoomThreadMode(mx.getRoom(roomId)) === 'room') navigateRoom(roomId, eventId);
      else navigateRoomThreadDirect(roomId, eventId);
    },
    [mx, navigateRoom, navigateRoomThreadDirect]
  );
};

/**
 * Follows the account's question on its way (`homeAskPendingAtomFamily`) while Home shows, with
 * or without an agent left to ask: confirmed, its thread opens; failed, this is its notice.
 */
const useHomeAskPendingNotice = (): ReactNode => {
  const mx = useMatrixClient();
  const { t } = useTranslation();
  const store = useStore();
  const pendingAtom = homeAskPendingAtomFamily(mx.getSafeUserId());
  const pending = useAtomValue(pendingAtom);
  const open = useOpenQuestion();
  const [failedSend, setFailedSend] = useState<{ room: Room; event: MatrixEvent }>();
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
  if (!failedSend || !pending) return undefined;
  const { room, event } = failedSend;
  // Sent again, the question goes where it went, which the notice names: the pickers may be
  // elsewhere since. It is offered only while the agent still answers there.
  const place =
    pending.isDirect && isDirectRoomWith(room, pending.agentId)
      ? t('home.ask.directChat')
      : revealDirectionControls(room.name || room.roomId);
  const notSent = t('home.ask.notSent', {
    agent: isolateInSentence(agentNameIn(room, pending.agentId)),
    room: isolateInSentence(place),
  });
  return (
    <FailedSendActions
      room={room}
      event={event}
      message={<IsolatedText text={notSent} />}
      canRetry={() => answersIn(room, pending.agentId, pending.isDirect)}
    />
  );
};

/**
 * Home's ask field: a question to one of the rooms' agents, sent as a new thread, which then
 * opens. It goes to the room the agent last answered in, else its direct chat, which a press on
 * the field starts when there is none yet; the pickers choose another agent or room. The text is
 * Home's own draft, whichever room it is to go to. With no agent left to ask, a question on its
 * way is still followed, and one that failed keeps its notice.
 */
export function HomeAsk({ agents }: { agents: HomeAgent[] }) {
  const first = agents[0];
  // Followed from here, so as the last agent goes or the first comes, nothing is missed.
  const failedNotice = useHomeAskPendingNotice();
  if (!first) return <>{failedNotice}</>;
  return <HomeAskField agents={agents} first={first} failedNotice={failedNotice} />;
}

type HomeAskFieldProps = { agents: HomeAgent[]; first: HomeAgent; failedNotice: ReactNode };

function HomeAskField({ agents, first, failedNotice }: HomeAskFieldProps) {
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
      if (store.get(draftAtom).length === 0) {
        // Nothing typed: the field goes with the agents, but waits still for a direct chat that
        // was being started as the page closed, rather than show the first chat that loads.
        const kept = store.get(destinationAtom);
        return kept?.isDirect && kept.roomId === null && pendingDirectStart(mx, kept.agentId)
          ? kept
          : undefined;
      }
      // A kept Home draft without its destination requires an explicit choice rather than sending
      // to whatever room is default now.
      return store.get(destinationAtom) ?? { agentId: '', roomId: null };
    }
  );
  const [starts, setStarts] = useState<Record<string, 'busy' | 'failed'>>({});
  // The starts this field follows to their end.
  const following = useRef(new WeakSet<Promise<string>>());
  const alive = useAlive();
  const [focusOnMount, setFocusOnMount] = useState(false);
  const typed = useAtomValue(draftAtom).length > 0;
  const selected = choice ?? destinationOf(first, first.defaultRoomId ?? null);
  const agent =
    agents.find((candidate) => candidate.userId === selected.agentId) ??
    goneAgent(selected.agentId);
  // The agent's chat being started: by this field, or by one before it on this page, whose start
  // is known still (`pendingDirectStart`) though that field is gone.
  const lookup = agent.userId ? pendingDirectStart(mx, agent.userId) : undefined;
  const starting = starts[agent.userId] ?? (lookup && 'busy');
  // A direct chat yet to be started is the agent's direct chat once it has one, and stays that
  // chat whichever the agent prefers later: the field shows no composer before it is held to it.
  // Not while the chat is being started: of several chats whose members load one by one, the
  // first is the agent's direct chat for a moment, and the start says which it is.
  if (choice && choice.roomId === null && choice.isDirect && agent.direct && starting !== 'busy') {
    setChoice({ agentId: choice.agentId, roomId: agent.direct.roomId, isDirect: true });
  }
  const { roomId } = selected;
  const isDirect = !!selected.isDirect;
  // The first text is for where the field went as it was typed, which is stored with it: not for
  // where an agent's answer, arriving with it, would move a field without text.
  if (typed && !choice) setChoice(store.get(destinationAtom) ?? { agentId: '', roomId: null });
  // The draft's text is stored with where it goes, in one entry. This keeps that current, with
  // nothing typed too, so the first letter typed is stored with it. Storage is written only as
  // it changes while there is text, not as the page opens on what is stored.
  useEffect(() => {
    if (agent.userId) store.set(destinationAtom, { agentId: agent.userId, roomId, isDirect });
  }, [agent.userId, destinationAtom, isDirect, roomId, store]);
  const selection = useRef({ agentId: agent.userId, roomId, isDirect });
  selection.current = { agentId: agent.userId, roomId, isDirect };
  const open = useOpenQuestion();
  // No drop zone: a file dropped on Home is not attached.
  const noDrop = useRef<HTMLElement>(null);
  const agentPickerRef = useRef<HTMLButtonElement | null>(null);
  const roomPickerRef = useRef<HTMLButtonElement | null>(null);
  const refocusPickerRef = useRef<'agent' | 'room' | null>(null);

  // Names read in their own direction in a sentence; an accessible name needs no isolate.
  const name = isolateInSentence(agent.name);
  const { direct } = agent;
  const room = roomId ? mx.getRoom(roomId) : null;
  // A direct chat whose members the client has yet to load, as a draft kept for it finds it once
  // the app opens again, may be the agent's or not: they are loaded, and the choice stands
  // meanwhile, taking no question yet. `triedMembers` is the room whose load ended, well or not:
  // from then on the chat is what its members say. A chat just started waits as it is.
  const [triedMembers, setTriedMembers] = useState<{ room: Room }>();
  const unloaded =
    isDirect &&
    !choice?.started &&
    !!room &&
    !room.membersLoaded() &&
    isDirectRoomWith(room, agent.userId, [undefined]);
  const loadingMembers = unloaded && triedMembers?.room !== room;
  useEffect(() => {
    if (!room || !unloaded) return;
    const tried = () => {
      if (alive()) setTriedMembers({ room });
    };
    room.loadMembersIfNeeded().then(tried, tried);
  }, [alive, room, unloaded]);
  // A room picked as the direct chat stays a choice only while it is one, not as a room of the
  // same ID that others have joined since: the agent's direct chat, or another chat of the two
  // that was it when picked. The chat yet to be started (null) is one until it has its room.
  const listed = isDirect
    ? roomId === null ||
      roomId === direct?.roomId ||
      loadingMembers ||
      (!!room && isDirectRoomWith(room, agent.userId))
    : roomId !== null && agent.roomIds.includes(roomId);
  // A chat just started is among the choices once the client has it, and waits until the agent
  // joins even if the room arrives before `m.direct` syncs back, or before the agent's invitation
  // does: while the two are alone in it.
  const startedAlone =
    !!choice?.started &&
    (!room || (!direct && isDirectRoomWith(room, agent.userId, ['join', 'invite', undefined])));
  const valid = agents.includes(agent) && (listed || startedAlone);
  const usable = valid && !!room && answersIn(room, agent.userId, isDirect);
  // A direct chat the agent has yet to join, once its members say so.
  const waiting =
    isDirect &&
    valid &&
    !!room &&
    !loadingMembers &&
    isDirectRoomWith(room, agent.userId, ['invite', undefined]);
  const composerShown = !!room && !waiting;
  // The direct chat to pick: the one the field is on (one just started that `m.direct` has yet to
  // list, or one another chat has replaced since), then the agent's; with neither, the one yet to
  // be started (null).
  const directIds: (string | null)[] = isDirect && roomId !== null && valid ? [roomId] : [];
  if (direct && !directIds.includes(direct.roomId)) directIds.push(direct.roomId);
  if (directIds.length === 0) directIds.push(null);
  // The places to pick: the agent's rooms, then its direct chat. A room that is the direct chat
  // is offered as that, at its place among the rooms, and as a room only while picked as one.
  const places: Place[] = agent.roomIds.map((id) => ({
    roomId: id,
    isDirect: directIds.includes(id) && (isDirect || id !== roomId),
  }));
  directIds.forEach((id) => {
    if (!places.some((place) => place.isDirect && place.roomId === id)) {
      places.push({ roomId: id, isDirect: true });
    }
  });
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

  // A chat being started, or started but not yet in the client.
  const busy = starting === 'busy' || (!!choice?.started && roomId !== null && !room);

  // Follows a chat being started for `agentId` to its end, while the field is there.
  const followStart = (agentId: string, start: Promise<string>) => {
    following.current.add(start);
    setStarts((all) => ({ ...all, [agentId]: 'busy' }));
    start.then(
      (started) => {
        if (!alive()) return;
        setStarts(({ [agentId]: done, ...others }) => others);
        // A choice made meanwhile stands, also of the chat's room picked as a room; the chat
        // itself, picked meanwhile as `m.direct` lists it, is no other choice.
        const now = selection.current;
        if (now.agentId !== agentId || !now.isDirect) return;
        if (now.roomId !== null && now.roomId !== started) return;
        setFocusOnMount(true);
        setChoice({ agentId, roomId: started, isDirect: true, started: true });
      },
      () => alive() && setStarts((all) => ({ ...all, [agentId]: 'failed' }))
    );
  };
  // A start found under way, begun before this field opened, is followed as its own are.
  useEffect(() => {
    if (lookup && !following.current.has(lookup)) followStart(agent.userId, lookup);
  });
  const startDirect = (agentId: string) => {
    // The field stays with the agent pressed: another that answers meanwhile comes first, and
    // would take it. A pick already made stays as it is.
    if (!choice) setChoice({ agentId, roomId: null, isDirect: true });
    // The thread index as it is once the chats' members have loaded, not as it is now.
    const getThreads = () => store.get(crossRoomThreadIndexAtom).entries.values();
    followStart(agentId, startDirectChat(mx, agentId, version, getThreads));
  };
  // A pick, which nothing takes while a question is being sent: where that goes stays put.
  const pick = (picker: 'agent' | 'room', destination: HomeAskDestination) => {
    if (sending) return;
    setFocusOnMount(false);
    refocusPickerRef.current = picker;
    setChoice(destination);
  };

  // How a place reads: the direct chat as that, whatever its room is named; a room by its name,
  // also one that is the agent's direct chat but was picked as a room.
  const shown = ({ roomId: id, isDirect: asDirect }: Place) => {
    if (asDirect || id === null) {
      return { label: t('home.ask.directChat'), badge: agentBadge(agent) };
    }
    const placeRoom = mx.getRoom(id);
    const label = revealDirectionControls(placeRoom?.name ?? id);
    const mxc = placeRoom?.getMxcAvatarUrl() ?? undefined;
    return { label, badge: <Badge id={id} name={label} mxc={mxc} square /> };
  };
  // A direct chat that is one no longer reads as the room it is.
  const current = shown({ roomId, isDirect: isDirect && (valid || !room) });
  const radio = (
    key: string,
    checked: boolean,
    { label, badge }: { label: string; badge: ReactNode },
    onSelect: () => void,
    description?: string
  ) => (
    <MenuEntry
      key={key}
      role="menuitemradio"
      aria-checked={checked}
      // The chosen row shows it is, as a menu of choices does (ChoiceMenu).
      fill={checked ? 'Soft' : 'None'}
      className={composerCss.ComposerMenuItem}
      label={label}
      description={description}
      icon={Icons.User}
      after={
        <Box as="span" alignItems="Center" gap="200">
          {checked && <Icon size="50" src={Icons.Check} aria-hidden="true" />}
          {badge}
        </Box>
      }
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
              <span className={css.PickerText} {...ownDirectionLine}>
                {agent.name || t('home.ask.chooseAgent')}
              </span>
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
              option === agent,
              { label: option.name, badge: agentBadge(option) },
              // The agent the field is on, picked again, is held with where its question goes
              // now: its room stays the one picked for it, and an agent's later answer no longer
              // moves the field. Any other pick goes to the agent's default room.
              choose(() => {
                if (option === agent && valid) setChoice(selected);
                else pick('agent', destinationOf(option, option.defaultRoomId ?? null));
              }),
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
          {({ choose }) => {
            const rows = places.map((place) => ({ place, face: shown(place) }));
            return rows.map(({ place, face }, index) => {
              // Places of one name are told apart by their addresses, else by their IDs.
              const twin = rows.some(
                (other, at) => at !== index && other.face.label === face.label
              );
              const twinRoom = twin && place.roomId ? mx.getRoom(place.roomId) : null;
              const address = twinRoom?.getCanonicalAlias() || twinRoom?.roomId;
              return radio(
                `${place.isDirect ? 'direct' : 'room'}:${place.roomId ?? ''}`,
                place.roomId === roomId && place.isDirect === isDirect && valid,
                face,
                // Picked as what the row says it is: a checked row picked again changes nothing.
                choose(() => pick('room', { agentId: agent.userId, ...place })),
                place.roomId === null
                  ? t('home.ask.startsDirectChat', { name })
                  : address && revealDirectionControls(address)
              );
            });
          }}
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
              // Sent with no message of the client's own to follow (`onLocalEcho`).
              if (!isLocalEchoEventId(eventId)) {
                store.set(pendingAtom, undefined);
                open(room.roomId, eventId);
              }
              return false;
            }}
            ask={{
              agentUserId: agent.userId,
              isDirect,
              placeholder,
              pickers,
              // Read again at the press, and for the question on its way, with the room it goes
              // to, just before its message goes out: that room or the agent may have changed
              // since. A send asks the field as it was at its press, so about where it goes.
              canSend: (sentTo) =>
                sentTo
                  ? answersIn(sentTo, agent.userId, isDirect)
                  : !store.get(pendingAtom) && valid && answersIn(room, agent.userId, isDirect),
              // Heard also after this page has gone, to the send's end.
              onSendingChange: (now) => {
                if (now) {
                  const sent = { roomId: room.roomId, agentId: agent.userId, isDirect };
                  store.set(pendingAtom, { state: 'sending', ...sent });
                } else if (store.get(pendingAtom)?.state === 'sending') {
                  store.set(pendingAtom, undefined);
                }
              },
              // The question's message, followed from here on: heard also after this page has
              // gone, so the page finds it when it opens again.
              onLocalEcho: (eventId, sentTo) => {
                const sent = { roomId: sentTo.roomId, agentId: agent.userId, isDirect, eventId };
                store.set(pendingAtom, { state: 'echo', ...sent });
              },
            }}
          />
        </ConversationViewContext.Provider>
        {failedNotice}
        {!usable && !loadingMembers && chooseAgain}
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
