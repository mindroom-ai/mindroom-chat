import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Avatar, Icons, Text } from 'folds';
import { useAtomValue } from 'jotai';
import { Trans, useTranslation } from 'react-i18next';
import { RoomEvent, type RoomEventHandlerMap } from 'matrix-js-sdk';
import { ReactEditor } from 'slate-react';
import { UserAvatar } from '../avatars/UserAvatar';
import { ComposerMenuButton } from '../composer/ComposerMenuButton';
import { RoomInput } from '../composer/RoomInput';
import * as composerCss from '../composer/RoomInput.css';
import { getHomeAskDraftKey, roomIdToMsgDraftAtomFamily } from '../composer/roomInputDrafts';
import { useEditor } from '../editor/Editor';
import { isLocalEchoEventId } from '../event-store/threads/threadRouteUtils';
import { nameInitials } from '../lib/common';
import { useCapabilities } from '../matrix/hooks/useCapabilities';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { getMxIdLocalPart, mxcUrlToHttp } from '../matrix/matrix';
import { getRoomThreadMode } from '../matrix/protocol/roomThreadMode';
import { ConversationViewContext, HOME_ASK_VIEW } from '../navigation/conversationView';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { IsolatedText, isolateInSentence, revealDirectionControls } from '../ui/directional';
import { MenuEntry } from '../ui/MenuEntry';
import { canAskIn, type HomeAgent, startDirectChat } from './homeAgents';
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
  const editor = useEditor();
  const version = useCapabilities()['m.room_versions']?.default;
  // Who answers and where, once picked or once the field holds text: sync moves neither then. A
  // null room is the agent's direct chat, yet to be started.
  const [choice, setChoice] = useState<{
    agentId: string;
    roomId: string | null;
    started?: boolean;
  }>();
  const [starts, setStarts] = useState<Record<string, 'busy' | 'failed'>>({});
  const [focusOnMount, setFocusOnMount] = useState(false);
  const draftAtom = roomIdToMsgDraftAtomFamily(getHomeAskDraftKey(mx.getSafeUserId()));
  const typed = useAtomValue(draftAtom).length > 0;
  const agent = choice
    ? agents.find((candidate) => candidate.userId === choice.agentId) ?? goneAgent(choice.agentId)
    : first;
  const roomId = choice ? choice.roomId : agent.defaultRoomId ?? null;
  if (typed && !choice) setChoice({ agentId: agent.userId, roomId });
  const selection = useRef({ agentId: agent.userId, roomId });
  selection.current = { agentId: agent.userId, roomId };
  const { navigateRoom, navigateRoomThreadDirect } = useRoomNavigate();
  // No drop zone: a file dropped on Home is not attached.
  const noDrop = useRef<HTMLElement>(null);
  const sentRef = useRef<string>();

  // Names read in their own direction in a sentence; an accessible name needs no isolate.
  const name = isolateInSentence(agent.name);
  const { direct } = agent;
  // Its rooms, then its direct chat, or none yet to start (null).
  const roomIds: (string | null)[] = [...agent.roomIds];
  if (!direct) roomIds.push(null);
  else if (!roomIds.includes(direct.roomId)) roomIds.push(direct.roomId);
  const room = roomId ? mx.getRoom(roomId) : null;
  // A chat just started is among the choices once the client has it, and waits until the agent
  // joins even if the room arrives before `m.direct` syncs back.
  const valid =
    agents.includes(agent) &&
    (roomIds.includes(roomId) || (!!choice?.started && (!room || !direct)));
  const waiting =
    (!!direct?.waiting && roomId === direct.roomId) ||
    (!!choice?.started && !!room && !canAskIn(room, agent.userId));
  const usable = valid && !!room && canAskIn(room, agent.userId);
  const starting = starts[agent.userId];
  const composerShown = !!room && !waiting;
  useEffect(() => {
    if (!focusOnMount || !composerShown) return;
    ReactEditor.focus(editor);
    setFocusOnMount(false);
  }, [composerShown, editor, focusOnMount]);

  // A question opens once the server has it, under the ID it gave: the room at it where agents
  // answer in the room's main timeline, elsewhere its new thread.
  const open = useCallback(
    (openRoomId: string, eventId: string) => {
      if (getRoomThreadMode(mx.getRoom(openRoomId)) === 'room') navigateRoom(openRoomId, eventId);
      else navigateRoomThreadDirect(openRoomId, eventId);
    },
    [mx, navigateRoom, navigateRoomThreadDirect]
  );
  useEffect(() => {
    const onEcho: RoomEventHandlerMap[RoomEvent.LocalEchoUpdated] = (event, echoRoom, oldId) => {
      const confirmed = event.getId();
      if (oldId && oldId === sentRef.current && confirmed && !isLocalEchoEventId(confirmed)) {
        open(echoRoom.roomId, confirmed);
      }
    };
    mx.on(RoomEvent.LocalEchoUpdated, onEcho);
    return () => {
      mx.removeListener(RoomEvent.LocalEchoUpdated, onEcho);
    };
  }, [mx, open]);
  // A chat being started, or started but not yet in the client.
  const busy = starting === 'busy' || (roomId !== null && !room);

  const startDirect = (agentId: string) => {
    setStarts((all) => ({ ...all, [agentId]: 'busy' }));
    startDirectChat(mx, agentId, version).then(
      (started) => {
        setStarts(({ [agentId]: done, ...others }) => others);
        // A choice made meanwhile stands.
        if (selection.current.agentId !== agentId || selection.current.roomId !== null) return;
        setFocusOnMount(true);
        setChoice({ agentId, roomId: started, started: true });
      },
      () => setStarts((all) => ({ ...all, [agentId]: 'failed' }))
    );
  };

  const shown = (id: string | null) => {
    const choiceRoom = id ? mx.getRoom(id) : null;
    if (!choiceRoom || id === direct?.roomId) {
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
        face={{
          content: (
            <>
              {agentBadge(agent)}
              <span className={css.PickerText}>{agent.name}</span>
            </>
          ),
          label: t('home.ask.agentChoice', { name: agent.name }),
        }}
      >
        {({ choose }) =>
          agents.map((option) =>
            radio(
              option.userId,
              Icons.User,
              option === agent,
              { label: option.name, badge: agentBadge(option) },
              choose(() => {
                setFocusOnMount(false);
                setChoice({ agentId: option.userId, roomId: option.defaultRoomId ?? null });
              })
            )
          )
        }
      </ComposerMenuButton>
      <ComposerMenuButton
        label={t('home.ask.chooseRoom')}
        icon={Icons.ChevronBottom}
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
              id === roomId,
              shown(id),
              choose(() => {
                setFocusOnMount(false);
                setChoice({ agentId: agent.userId, roomId: id });
              }),
              id === null ? t('home.ask.startsDirectChat', { name }) : undefined
            )
          )
        }
      </ComposerMenuButton>
    </>
  );
  const placeholder = t('home.ask.placeholder', { name });
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
              if (isLocalEchoEventId(eventId)) sentRef.current = eventId;
              else open(room.roomId, eventId);
              return false;
            }}
            ask={{
              agentUserId: agent.userId,
              placeholder,
              pickers,
              // Read again at the press: the room or the agent may have changed since.
              canSend: () => valid && canAskIn(room, agent.userId),
            }}
          />
        </ConversationViewContext.Provider>
        {!usable && chooseAgain}
      </div>
    );
  }
  // No chat with the agent yet: a press starts one, whose composer then takes the field.
  let label = placeholder;
  if (waiting) label = t('home.ask.waitingForAgent', { name });
  else if (busy) label = t('home.ask.startingDirectChat', { name });
  return (
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
  );
}
