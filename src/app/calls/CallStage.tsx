import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Avatar, Icon, Icons, Text, toRem } from 'folds';
import { useResizeObserver } from '../lib/hooks/useResizeObserver';
import { isMindroomAgentUserId } from '../matrix/protocol/agentIdentity';
import { NameWithUserId } from '../matrix/NameWithUserId';
import type { CallParticipant } from './RoomCall';
import { CallMemberAvatar, CallTile, ScreenTile, useCallMemberProfile } from './CallTile';
import {
  SPEAKER_VIEW_MIN_TILE,
  STAGE_PADDING,
  TILE_GAP,
  byPerson,
  fitTiles,
  hasVideo,
  pickFocus,
  screenKey,
  sharedScreens,
  stageView,
  type StageView,
} from './stageLayout';
import * as css from './CallStage.css';

/** How far apart (px) the overlapping faces of speaker view's row sit. */
const SPEAKER_FACE_STEP = 18;
/** Speaker view's row shows this many faces at most; a longer one ends with a count of the rest. */
const SPEAKER_FACES = 5;
/** Room (px) a shared screen keeps at its top end corner for its full screen button. */
const SCREEN_CONTROL_ROOM = 32;

type StageSize = { width: number; height: number };

/** The stage's content box as its ResizeObserver last reported it; unknown until then. */
const useStageSize = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<StageSize>();
  const getStage = useCallback(() => ref.current, []);
  useResizeObserver((entries) => {
    const measured = entries[entries.length - 1]?.contentRect;
    if (!measured) return;
    const { width, height } = measured;
    setSize((last) => (last?.width === width && last.height === height ? last : { width, height }));
  }, getStage);
  return [ref, size] as const;
};

type FaceProps = { room: Room; participant: CallParticipant };

/** Someone else on the voice stage: their face, ringed while they talk, and maybe their name. */
function VoiceFace({ room, participant, named }: FaceProps & { named: boolean }) {
  const { t } = useTranslation();
  const { name } = useCallMemberProfile(room, participant.userId);
  return (
    <li
      className={css.VoiceFace}
      data-call-tile={participant.userId}
      data-speaking={participant.speaking}
      data-connected={participant.connected}
      aria-label={name}
    >
      <span className={css.VoiceAvatarFrame}>
        <CallMemberAvatar
          room={room}
          userId={participant.userId}
          className={named ? css.VoiceAvatar.group : css.VoiceAvatar.solo}
        />
        {!participant.microphone && (
          <span className={css.VoiceMuted}>
            <Icon
              size="50"
              src={Icons.MicMute}
              aria-label={t('featureUi.calls.panel.microphoneOff')}
              role="img"
            />
          </span>
        )}
      </span>
      {/* As on a tile, a long name may be cut short, never the user ID that tells it apart. */}
      {!participant.connected ? (
        <span className={css.VoiceName}>
          <NameWithUserId
            name={name}
            userId={participant.userId}
            text={(shown) => t('featureUi.calls.panel.waitingFor', { name: shown })}
            size="T200"
            priority="300"
          />
        </span>
      ) : (
        named && (
          <span className={css.VoiceName}>
            <NameWithUserId name={name} userId={participant.userId} size="T200" />
          </span>
        )
      )}
    </li>
  );
}

/**
 * This device's person on the voice stage, which shows only the others: still in the people list
 * a screen reader reads, with the same marks as a tile.
 */
function OffStageEntry({ room, participant }: FaceProps) {
  const { t } = useTranslation();
  const { name } = useCallMemberProfile(room, participant.userId);
  return (
    <li
      className={css.OffStage}
      data-call-tile={participant.userId}
      data-speaking={participant.speaking}
      data-connected={participant.connected}
    >
      {t('featureUi.calls.panel.you', { name })}
    </li>
  );
}

function SpeakingLine({ room, userId }: { room: Room; userId: string }) {
  const { t } = useTranslation();
  const { name } = useCallMemberProfile(room, userId);
  return (
    <NameWithUserId
      name={name}
      userId={userId}
      text={(shown) => t('featureUi.calls.stage.speaking', { name: shown })}
      size="T200"
      priority="300"
    />
  );
}

type VoiceStageProps = { room: Room; people: CallParticipant[]; microphone: boolean };

/**
 * Nobody shows video: the others' faces, one per person whatever their devices, bars that move
 * while anyone talks, and who does. Alone in the call, a line that waits for the others instead.
 */
function VoiceStage({ room, people: devices, microphone }: VoiceStageProps) {
  const { t } = useTranslation();
  const people = byPerson(devices);
  const others = people.filter((participant) => !participant.local);
  const speaker = others.find((participant) => participant.speaking);
  const anyoneSpeaks = people.some((participant) => participant.speaking);
  // Agents listen while nobody talks; quiet people are just quiet, so nothing is said of them. An
  // agent the call still waits for is not listening yet: its face says it is awaited.
  const agentsOnly = others.every(
    ({ userId, connected }) => connected && isMindroomAgentUserId(userId)
  );
  let status: ReactNode;
  if (speaker) status = <SpeakingLine room={room} userId={speaker.userId} />;
  else if (!microphone) status = t('featureUi.calls.stage.muted');
  else if (agentsOnly) status = t('featureUi.calls.stage.listening');
  return (
    <div className={css.Voice}>
      <ul className={css.VoiceFaces} aria-label={t('featureUi.calls.panel.participants')}>
        {people.map((participant) =>
          participant.local ? (
            <OffStageEntry key={participant.userId} room={room} participant={participant} />
          ) : (
            <VoiceFace
              key={participant.userId}
              room={room}
              participant={participant}
              named={others.length > 1}
            />
          )
        )}
      </ul>
      {others.length === 0 ? (
        <Text size="T300" priority="300">
          {t('featureUi.calls.stage.waiting')}
        </Text>
      ) : (
        <>
          <span
            className={css.VoiceBars}
            data-call-voice-bars=""
            data-speaking={anyoneSpeaks}
            aria-hidden
          >
            <span className={css.VoiceBar} />
            <span className={css.VoiceBar} />
            <span className={css.VoiceBar} />
          </span>
          {status && (
            <Text as="div" className={css.VoiceStatus} size="T200" priority="300">
              {status}
            </Text>
          )}
        </>
      )}
    </div>
  );
}

/** One of speaker view's small faces, the people not in focus, `inlineEnd` px from the end. */
function SpeakerFace({ room, participant, inlineEnd }: FaceProps & { inlineEnd: number }) {
  const { t } = useTranslation();
  const { name } = useCallMemberProfile(room, participant.userId);
  const style: CSSProperties = { insetInlineEnd: toRem(inlineEnd) };
  return (
    <li
      className={css.SpeakerFace}
      style={style}
      data-call-tile={participant.userId}
      data-speaking={participant.speaking}
      data-connected={participant.connected}
      aria-label={participant.local ? t('featureUi.calls.panel.you', { name }) : name}
    >
      <CallMemberAvatar room={room} userId={participant.userId} size="200" />
    </li>
  );
}

/** The last face of a long row in speaker view: how many more people the row leaves out. */
function MoreFaces({ count, inlineEnd }: { count: number; inlineEnd: number }) {
  const { t } = useTranslation();
  const style: CSSProperties = { insetInlineEnd: toRem(inlineEnd) };
  return (
    <li
      className={css.SpeakerFace}
      style={style}
      aria-label={t('featureUi.calls.stage.moreLabel', { count })}
    >
      <Avatar className={css.MoreFaces} size="200" radii="Pill" aria-hidden>
        <Text as="span" size="L400" className={css.MoreCount[count < 10 ? 'short' : 'long']}>
          {t('featureUi.calls.stage.more', { count })}
        </Text>
      </Avatar>
    </li>
  );
}

type CallStageProps = {
  room: Room;
  participants: CallParticipant[];
  /** The agent an agent call waits for, shown waiting until it joins. */
  awaited?: CallParticipant;
  /**
   * The person's pick of speaker view (true) or the grid (false); none for the screens shared now
   * leaves the stage at its default (`stageView`).
   */
  speakerView?: boolean;
  /** This device's microphone is on. */
  microphone: boolean;
  /** Hears what the video stage shows, and whether tiles too small for the grid hold it there. */
  onViewChange?: (view: StageView) => void;
};

/**
 * The joined call's stage. While anyone shows a camera or a screen: everyone's tiles in a grid,
 * the shared screens each as wide as the stage over them, or speaker view, with one tile (someone
 * else's screen first) filling the stage, the others as faces and the own camera as an inset.
 * While nobody does: the voice stage.
 */
export function CallStage(props: CallStageProps) {
  const { room, participants, awaited, speakerView, microphone, onViewChange } = props;
  const { t } = useTranslation();
  const [stageRef, size] = useStageSize();
  const people = awaited ? [...participants, awaited] : participants;
  const video = hasVideo(people);
  const fit = size && fitTiles(people.length, size.width, size.height, TILE_GAP);
  const screens = sharedScreens(people);
  const tiny = !!fit && fit.size < SPEAKER_VIEW_MIN_TILE;
  const view = stageView(people, tiny, speakerView);
  const speaker = video && view.speaker;
  const held = video && view.held;
  useEffect(() => {
    onViewChange?.({ speaker, held });
  }, [speaker, held, onViewChange]);

  // The remote in focus stays there while nobody talks, rather than jumping back to the first.
  const lastFocus = useRef<string>();
  const focus = pickFocus(people, lastFocus.current);
  useEffect(() => {
    lastFocus.current = focus;
  }, [focus]);

  const participantsLabel = t('featureUi.calls.panel.participants');
  let body;
  if (!video) {
    body = <VoiceStage room={room} people={people} microphone={microphone} />;
  } else if (!speaker && screens.length > 0) {
    body = (
      <ul className={css.Screens} aria-label={participantsLabel}>
        {screens.map((participant) => (
          <ScreenTile key={screenKey(participant)} room={room} participant={participant} />
        ))}
        {people.map((participant) => (
          <CallTile key={participant.key} room={room} participant={participant} />
        ))}
      </ul>
    );
  } else if (!speaker) {
    const gridStyle: CSSProperties | undefined = fit && {
      gridTemplateColumns: `repeat(${fit.columns}, ${Math.floor(fit.tileWidth)}px)`,
      gridAutoRows: `${Math.floor(fit.tileHeight)}px`,
    };
    body = (
      <ul className={css.Grid} style={gridStyle} aria-label={participantsLabel}>
        {people.map((participant) => (
          <CallTile key={participant.key} room={room} participant={participant} />
        ))}
      </ul>
    );
  } else {
    const focused = people.find(
      (participant) => participant.key === focus || screenKey(participant) === focus
    );
    const screenInFocus = !!focused && screenKey(focused) === focus;
    const own = people.find((participant) => participant.local && participant.video);
    const inset = own && (screenInFocus || own !== focused) ? own : undefined;
    // One face per person, and none for whoever the tile in focus or the inset shows already.
    const shown = new Set([inset?.userId, screenInFocus ? undefined : focused?.userId]);
    const faces = byPerson(people).filter(({ userId }) => !shown.has(userId));
    // A row longer than the tile can hold ends with a count in place of its last faces.
    const shownFaces = faces.length > SPEAKER_FACES ? faces.slice(0, SPEAKER_FACES - 1) : faces;
    const facesFrom = STAGE_PADDING + (screenInFocus ? SCREEN_CONTROL_ROOM : 0);
    body = (
      <>
        <ul className={css.Speaker} aria-label={participantsLabel}>
          {focused &&
            (screenInFocus ? (
              <ScreenTile key={focus} room={room} participant={focused} />
            ) : (
              <CallTile key={focus} room={room} participant={focused} />
            ))}
          {shownFaces.map((participant, place) => (
            <SpeakerFace
              key={participant.userId}
              room={room}
              participant={participant}
              inlineEnd={facesFrom + place * SPEAKER_FACE_STEP}
            />
          ))}
          {shownFaces.length < faces.length && (
            <MoreFaces
              count={faces.length - shownFaces.length}
              inlineEnd={facesFrom + shownFaces.length * SPEAKER_FACE_STEP}
            />
          )}
        </ul>
        {inset && (
          <ul className={css.Inset} data-call-inset="">
            <CallTile room={room} participant={inset} />
          </ul>
        )}
      </>
    );
  }

  return (
    <div
      ref={stageRef}
      data-call-stage={video ? 'video' : 'voice'}
      data-speaker-view={speaker ? '' : undefined}
      className={css.Stage}
    >
      {body}
    </div>
  );
}
