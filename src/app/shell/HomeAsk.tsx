import { type RefObject, useEffect, useRef, useState } from 'react';
import { Avatar, Icons, Text } from 'folds';
import { useAtomValue, useStore } from 'jotai';
import { Trans, useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import type { Editor } from 'slate';
import { ReactEditor } from 'slate-react';
import { UserAvatar } from '../avatars/UserAvatar';
import { RoomAvatar } from '../avatars/RoomAvatar';
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
import { getMxIdLocalPart, mxcUrlToHttp } from '../matrix/matrix';
import { getMemberAvatarMxc, getMemberRawDisplayName } from '../matrix/room';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { useRoomViewMode } from '../navigation/useRoomViewMode';
import { revealDirectionControls } from '../ui/directional';
import { MenuEntry } from '../ui/MenuEntry';
import type { HomeAgent } from './homeAgents';
import * as css from './Home.css';

const AVATAR_PX = 40;

/** An agent's name and avatar as the first of its rooms knows them. */
const useAgentLook = (agent: HomeAgent) => {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const room = mx.getRoom(agent.roomIds[0] ?? agent.directRoomId ?? '');
  const localpart = getMxIdLocalPart(agent.userId) ?? agent.userId;
  const name =
    (room && getMemberRawDisplayName(room, agent.userId)) || localpart.replace(/^mindroom_/, '');
  const mxc = room ? getMemberAvatarMxc(room, agent.userId) : undefined;
  const src = mxc
    ? mxcUrlToHttp(mx, mxc, useAuthentication, AVATAR_PX, AVATAR_PX, 'crop') ?? undefined
    : undefined;
  return { name, src };
};

function AgentAvatar({ agent }: { agent: HomeAgent }) {
  const { name, src } = useAgentLook(agent);
  return (
    <Avatar size="200" radii="Pill" className={css.PickerAvatar}>
      <UserAvatar
        userId={agent.userId}
        src={src}
        alt=""
        renderFallback={() => <Text size="L400">{nameInitials(name)}</Text>}
      />
    </Avatar>
  );
}

function RoomBadge({ room }: { room: Room }) {
  return (
    <Avatar size="200" radii="300" className={css.PickerAvatar}>
      <RoomAvatar
        roomId={room.roomId}
        alt=""
        renderFallback={() => <Text size="L400">{nameInitials(room.name)}</Text>}
      />
    </Avatar>
  );
}

type PickersProps = {
  agents: HomeAgent[];
  agent: HomeAgent;
  roomId: string | null;
  /** Files are staged in the room's composer, which cannot follow to another room. */
  locked: boolean;
  onAgent(agentId: string): void;
  onRoom(roomId: string | null): void;
};

/** Who answers and where: the agent, then the room its thread starts in. */
function HomeAskPickers({ agents, agent, roomId, locked, onAgent, onRoom }: PickersProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const { name } = useAgentLook(agent);
  const room = roomId ? mx.getRoom(roomId) : null;
  const direct = roomId === null || roomId === agent.directRoomId;
  const roomName = direct || !room ? t('home.ask.directChat') : revealDirectionControls(room.name);
  const roomOptions: Array<string | null> = agent.directRoomId
    ? agent.roomIds
    : [...agent.roomIds, null];
  return (
    <>
      <ComposerMenuButton
        label={t('home.ask.chooseAgent')}
        icon={Icons.ChevronBottom}
        disabled={locked}
        face={{
          content: (
            <>
              <AgentAvatar agent={agent} />
              <span className={css.PickerText}>{name}</span>
            </>
          ),
          label: t('home.ask.agentChoice', { name }),
        }}
      >
        {({ choose }) =>
          agents.map((option) => (
            <AgentOption
              key={option.userId}
              agent={option}
              checked={option.userId === agent.userId}
              onSelect={choose(() => onAgent(option.userId))}
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
                values={{ room: roomName }}
                tOptions={{ interpolation: { escapeValue: true } }}
                shouldUnescape
                components={{
                  avatar:
                    room && !direct ? <RoomBadge room={room} /> : <AgentAvatar agent={agent} />,
                }}
              />
            </span>
          ),
          label: t('home.ask.roomChoice', { room: roomName }),
        }}
      >
        {({ choose }) =>
          roomOptions.map((option) => {
            const optionRoom = option ? mx.getRoom(option) : null;
            const isDirect = option === null || option === agent.directRoomId;
            return (
              <MenuEntry
                key={option ?? 'new-direct'}
                role="menuitemradio"
                aria-checked={option === roomId}
                className={composerCss.ComposerMenuItem}
                label={
                  isDirect || !optionRoom
                    ? t('home.ask.directChat')
                    : revealDirectionControls(optionRoom.name)
                }
                description={option === null ? t('home.ask.startsDirectChat', { name }) : undefined}
                icon={Icons.Hash}
                after={
                  optionRoom && !isDirect ? (
                    <RoomBadge room={optionRoom} />
                  ) : (
                    <AgentAvatar agent={agent} />
                  )
                }
                onSelect={choose(() => onRoom(option))}
              />
            );
          })
        }
      </ComposerMenuButton>
    </>
  );
}

function AgentOption({
  agent,
  checked,
  onSelect,
}: {
  agent: HomeAgent;
  checked: boolean;
  onSelect: () => void;
}) {
  const { name } = useAgentLook(agent);
  return (
    <MenuEntry
      role="menuitemradio"
      aria-checked={checked}
      className={composerCss.ComposerMenuItem}
      label={name}
      icon={Icons.User}
      after={<AgentAvatar agent={agent} />}
      onSelect={onSelect}
    />
  );
}

type ComposerProps = {
  room: Room;
  editor: Editor;
  agentUserId: string;
  placeholder: string;
  pickers: React.ReactNode;
  dropRef: RefObject<HTMLElement>;
  /** The field opened by the reader's own action, a chat just started: it takes the focus. */
  focusOnMount: boolean;
};

/** The room's own composer, whose message opens as a new thread once the server has it. */
function HomeAskComposer({
  room,
  editor,
  agentUserId,
  placeholder,
  pickers,
  dropRef,
  focusOnMount,
}: ComposerProps) {
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
      ask={{ agentUserId, placeholder, pickers }}
    />
  );
}

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

type HomeAskProps = { agents: HomeAgent[]; dropRef: RefObject<HTMLElement> };

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
  const roomId =
    chosenRoom?.agentId === agent.userId ? chosenRoom.roomId : agent.defaultRoomId ?? null;
  const room = roomId ? mx.getRoom(roomId) : null;
  // A chat being started, or started but not yet in the client.
  const busy = starting === 'busy' || (roomId !== null && !room);
  const staged = useAtomValue(composerUploadItemsAtom(roomId ?? '', undefined));
  const { name } = useAgentLook(agent);
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
  const pickAgent = (agentId: string) => {
    const next = agents.find((candidate) => candidate.userId === agentId);
    if (!next) return;
    setChosenAgent(agentId);
    pickRoom(agentId, next.defaultRoomId ?? null);
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

  const pickers = (
    <HomeAskPickers
      agents={agents}
      agent={agent}
      roomId={roomId}
      locked={staged.length > 0}
      onAgent={pickAgent}
      onRoom={(next) => pickRoom(agent.userId, next)}
    />
  );
  const placeholder = t('home.ask.placeholder', { name });

  if (room) {
    return (
      <HomeAskComposer
        key={room.roomId}
        room={room}
        editor={editor}
        agentUserId={agent.userId}
        placeholder={placeholder}
        pickers={pickers}
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
