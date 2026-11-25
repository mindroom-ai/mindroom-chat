import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
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
import { ComposerMenuButton, ComposerRadioMenuEntry } from '../composer/ComposerMenuButton';
import { RoomInput } from '../composer/RoomInput';
import {
  composerUploadItemsAtom,
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
import {
  IsolatedText,
  isolateInSentence,
  ownDirectionLine,
  revealDirectionControls,
} from '../ui/directional';
import {
  agentNameIn,
  canAskIn,
  type HomeAgent,
  isDirectRoomWith,
  startDirectChat,
} from '../sidebar/home/homeAgents';
import * as css from './Home.css';

type BadgeProps = { id: string; name: string; mxc?: string; src?: string; square?: boolean };
type Place = { roomId: string | null; isDirect: boolean };
type OpenFn = (roomId: string, eventId: string) => void;
type FieldProps = {
  agents: HomeAgent[];
  first: HomeAgent;
  failedNotice: ReactNode;
  open: OpenFn;
  fileDropContainerRef?: RefObject<HTMLElement | null>;
};

export function Badge({ id, name, mxc, src, square }: BadgeProps) {
  const mx = useMatrixClient();
  const useAuth = useMediaAuthentication();
  const url = src ?? (mxc ? mxcUrlToHttp(mx, mxc, useAuth, 40, 40, 'crop') : undefined);
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

const agentBadge = (a: HomeAgent) => <Badge id={a.userId} name={a.name} mxc={a.avatarMxc} />;
const goneAgent = (userId: string): HomeAgent => ({
  userId,
  name: getMxIdLocalPart(userId) ?? userId,
  roomIds: [],
  lastUsedTs: 0,
});
const destinationOf = (a: HomeAgent, roomId: string | null): HomeAskDestination => ({
  agentId: a.userId,
  roomId,
  isDirect: roomId === null || roomId === a.direct?.roomId,
});
const answersIn = (room: Room, agentId: string, isDirect: boolean) =>
  isDirect ? isDirectRoomWith(room, agentId) : canAskIn(room, agentId);

/** Tracks the account's pending Home send: opens on confirmation, or renders failed-send actions. */
const useHomeAskPendingNotice = (open: OpenFn): ReactNode => {
  const mx = useMatrixClient();
  const { t } = useTranslation();
  const store = useStore();
  const pendingAtom = homeAskPendingAtomFamily(mx.getSafeUserId());
  const pending = useAtomValue(pendingAtom);
  const [failed, setFailed] = useState<{ room: Room; event: MatrixEvent }>();
  useEffect(() => {
    const r = pending?.state === 'echo' ? mx.getRoom(pending.roomId) : null;
    const e = pending?.state === 'echo' ? r?.findEventById(pending.eventId) : undefined;
    setFailed(r && e && isFailedLocalEchoEvent(e) ? { room: r, event: e } : undefined);
    if (pending?.state === 'echo' && !e) store.set(pendingAtom, undefined);
  }, [mx, pending, pendingAtom, store]);
  useEffect(() => {
    const onEcho: RoomEventHandlerMap[RoomEvent.LocalEchoUpdated] = (event, r, oldId) => {
      const tracked = store.get(pendingAtom);
      const id = event.getId();
      if (tracked?.state !== 'echo' || r.roomId !== tracked.roomId) return;
      if (oldId !== tracked.eventId && id !== tracked.eventId) return;
      if (id && !isLocalEchoEventId(id)) {
        store.set(pendingAtom, undefined);
        open(r.roomId, id);
      } else if (event.status === EventStatus.CANCELLED) store.set(pendingAtom, undefined);
      else setFailed(isFailedLocalEchoEvent(event) ? { room: r, event } : undefined);
    };
    mx.on(RoomEvent.LocalEchoUpdated, onEcho);
    return () => void mx.removeListener(RoomEvent.LocalEchoUpdated, onEcho);
  }, [mx, open, pendingAtom, store]);
  if (!failed || !pending) return undefined;
  const { room, event } = failed;
  const place =
    pending.isDirect && isDirectRoomWith(room, pending.agentId)
      ? t('home.ask.directChat')
      : revealDirectionControls(room.name || room.roomId);
  const msg = t('home.ask.notSent', {
    agent: isolateInSentence(agentNameIn(room, pending.agentId)),
    room: isolateInSentence(place),
  });
  return (
    <FailedSendActions
      room={room}
      event={event}
      message={<IsolatedText text={msg} />}
      canRetry={() => answersIn(room, pending.agentId, pending.isDirect)}
    />
  );
};

export function HomeAsk({
  agents,
  fileDropContainerRef,
}: {
  agents: HomeAgent[];
  fileDropContainerRef?: RefObject<HTMLElement | null>;
}) {
  const mx = useMatrixClient();
  const { navigateRoom, navigateRoomThreadDirect } = useRoomNavigate();
  const open = useCallback<OpenFn>(
    (roomId, eventId) =>
      getRoomThreadMode(mx.getRoom(roomId)) === 'room'
        ? navigateRoom(roomId, eventId)
        : navigateRoomThreadDirect(roomId, eventId),
    [mx, navigateRoom, navigateRoomThreadDirect]
  );
  const failedNotice = useHomeAskPendingNotice(open);
  const first = agents[0];
  return first ? (
    <HomeAskField
      agents={agents}
      first={first}
      failedNotice={failedNotice}
      open={open}
      fileDropContainerRef={fileDropContainerRef}
    />
  ) : (
    <>{failedNotice}</>
  );
}

function HomeAskField({ agents, first, failedNotice, open, fileDropContainerRef }: FieldProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const store = useStore();
  const editor = useEditor();
  const version = useCapabilities()['m.room_versions']?.default;
  const userId = mx.getSafeUserId();
  const draftKey = getHomeAskDraftKey(userId);
  const draftAtom = roomIdToMsgDraftAtomFamily(draftKey);
  const uploadsAtom = composerUploadItemsAtom(draftKey, HOME_ASK_VIEW);
  const destinationAtom = homeAskDestinationAtomFamily(userId);
  const pendingAtom = homeAskPendingAtomFamily(userId);
  const sending = useAtomValue(pendingAtom)?.state === 'sending';
  const [choice, setChoice] = useState<HomeAskDestination | undefined>(() => {
    const sent = store.get(pendingAtom);
    if (sent?.state === 'sending') {
      return { agentId: sent.agentId, roomId: sent.roomId, isDirect: sent.isDirect };
    }
    const hasDraft = store.get(draftAtom).length > 0;
    const hasFiles = store.get(uploadsAtom).length > 0;
    if (!hasDraft && !hasFiles) return undefined;
    return store.get(destinationAtom) ?? (hasDraft ? { agentId: '', roomId: null } : undefined);
  });
  const [starts, setStarts] = useState<Record<string, 'busy' | 'failed'>>({});
  const alive = useAlive();
  const [focusOnMount, setFocusOnMount] = useState(false);
  const typed = useAtomValue(draftAtom).length > 0;
  const hasStagedFiles = useAtomValue(uploadsAtom).length > 0;
  const selected = choice ?? destinationOf(first, first.defaultRoomId ?? null);
  const agent = agents.find((c) => c.userId === selected.agentId) ?? goneAgent(selected.agentId);
  const agentId = agent.userId;
  const { roomId } = selected;
  const isDirect = !!selected.isDirect;
  const starting = starts[agentId];
  // Freeze destination on the first keystroke or staged file so background ranking updates do not redirect a draft.
  if ((typed || hasStagedFiles) && !choice) {
    setChoice(store.get(destinationAtom) ?? (typed ? { agentId: '', roomId: null } : selected));
  }
  useEffect(() => {
    if (agentId) store.set(destinationAtom, { agentId, roomId, isDirect });
  }, [agentId, destinationAtom, isDirect, roomId, store]);
  const selection = useRef({ agentId, roomId, isDirect });
  selection.current = { agentId, roomId, isDirect };
  const askRef = useRef<HTMLDivElement>(null);
  const agentPickerRef = useRef<HTMLButtonElement | null>(null);
  const roomPickerRef = useRef<HTMLButtonElement | null>(null);
  const refocusRef = useRef<'agent' | 'room' | null>(null);

  const name = isolateInSentence(agent.name);
  const room = roomId ? mx.getRoom(roomId) : null;
  const listed = isDirect
    ? roomId === null || !room || isDirectRoomWith(room, agentId, ['join', 'invite', undefined])
    : roomId !== null && agent.roomIds.includes(roomId);
  const valid = agents.includes(agent) && listed;
  const usable = valid && !!room && answersIn(room, agentId, isDirect);
  const waiting =
    isDirect && valid && !!room && isDirectRoomWith(room, agentId, ['invite', undefined]);
  const composerRoom = room && !waiting ? room : null;
  const busy = starting === 'busy' || (valid && isDirect && roomId !== null && !room);

  useEffect(() => {
    if (focusOnMount && composerRoom) {
      ReactEditor.focus(editor);
      setFocusOnMount(false);
    }
    const target = refocusRef.current;
    if (target) {
      refocusRef.current = null;
      (target === 'agent' ? agentPickerRef : roomPickerRef).current?.focus();
    }
  }, [choice, composerRoom, editor, focusOnMount]);

  const startDirect = (id: string) => {
    if (!choice) setChoice({ agentId: id, roomId: null, isDirect: true });
    setStarts((all) => ({ ...all, [id]: 'busy' }));
    startDirectChat(mx, id, version).then(
      (started) => {
        if (!alive()) return;
        setStarts(({ [id]: done, ...others }) => others);
        const now = selection.current;
        if (now.agentId !== id || !now.isDirect || (now.roomId && now.roomId !== started)) return;
        setFocusOnMount(true);
        setChoice({ agentId: id, roomId: started, isDirect: true });
      },
      () => alive() && setStarts((all) => ({ ...all, [id]: 'failed' }))
    );
  };
  const pick = (picker: 'agent' | 'room', destination: HomeAskDestination) => {
    if (sending) return;
    setFocusOnMount(false);
    refocusRef.current = picker;
    setChoice(destination);
  };
  const shown = ({ roomId: id, isDirect: asDirect }: Place) => {
    if (asDirect || id === null)
      return { label: t('home.ask.directChat'), badge: agentBadge(agent) };
    const r = mx.getRoom(id);
    const label = revealDirectionControls(r?.name ?? id);
    return {
      label,
      badge: <Badge id={id} name={label} mxc={r?.getMxcAvatarUrl() ?? undefined} square />,
    };
  };
  const current = shown({ roomId, isDirect: isDirect && (valid || !room) });
  const radio = (
    key: string,
    checked: boolean,
    face: { label: string; badge: ReactNode },
    onSelect: () => void,
    description?: string
  ) => (
    <ComposerRadioMenuEntry
      key={key}
      checked={checked}
      label={face.label}
      badge={face.badge}
      description={description}
      onSelect={onSelect}
    />
  );

  const chooseAgentLabel = t('home.ask.chooseAgent');
  const pickers = (
    <>
      <ComposerMenuButton
        label={chooseAgentLabel}
        icon={Icons.ChevronBottom}
        triggerButtonRef={agentPickerRef}
        face={{
          content: (
            <>
              {agentId && agentBadge(agent)}
              <span className={css.PickerText} {...ownDirectionLine}>
                {agent.name || chooseAgentLabel}
              </span>
            </>
          ),
          label: agent.name ? t('home.ask.agentChoice', { name: agent.name }) : chooseAgentLabel,
        }}
      >
        {({ choose }) =>
          agents.map((opt) =>
            radio(
              opt.userId,
              opt === agent,
              { label: opt.name, badge: agentBadge(opt) },
              choose(() =>
                opt === agent && valid
                  ? setChoice(selected)
                  : pick('agent', destinationOf(opt, opt.defaultRoomId ?? null))
              ),
              agents.some((o) => o !== opt && o.name === opt.name)
                ? revealDirectionControls(opt.userId)
                : undefined
            )
          )
        }
      </ComposerMenuButton>
      {agentId && (
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
                  components={{ avatar: <>{current.badge}</> }}
                />
              </span>
            ),
            label: t('home.ask.roomChoice', { room: current.label }),
          }}
        >
          {({ choose }) => {
            const directId = agent.direct?.roomId ?? null;
            const places: Place[] = [
              ...agent.roomIds
                .filter((id) => id !== directId)
                .map((id) => ({ roomId: id, isDirect: false })),
              { roomId: directId, isDirect: true },
            ];
            const rows = places.map((place) => ({ place, face: shown(place) }));
            return rows.map(({ place, face }, i) => {
              const twin = rows.some((o, at) => at !== i && o.face.label === face.label);
              const addr =
                twin && place.roomId
                  ? mx.getRoom(place.roomId)?.getCanonicalAlias() || place.roomId
                  : undefined;
              return radio(
                `${place.isDirect ? 'direct' : 'room'}:${place.roomId ?? ''}`,
                place.roomId === roomId && place.isDirect === isDirect && valid,
                face,
                choose(() => pick('room', { agentId, ...place })),
                place.roomId === null
                  ? t('home.ask.startsDirectChat', { name })
                  : addr && revealDirectionControls(addr)
              );
            });
          }}
        </ComposerMenuButton>
      )}
    </>
  );

  const placeholder = agent.name ? t('home.ask.placeholder', { name }) : chooseAgentLabel;
  const alert = (content: ReactNode) => (
    <Text role="alert" size="T200" className={css.StandInError}>
      {content}
    </Text>
  );
  const standInLabel =
    (waiting && t('home.ask.waitingForAgent', { name })) ||
    (busy && t('home.ask.startingDirectChat', { name })) ||
    placeholder;

  return (
    <div ref={askRef} className={css.Ask}>
      {composerRoom ? (
        <ConversationViewContext value={HOME_ASK_VIEW}>
          <RoomInput
            editor={editor}
            room={composerRoom}
            roomId={composerRoom.roomId}
            threadingEnabled={getRoomThreadMode(composerRoom) !== 'room'}
            fileDropContainerRef={fileDropContainerRef ?? askRef}
            onRoomMessageSent={(eventId) => {
              if (isLocalEchoEventId(eventId)) return false;
              store.set(pendingAtom, undefined);
              open(composerRoom.roomId, eventId);
              return getRoomThreadMode(composerRoom) !== 'room';
            }}
            ask={{
              agentUserId: agentId,
              isDirect,
              placeholder,
              pickers,
              canSend: (r) =>
                r
                  ? answersIn(r, agentId, isDirect)
                  : !store.get(pendingAtom) && valid && answersIn(composerRoom, agentId, isDirect),
              onSendingChange: (now) => {
                const next = now
                  ? { state: 'sending' as const, roomId: composerRoom.roomId, agentId, isDirect }
                  : undefined;
                if (now || store.get(pendingAtom)?.state === 'sending')
                  store.set(pendingAtom, next);
              },
              onLocalEcho: (eventId, r) =>
                store.set(pendingAtom, {
                  state: 'echo',
                  roomId: r.roomId,
                  eventId,
                  agentId,
                  isDirect,
                }),
            }}
          />
        </ConversationViewContext>
      ) : (
        <div className={css.StandIn}>
          <button
            type="button"
            className={css.StandInField}
            aria-busy={busy}
            disabled={waiting || !valid}
            onClick={() => !busy && startDirect(agentId)}
          >
            <IsolatedText text={standInLabel} />
          </button>
          {starting === 'failed' &&
            alert(<IsolatedText text={t('home.ask.directChatFailed', { name })} />)}
          {!valid && alert(t('home.ask.chooseAgain'))}
          <div className={css.StandInRow}>{pickers}</div>
        </div>
      )}
      {failedNotice}
      {composerRoom && !usable && alert(t('home.ask.chooseAgain'))}
    </div>
  );
}
