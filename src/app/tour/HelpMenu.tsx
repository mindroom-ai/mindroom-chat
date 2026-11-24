import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type FocusEvent,
  type MouseEvent,
} from 'react';
import classNames from 'classnames';
import FocusTrap from 'focus-trap-react';
import { Button, Icon, IconButton, Icons, Line, Text, type IconSrc } from 'folds';
import { IconKeyboard } from '@tabler/icons-react';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { stopPropagation } from '../lib/keyboard';
import { shortcutHelpOpenAtom } from '../navigation/shortcutHelpState';
import { tourAtom, type TourLevel } from '../navigation/tourState';
import { ShortcutHint, shortcutAttributes } from '../shortcuts/ShortcutKeys';
import { PopOut } from '../ui/directional';
import { Menu, MenuItem } from '../ui/glass/GlassPrimitives';
import { useMenuBehaviour } from '../ui/glass/menuBehaviour';
import { useContextualTip } from './useContextualTip';
import * as css from './HelpMenu.css';

type GuideStep =
  | 'conversation'
  | 'resolve'
  | 'filters'
  | 'snooze'
  | 'pinAndTag'
  | 'views'
  | 'activity';

const GUIDES: readonly (readonly [step: GuideStep, level: TourLevel, icon: IconSrc])[] = [
  ['conversation', 'quick', Icons.Thread],
  ['resolve', 'full', Icons.Check],
  ['filters', 'full', Icons.Filter],
  ['snooze', 'full', Icons.Clock],
  ['pinAndTag', 'full', Icons.Pin],
  ['views', 'full', Icons.Category],
  ['activity', 'full', Icons.Bell],
];

const VIEWPORT_CAP =
  'calc(100dvh - 1rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))';

type HelpMenuProps = {
  /** The trigger button this popover opens from; clicking it again toggles closed. */
  anchor: HTMLElement;
  /** Opens below a phone top bar instead of beside the desktop icon rail. */
  below?: boolean;
  onClose: () => void;
};

/**
 * Anchored Help & guides popover showing any active contextual suggestion, direct jumps into
 * animated interface tour steps, the Full tour, and Keyboard shortcuts.
 */
export function HelpMenu({ anchor, below = false, onClose }: HelpMenuProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const guidesHeadingId = useId();
  const setTour = useSetAtom(tourAtom);
  const setShortcutHelpOpen = useSetAtom(shortcutHelpOpenAtom);
  const { tip, dismissTip, openTipTour } = useContextualTip();
  const entries = useMenuBehaviour<HTMLDivElement>('menu', undefined, undefined);

  const measure = useCallback(
    () => ({
      anchorRect: anchor.getBoundingClientRect(),
      viewportHeight: document.documentElement.clientHeight || window.innerHeight,
    }),
    [anchor]
  );
  const [{ anchorRect, viewportHeight }, setMeasured] = useState(measure);
  useLayoutEffect(() => {
    const onResize = () => setMeasured(measure());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure]);

  const maxBlockSize = useMemo(() => {
    if (viewportHeight <= 0) return VIEWPORT_CAP;
    const available = below
      ? Math.max(viewportHeight - anchorRect.bottom, anchorRect.top) - 16
      : Math.max(anchorRect.bottom, viewportHeight - anchorRect.top) - 8;
    return available > 0 ? `min(${Math.floor(available)}px, ${VIEWPORT_CAP})` : VIEWPORT_CAP;
  }, [anchorRect, viewportHeight, below]);

  const showFocusedItem = (event: FocusEvent<HTMLElement>) =>
    event.target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  const onAnchor = (target: EventTarget | null) =>
    target instanceof Node && anchor.contains(target);
  const closeThen = (action: () => void) => () => {
    onClose();
    action();
  };

  const menu = (
    <FocusTrap
      focusTrapOptions={{
        initialFocus: false,
        returnFocusOnDeactivate: false,
        onDeactivate: onClose,
        escapeDeactivates: stopPropagation,
        clickOutsideDeactivates: (event) => !onAnchor(event.target),
        allowOutsideClick: (event) => onAnchor(event.target),
      }}
    >
      <Menu role="none" className={css.MenuSurface} style={{ maxBlockSize }}>
        <div
          role="menu"
          tabIndex={-1}
          aria-labelledby={titleId}
          ref={entries.ref}
          onKeyDown={entries.onKeyDown}
          className={css.MenuBody}
          data-help-menu=""
        >
          <div className={css.Header}>
            <Text as="span" id={titleId} size="T300" className={css.Strong}>
              {t('tour.help.title')}
            </Text>
            {tip ? (
              <Text as="span" size="L400" className={css.TipPill}>
                {t('tour.help.oneTip')}
              </Text>
            ) : (
              <Text as="span" size="T200" priority="300">
                {t('tour.help.subtitle')}
              </Text>
            )}
          </div>
          <Line variant="Surface" size="300" role="separator" className={css.Shrink} />
          <div className={css.ScrollBody} onFocus={showFocusedItem}>
            {tip && (
              <>
                <div className={css.Suggested} data-help-menu-tip={tip.id}>
                  <div className={css.SuggestedHead}>
                    <Text as="span" size="O400" className={css.Eyebrow}>
                      {t('tour.help.suggested')}
                    </Text>
                    <IconButton
                      type="button"
                      role="menuitem"
                      className={css.DismissTip}
                      variant="Primary"
                      fill="None"
                      size="300"
                      radii="300"
                      aria-label={t('tour.help.dismissTip')}
                      onClick={(event: MouseEvent<HTMLButtonElement>) => {
                        event.currentTarget.closest<HTMLElement>('[role="menu"]')?.focus();
                        dismissTip(tip.id);
                      }}
                    >
                      <Icon src={Icons.Cross} size="50" />
                    </IconButton>
                  </div>
                  <Text as="div" size="T300" className={css.Strong}>
                    {t('tour.tips.resolve.title')}
                  </Text>
                  <Text as="div" size="T200" priority="300">
                    {t(
                      tip.scope === 'room'
                        ? 'tour.tips.resolve.roomSummary'
                        : 'tour.tips.resolve.allSummary',
                      { count: tip.openCount }
                    )}
                  </Text>
                  <div className={css.SuggestedActions}>
                    <Button
                      type="button"
                      role="menuitem"
                      size="300"
                      radii="300"
                      variant="Primary"
                      fill="Solid"
                      onClick={closeThen(() => openTipTour(tip))}
                    >
                      <Text as="span" size="B300">
                        {t('tour.help.showHow')}
                      </Text>
                    </Button>
                  </div>
                </div>
                <Line variant="Surface" size="300" role="separator" />
              </>
            )}
            <div role="group" aria-labelledby={guidesHeadingId} className={css.Guides}>
              <Text
                as="span"
                id={guidesHeadingId}
                size="O400"
                priority="300"
                className={css.GuidesHeading}
              >
                {t('tour.help.guidesHeading')}
              </Text>
              {GUIDES.map(([step, level, icon]) => (
                <MenuItem
                  key={step}
                  role="menuitem"
                  size="300"
                  radii="300"
                  variant="Surface"
                  className={css.GuideRow}
                  before={<Icon size="100" src={icon} className={css.Shrink} />}
                  onClick={closeThen(() => setTour({ level, initialStep: step }))}
                >
                  <Text as="span" size="T300" truncate className={css.StartLabel}>
                    {t(`tour.help.guides.${step}`)}
                  </Text>
                </MenuItem>
              ))}
            </div>
          </div>
          <Line variant="Surface" size="300" role="separator" className={css.Shrink} />
          <div className={css.SplitFooter}>
            <button
              type="button"
              role="menuitem"
              className={css.FooterButton}
              onClick={closeThen(() => setTour({ level: 'full' }))}
            >
              <Icon size="100" src={Icons.Explore} className={css.Shrink} />
              <Text as="span" size="B300" truncate className={css.StartLabel}>
                {t('tour.help.fullTour')}
              </Text>
            </button>
            <button
              type="button"
              role="menuitem"
              className={classNames(css.FooterButton, css.FooterEnd)}
              {...shortcutAttributes('help')}
              onClick={closeThen(() => setShortcutHelpOpen(true))}
            >
              <IconKeyboard size={16} stroke={1.8} className={css.Shrink} aria-hidden="true" />
              <Text as="span" size="B300" truncate className={css.StartLabel}>
                {t('tour.help.shortcuts')}
              </Text>
              <ShortcutHint id="help" />
            </button>
          </div>
        </div>
      </Menu>
    </FocusTrap>
  );

  return (
    <PopOut
      anchor={anchorRect}
      position={below ? 'Bottom' : 'Right'}
      align="End"
      offset={8}
      content={menu}
    />
  );
}
