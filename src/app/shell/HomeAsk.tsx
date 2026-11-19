import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { Avatar, Icons, Text } from 'folds';
import { useAtomValue, useStore } from 'jotai';
import { Trans, useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import type { Editor } from 'slate';
import { ReactEditor } from 'slate-react';
import { UserAvatar } from '../avatars/UserAvatar';
import { ComposerMenuButton } from '../composer/ComposerMenuButton';
import { RoomInput } from '../composer/RoomInput';
import * as composerCss from '../composer/RoomInput.css';
import {
  composerUploadItemsAtom,
  getRoomInputDraftKey,
  roomIdToMsgDraftAtomFamily,
} from '../composer/roomInputDrafts';
import { useEditor } from '../editor/Editor';
import { nameInitials } from '../lib/common';
import { createDirectRoom, findDirectRoom } from '../matrix/createRoom';
import { useCapabilities } from '../matrix/hooks/useCapabilities';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../matrix/matrix';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { useRoomViewMode } from '../navigation/useRoomViewMode';
import { revealDirectionControls } from '../ui/directional';
import { MenuEntry } from '../ui/MenuEntry';
import type { HomeAgent } from './homeAgents';
import * as css from './Home.css';

const AVATAR_PX = 40;

/** A picker's small picture: round for an agent, square for a room, initials while it has none. */
function Badge({
  id,
  name,
  mxc,
  square,
}: {
  id: string;
  name: string;
  mxc?: string;
  square?: boolean;
}) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const src = mxc
    ? mxcUrlToHttp(mx, mxc, useAuthentication, AVATAR_PX, AVATAR_PX, 'crop') ?? undefined
    : undefined;
  return (
    <Avatar size="200" radii={square ? '300' : 'Pill'} className={css.PickerAvatar}>
      <UserAvatar
        userId={id}
        src={src}
        alt=""
        renderFallback={() => <Text size="L400">{nameInitials(name)}</Text>}
      />
    </Avatar>
  );
}

const agentBadge = (agent: HomeAgent) => (
  <Badge id={agent.userId} name={agent.name} mxc={agent.avatarMxc} />
);

type ComposerProps = {
  room: Room;
  editor: Editor;
  ask: { agentUserId: string; placeholder: string; pickers: ReactNode };
  dropRef: RefObject<HTMLElement>;
  /** The field opened by the reader's own action, a chat just started: it takes the focus. */
  focusOnMount: boolean;
};

/** The room's own composer, whose message opens as a new thread once the server has it. */
function HomeAskComposer({ room, editor, ask, dropRef, focusOnMount }: ComposerProps) {
  const { viewMode } = useRoomViewMode(room.roomId);
  const { navigateRoom, navigateRoomThreadDirect } = useRoomNavigate();
  useEffect(() => {
    if (focusOnMount) ReactEditor.focus(editor as ReactEditor);
  }, [editor, focusOnMount]);
  // Opened as the sidebar's thread rows open one: Classic shows its replies in the room.
  const openThread = (eventId: string) => {
    if (viewMode === 'classic') navigateRoom(room.roomId, eventId);
    else navigateRoomThreadDirect(room.roomId, eventId);
    return true;
  };
  return (
    <RoomInput
      editor={editor}
      room={room}
      roomId={room.roomId}
      fileDropContainerRef={dropRef}
      onRoomMessageSent={openThread}
      ask={ask}
    />
  );
}

type HomeAskProps = { agents: HomeAgent[]; dropRef: RefObject<HTMLElement> };

/**
 * Home's ask field: a question to one of the rooms' agents, sent from the room's own composer as a
 * new thread there, which then opens. It goes to the room last used with the agent, else its
 * direct chat, which a press on the field starts when there is none yet; the pickers choose
 * another agent or room, and the text typed so far follows the choice.
 */
export function HomeAsk({ agents, dropRef }: HomeAskProps) {
  const first = agents[0];
  return first ? <HomeAskField agents={agents} first={first} dropRef={dropRef} /> : null;
}

function HomeAskField({ agents, first, dropRef }: HomeAskProps & { first: HomeAgent }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const store = useStore();
  const editor = useEditor();
  const version = useCapabilities()['m.room_versions']?.default;
  const [chosenAgent, setChosenAgent] = useState<string>();
  // The room chosen for an agent; null is its direct chat, yet to be started.
  const [chosenRoom, setChosenRoom] = useState<{ agentId: string; roomId: string | null }>();
  const [starting, setStarting] = useState<'busy' | 'failed'>();
  const [focusOnMount, setFocusOnMount] = useState(false);
  const agent = agents.find((candidate) => candidate.userId === chosenAgent) ?? first;
  const { name } = agent;
  const roomId =
    chosenRoom?.agentId === agent.userId ? chosenRoom.roomId : agent.defaultRoomId ?? null;
  const room = roomId ? mx.getRoom(roomId) : null;
  // A chat being started, or started but not yet in the client.
  const busy = starting === 'busy' || (roomId !== null && !room);
  // Files staged in the room's composer cannot follow the field to another room.
  const locked = useAtomValue(composerUploadItemsAtom(roomId ?? '', undefined)).length > 0;
  // The room whose draft the field showed last, which the text follows to the next.
  const shownRoomRef = useRef<string>();
  if (room) shownRoomRef.current = room.roomId;

  const carryDraft = (to: string | null) => {
    const from = shownRoomRef.current;
    if (!from || !to || from === to) return;
    const userId = mx.getSafeUserId();
    const fromAtom = roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(userId, from));
    const toAtom = roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(userId, to));
    const draft = store.get(fromAtom);
    if (draft.length === 0) return;
    store.set(toAtom, [...store.get(toAtom), ...draft]);
    store.set(fromAtom, []);
  };
  const pickRoom = (agentId: string, next: string | null) => {
    carryDraft(next);
    setStarting(undefined);
    setChosenRoom({ agentId, roomId: next });
  };
  const startDirect = async () => {
    if (busy) return;
    setStarting('busy');
    try {
      const started =
        findDirectRoom(mx, agent.userId) ?? (await createDirectRoom(mx, agent.userId, { version }));
      carryDraft(started);
      setFocusOnMount(true);
      setChosenRoom({ agentId: agent.userId, roomId: started });
    } catch {
      setStarting('failed');
    }
  };

  // Its rooms, then its direct chat, which may be yet to start (null).
  const direct = agent.directRoomId ?? null;
  const choices = (
    direct && agent.roomIds.includes(direct) ? agent.roomIds : [...agent.roomIds, direct]
  ).map((id) => {
    const choice = id ? mx.getRoom(id) : null;
    if (!choice || id === direct) {
      return { id, label: t('home.ask.directChat'), badge: agentBadge(agent) };
    }
    const label = revealDirectionControls(choice.name);
    const mxc = choice.getMxcAvatarUrl() ?? undefined;
    return { id, label, badge: <Badge id={choice.roomId} name={choice.name} mxc={mxc} square /> };
  });
  const current = choices.find((choice) => choice.id === roomId) ?? choices[choices.length - 1];
  const pickers = (
    <>
      <ComposerMenuButton
        label={t('home.ask.chooseAgent')}
        icon={Icons.ChevronBottom}
        disabled={locked}
        face={{
          content: (
            <>
              {agentBadge(agent)}
              <span className={css.PickerText}>{name}</span>
            </>
          ),
          label: t('home.ask.agentChoice', { name }),
        }}
      >
        {({ choose }) =>
          agents.map((option) => (
            <MenuEntry
              key={option.userId}
              role="menuitemradio"
              aria-checked={option.userId === agent.userId}
              className={composerCss.ComposerMenuItem}
              label={option.name}
              icon={Icons.User}
              after={agentBadge(option)}
              onSelect={choose(() => {
                setChosenAgent(option.userId);
                pickRoom(option.userId, option.defaultRoomId ?? null);
              })}
            />
          ))
        }
      </ComposerMenuButton>
      <ComposerMenuButton
        label={t('home.ask.chooseRoom')}
        icon={Icons.ChevronBottom}
        disabled={locked}
        face={{
          content: (
            <span className={css.PickerText}>
              <Trans
                i18nKey="home.ask.inRoom"
                values={{ room: current?.label }}
                tOptions={{ interpolation: { escapeValue: true } }}
                shouldUnescape
                components={{ avatar: <>{current?.badge}</> }}
              />
            </span>
          ),
          label: t('home.ask.roomChoice', { room: current?.label }),
        }}
      >
        {({ choose }) =>
          choices.map((choice) => (
            <MenuEntry
              key={choice.id ?? 'new-direct'}
              role="menuitemradio"
              aria-checked={choice.id === roomId}
              className={composerCss.ComposerMenuItem}
              label={choice.label}
              description={
                choice.id === null ? t('home.ask.startsDirectChat', { name }) : undefined
              }
              icon={Icons.Hash}
              after={choice.badge}
              onSelect={choose(() => pickRoom(agent.userId, choice.id))}
            />
          ))
        }
      </ComposerMenuButton>
    </>
  );
  const placeholder = t('home.ask.placeholder', { name });

  if (room) {
    return (
      <HomeAskComposer
        key={room.roomId}
        room={room}
        editor={editor}
        ask={{ agentUserId: agent.userId, placeholder, pickers }}
        dropRef={dropRef}
        focusOnMount={focusOnMount}
      />
    );
  }
  // No chat with the agent yet: a press starts one, whose composer then takes the field.
  return (
    <div className={css.StandIn}>
      <button
        type="button"
        className={css.StandInField}
        aria-busy={busy}
        onClick={() => void startDirect()}
      >
        {busy ? t('home.ask.startingDirectChat', { name }) : placeholder}
      </button>
      {starting === 'failed' && (
        <Text role="alert" size="T200" className={css.StandInError}>
          {t('home.ask.directChatFailed', { name })}
        </Text>
      )}
      <div className={css.StandInRow}>{pickers}</div>
    </div>
  );
}
