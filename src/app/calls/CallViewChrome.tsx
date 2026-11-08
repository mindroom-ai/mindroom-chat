import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom, useSetAtom } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { Icon, IconButton, Icons, Text, type IconSrc } from 'folds';
import classNames from 'classnames';
import { useLocation } from 'react-router-dom';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { getViewedPlace } from '../navigation/viewedPlace';
import { IconTooltip } from '../ui/IconTooltip';
import { ExpandIcon } from '../ui/panels/panelIcons';
import type { CallParticipant } from './RoomCall';
import { callPanelRoomAtom, type CallOrigin } from './callStore';
import { CallMemberAvatar, useCallMemberProfile } from './CallTile';
import { byPerson } from './stageLayout';
import { useCallWindowFrame } from './window/callWindowFrame';
import { focusHandOffAtom, useCallWindowMode } from './window/callWindowState';
import { DockIcon, FloatIcon } from './window/windowIcons';
import * as css from './CallPanel.css';

// What surrounds the call view (CallPanel.tsx) in the room's side panel and in the floating
// window: the title bar with Dock, Float, Minimize and Close, and the window's line when minimized.

/** How many of the others the minimized window's line shows. */
const BAR_FACES = 3;

type TitleButtonProps = {
  label: string;
  icon: IconSrc;
  onClick: () => void;
  variant?: 'Surface' | 'Critical';
  /** The icon points to an end of the line, so it mirrors in right-to-left languages. */
  directional?: boolean;
  className?: string;
  /** The window's line sits low on the screen by default, so its names show above it. */
  above?: boolean;
  /** A switch: whether it is on. */
  pressed?: boolean;
  /** Shown but not working; it keeps its focus and name, so its state is still read. */
  held?: boolean;
  size?: '300' | '400';
};

/** A small icon button of the title bar or the window's line, named in a tooltip. */
export function TitleButton(props: TitleButtonProps) {
  const { label, icon, onClick, variant = 'Surface', directional, className, above } = props;
  const { pressed, held, size = '300' } = props;
  return (
    <IconTooltip label={label} position={above ? 'Top' : 'Bottom'}>
      {(tipAnchor) => (
        <IconButton
          ref={tipAnchor}
          className={className}
          size={size}
          radii="300"
          variant={variant}
          aria-label={label}
          aria-pressed={pressed}
          aria-disabled={held || undefined}
          onClick={held ? undefined : onClick}
        >
          <Icon size="200" src={icon} data-directional={directional || undefined} />
        </IconButton>
      )}
    </IconTooltip>
  );
}

/**
 * Dock, in the floating window: the call view moves into the side panel of the room it belongs to
 * (`home`). A person elsewhere goes there (to an agent call's thread) so the docked panel is seen;
 * one in that room (and thread) already stays where they are.
 */
function DockButton({ home }: { home: CallOrigin }) {
  const { t } = useTranslation();
  const [, setMode] = useCallWindowMode();
  const mx = useMatrixClient();
  const location = useLocation();
  const setPanelRoom = useSetAtom(callPanelRoomAtom);
  const setFocusHandOff = useSetAtom(focusHandOffAtom);
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const dock = () => {
    setFocusHandOff({ to: 'panel', from: document.activeElement });
    setMode('docked');
    // The docked panel shows in the room whose call view is open.
    setPanelRoom(home.roomId);
    const here = getViewedPlace(mx, location);
    if (here.roomId === home.roomId && (!home.threadId || here.threadId === home.threadId)) return;
    if (home.threadId) navigateRoomThread(home.roomId, home.threadId);
    else navigateRoom(home.roomId);
  };
  const label = t('featureUi.calls.window.dock');
  return <TitleButton label={label} icon={DockIcon} directional onClick={dock} />;
}

/** Float, in the docked panel: the call view goes back to the floating window, where it was. */
function FloatButton() {
  const { t } = useTranslation();
  const [, setMode] = useCallWindowMode();
  const setFocusHandOff = useSetAtom(focusHandOffAtom);
  const float = () => {
    setFocusHandOff({ to: 'window', from: document.activeElement });
    setMode('floating');
  };
  const label = t('featureUi.calls.window.float');
  return <TitleButton label={label} icon={FloatIcon} directional onClick={float} />;
}

/**
 * Back to the conversation an agent call started from. On phones the call view covers that
 * conversation, so it closes there (the call goes on, and the rail's call button brings it back).
 */
export function ConversationButton({
  origin,
  onClose,
}: {
  origin: CallOrigin;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const open = () => {
    if (origin.threadId) navigateRoomThread(origin.roomId, origin.threadId);
    else navigateRoom(origin.roomId);
    if (phone) onClose();
  };
  return (
    <TitleButton
      label={t('featureUi.calls.window.openConversation')}
      icon={Icons.Message}
      onClick={open}
    />
  );
}

/**
 * What the window's one-line bar shows: the faces before the title, its own status in place of the
 * title bar's, and the controls between the title and Expand. `closes`: the controls close the
 * call view themselves (Close of a finished call, which takes the window with the call), so the
 * bar has no Close of its own.
 */
export type BarContent = {
  faces?: ReactNode;
  status?: string;
  controls?: ReactNode;
  closes?: boolean;
};

/**
 * The panel's frame: a title with the call's status under it, the body, and a control bar. In the
 * floating window its title bar moves the window, and minimized the window shows one line: the
 * others' faces, the title and status, `bar.controls`, Expand and Close.
 */
type CallViewChromeProps = {
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  /** The room (and thread) the call view docks into. */
  home: CallOrigin;
  /** The title bar's buttons before the window's own: speaker view, the conversation. */
  actions?: ReactNode;
  bar?: BarContent;
};

export function CallViewChrome(props: CallViewChromeProps) {
  const { title, subtitle, footer, children, onClose, home, actions, bar } = props;
  const { t } = useTranslation();
  const frame = useCallWindowFrame();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  // A call not joined yet shows only its title, Expand and Close in the window's line.
  const status = frame?.bar ? bar && (bar.status ?? subtitle) : subtitle;
  // The docked panel's title takes the focus Dock hands it (the window's handle takes Float's).
  const titleRef = useRef<HTMLHeadingElement>(null);
  const heading = (
    <div className={css.HeaderTitle}>
      <Text
        as="h2"
        id={frame?.titleId}
        size="H4"
        truncate
        ref={titleRef}
        tabIndex={frame ? undefined : -1}
      >
        {title}
      </Text>
      {status && (
        <Text size="T200" priority="300" truncate aria-live="polite">
          {status}
        </Text>
      )}
    </div>
  );
  // The docked panel is a landmark named by the call; in the floating window, which is one and
  // takes its name from the title, the frame is none.
  const Shell = frame ? 'div' : 'section';

  // Minimize and Expand go with the line they are on; the focus they had moves to the handle that
  // takes their place rather than to the page.
  const handleRef = useRef<HTMLDivElement>(null);
  const inBar = !!frame?.bar;
  const wasBar = useRef(inBar);
  useEffect(() => {
    if (wasBar.current === inBar) return;
    wasBar.current = inBar;
    if (document.activeElement && document.activeElement !== document.body) return;
    handleRef.current?.focus();
  }, [inBar]);

  // The view Dock, Float or the rail's call button asked for takes the focus their button had,
  // unless something else took it meanwhile: when it mounts, or at once when it shows already.
  const [handOff, setHandOff] = useAtom(focusHandOffAtom);
  const place = frame ? 'window' : 'panel';
  useEffect(() => {
    if (handOff?.to !== place) return;
    setHandOff(undefined);
    const focused = document.activeElement;
    if (focused && focused !== document.body && focused !== handOff.from) return;
    (place === 'window' ? handleRef : titleRef).current?.focus();
  }, [handOff, place, setHandOff]);

  return (
    <Shell
      className={classNames(css.Panel, frame && css.InWindow)}
      aria-label={frame ? undefined : title}
      data-testid="call-panel"
    >
      {frame?.bar ? (
        <div ref={handleRef} className={css.Bar} {...frame.handleProps}>
          {bar?.faces}
          {heading}
          {bar?.controls}
          <TitleButton
            label={t('featureUi.calls.window.expand')}
            icon={ExpandIcon}
            onClick={frame.expand}
            above
          />
          {!bar?.closes && (
            <TitleButton
              label={t('featureUi.calls.panel.close')}
              icon={Icons.Cross}
              onClick={onClose}
              above
            />
          )}
        </div>
      ) : (
        <>
          <header
            ref={handleRef}
            className={classNames(css.Header, frame && css.WindowHeader)}
            {...frame?.handleProps}
          >
            {heading}
            <div className={css.HeaderButtons}>
              {actions}
              {/* Phones show the call view in the room's side panel only. */}
              {!phone && (frame ? <DockButton home={home} /> : <FloatButton />)}
              {frame && (
                <TitleButton
                  label={t('featureUi.calls.window.minimize')}
                  icon={Icons.Minus}
                  onClick={frame.minimize}
                />
              )}
              <TitleButton
                label={t('featureUi.calls.panel.close')}
                icon={Icons.Cross}
                onClick={onClose}
              />
            </div>
          </header>
          <div className={css.Body}>{children}</div>
          {footer}
        </>
      )}
    </Shell>
  );
}

/** One of the others in the window's line, ringed while they talk. */
function BarFace({ room, userId, speaking }: { room: Room; userId: string; speaking: boolean }) {
  const { name } = useCallMemberProfile(room, userId);
  return (
    <li className={css.BarFace} data-speaking={speaking} aria-label={name}>
      <CallMemberAvatar room={room} userId={userId} size="200" />
    </li>
  );
}

/**
 * The first few others in the call, in the window's line: one face per person whatever their
 * devices (this person's other devices are not others).
 */
export function BarFaces({ room, people }: { room: Room; people: CallParticipant[] }) {
  const { t } = useTranslation();
  const faces = byPerson(people)
    .filter(({ local }) => !local)
    .slice(0, BAR_FACES);
  if (faces.length === 0) return null;
  return (
    <ul className={css.BarFaces} aria-label={t('featureUi.calls.panel.participants')}>
      {faces.map(({ userId, speaking }) => (
        <BarFace key={userId} room={room} userId={userId} speaking={speaking} />
      ))}
    </ul>
  );
}
