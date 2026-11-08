import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent, ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom, useAtomValue, useStore } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { Text } from 'folds';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { getSenderName } from '../../matrix/room';
import { textDirection } from '../../ui/directional';
import type { TranscriptLine } from '../transcription/api';
import { GAP_KEYS, LiveTranscriptBody } from '../transcription/LiveTranscriptBody';
import { callTranscriptionAtom } from '../transcription/transcriptionState';
import {
  dismissTranscriptPanel,
  windowTranscriptFocusAtom,
} from '../transcription/transcriptPanel';
import { useLiveTranscript } from '../transcription/useLiveTranscript';
import { useCallWindowSize } from './callWindowFrame';
import { getCallWindowSplitAtom, getCallWindowTranscriptAtom } from './callWindowState';
import { MAX_TRANSCRIPT_SPLIT, MIN_TRANSCRIPT_SPLIT, transcriptLayout } from './transcriptLayout';
import { splitFromPointer, stepSplit, type TranscriptLayout } from './transcriptLayout';
import * as css from './WindowTranscript.css';

/** The side panel's pace; the window never reads the call itself (see `Transcript`). */
const READ_MS = 2_000;

const percent = (share: number): number => Math.round(share * 100);

const rightToLeft = (element: Element | null): boolean =>
  !!element && getComputedStyle(element).direction === 'rtl';

/**
 * Where the live transcript sits in the window now: by the window's size, while the account shows
 * it there and MindRoom has answered for the call (it may be unreachable since, which the
 * transcript says). None otherwise.
 */
const useTranscriptLayout = (room: Room): TranscriptLayout | undefined => {
  const userId = useMatrixClient().getSafeUserId();
  const shown = useAtomValue(getCallWindowTranscriptAtom(userId));
  const transcription = useAtomValue(callTranscriptionAtom);
  const size = useCallWindowSize();
  const answered = transcription?.roomId === room.roomId && transcription.status !== 'joining';
  return shown && answered && size ? transcriptLayout(size) : undefined;
};

type DividerProps = {
  layout: 'stacked' | 'side';
  /** The stage's share of the window body, as the divider shows it now. */
  share: number;
  /** The box the stage and the transcript share, which the pointer's place is measured in. */
  boxRef: RefObject<HTMLDivElement>;
  /** A drag's share while it goes; undefined once it ended. */
  onDrag: (share: number | undefined) => void;
  /** Keeps a share: a released drag's, or a key step's. */
  onSet: (share: number) => void;
};

/**
 * The line between the stage and the transcript: a pointer drags it, and while it has the focus
 * the arrows move it (the window splitter pattern), its value the stage's percentage.
 */
function Divider({ layout, share, boxRef, onDrag, onSet }: DividerProps) {
  const { t } = useTranslation();
  const drag = useRef<{ pointerId: number; share?: number }>();
  // A drag the divider goes away during (the window turned short, the transcript hidden) ends
  // with it, unsaved; its pointer capture went with the element.
  useEffect(() => () => onDrag(undefined), [onDrag]);
  // The focus it had then goes to the window's handle, as Minimize's and Expand's does, rather
  // than to the page. Before it leaves the page, while it still has the focus to tell.
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    return () => {
      if (!element || element !== document.activeElement) return;
      // One floating window shows at a time, and the divider is only ever in it.
      document.querySelector<HTMLElement>('[data-call-window-handle]')?.focus();
    };
  }, []);
  const stage = percent(share);
  const follow = (event: PointerEvent<HTMLElement>) => {
    const box = boxRef.current;
    if (!box || drag.current?.pointerId !== event.pointerId) return;
    const { clientX, clientY } = event;
    const bounds = box.getBoundingClientRect();
    drag.current.share = splitFromPointer(layout, bounds, clientX, clientY, rightToLeft(box));
    onDrag(drag.current.share);
  };
  // A lost pointer ends the drag where it stands, as the window's own drags do.
  const end = (event: PointerEvent<HTMLElement>) => {
    const ended = drag.current;
    if (ended?.pointerId !== event.pointerId) return;
    drag.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onDrag(undefined);
    if (ended.share !== undefined) onSet(ended.share);
  };
  // A focusable separator is the window splitter pattern, a widget.
  /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
  return (
    <div
      ref={ref}
      className={css.Divider}
      role="separator"
      tabIndex={0}
      aria-label={t('featureUi.calls.window.resizeTranscript')}
      aria-orientation={layout === 'side' ? 'vertical' : 'horizontal'}
      aria-valuenow={stage}
      aria-valuetext={t('featureUi.calls.window.transcriptSplit', {
        stage,
        transcript: 100 - stage,
      })}
      aria-valuemin={percent(MIN_TRANSCRIPT_SPLIT)}
      aria-valuemax={percent(MAX_TRANSCRIPT_SPLIT)}
      data-call-window-divider=""
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary || drag.current) return;
        // The press is the divider's: it selects no text and moves no window.
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId };
      }}
      onPointerMove={follow}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={(event) => {
        // With Alt, Ctrl or Meta the keys are the browser's and the system's (Alt+Left goes back).
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const next = stepSplit(share, event.key, layout, rightToLeft(boxRef.current));
        if (next === undefined) return;
        event.preventDefault();
        onSet(next);
      }}
    />
  );
  /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
}

/**
 * The latest line over the bottom of the stage, two lines at most. The log announces each line,
 * so this shows its last one again to the eye only.
 */
function Subtitle({ room, line }: { room: Room; line: TranscriptLine | undefined }) {
  const { t } = useTranslation();
  if (!line) return null;
  return (
    <Text as="p" size="T300" className={css.Subtitle} aria-hidden data-call-window-subtitle="">
      {line.kind === 'gap' ? (
        t(GAP_KEYS[line.reason])
      ) : (
        <>
          <span className={css.SubtitleName}>{getSenderName(room, line.userId)}</span>{' '}
          <span dir={textDirection(line.text) ?? 'auto'}>{line.text}</span>
        </>
      )}
    </Text>
  );
}

type TranscriptProps = {
  room: Room;
  layout: TranscriptLayout;
  grow: number | undefined;
  paneRef: RefObject<HTMLDivElement>;
};

/**
 * The transcript beside or under the stage, at `grow` of the body. Too short a window shows only
 * its latest line as a subtitle, and the transcript stays out of sight for screen readers, whose
 * log announces new lines as it does in every other layout.
 */
function Transcript({ room, layout, grow, paneRef }: TranscriptProps) {
  const { t } = useTranslation();
  // It is this device's call: its transcriber reads it, and the window only shows what it read.
  const view = useLiveTranscript(room, READ_MS, false);
  const lines = view.live?.lines ?? [];
  const subtitle = layout === 'subtitle';
  return (
    <>
      <div
        ref={paneRef}
        className={subtitle ? css.PaneUnseen : css.Pane}
        style={grow === undefined ? undefined : { flexGrow: grow }}
        role="region"
        aria-label={t('featureUi.calls.transcription.liveTranscript')}
        tabIndex={-1}
        data-call-window-transcript=""
      >
        <LiveTranscriptBody room={room} view={view} className={css.PaneBody} members={false} />
      </div>
      {subtitle && <Subtitle room={room} line={lines[lines.length - 1]} />}
    </>
  );
}

/**
 * The joined call's stage (`children`) in the floating window, and the live transcript with it
 * while the account shows it there: under the stage, beside it at the end side, or its latest line
 * over the stage, by the window's size. A divider between them sets the stage's share, kept per
 * account.
 */
export function WindowTranscript({ room, children }: { room: Room; children: ReactNode }) {
  const userId = useMatrixClient().getSafeUserId();
  const layout = useTranscriptLayout(room);
  // One transcript at a time: once it shows here (also when it was left on and MindRoom answers
  // for a call just joined), the room's side transcript closes, so each line is read out once.
  const store = useStore();
  const { roomId } = room;
  const shows = layout !== undefined;
  useEffect(() => {
    if (shows) dismissTranscriptPanel(store, roomId);
  }, [roomId, shows, store]);
  // The row's Transcript, outside the window, hands its focus to the transcript it opened here; one
  // that shows on its own (the controls' switch, left on for a call just joined) takes none. The
  // subtitle's transcript is out of sight, so there the focus goes to the window's handle.
  const [focusRequest, setFocusRequest] = useAtom(windowTranscriptFocusAtom);
  const paneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusRequest || !layout) return;
    setFocusRequest(undefined);
    const focused = document.activeElement;
    if (focused && focused !== document.body && focused !== focusRequest.from) return;
    const handle = document.querySelector<HTMLElement>('[data-call-window-handle]');
    (layout === 'subtitle' ? handle : paneRef.current)?.focus();
  }, [focusRequest, layout, setFocusRequest]);
  const [split, setSplit] = useAtom(getCallWindowSplitAtom(userId));
  const [dragged, setDragged] = useState<number>();
  const boxRef = useRef<HTMLDivElement>(null);
  // The stage and the transcript share the body in whole percent; a subtitle shares nothing.
  const shared = layout === 'subtitle' ? undefined : layout;
  const stagePercent = percent(dragged ?? split);
  return (
    <div ref={boxRef} className={css.Split} data-call-transcript-layout={layout}>
      <div className={css.StagePane} style={shared && { flexGrow: stagePercent }}>
        {children}
      </div>
      {shared && (
        <Divider
          layout={shared}
          share={dragged ?? split}
          boxRef={boxRef}
          onDrag={setDragged}
          onSet={setSplit}
        />
      )}
      {layout && (
        <Transcript
          room={room}
          layout={layout}
          grow={shared && 100 - stagePercent}
          paneRef={paneRef}
        />
      )}
    </div>
  );
}
