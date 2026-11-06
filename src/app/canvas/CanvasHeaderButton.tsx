import { MouseEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import { Box, Icon, IconButton, Icons, RectCords, Scroll, Text, Tooltip, config } from 'folds';
import { PopOut, TooltipProvider } from '../ui/directional';
import { Menu, MenuItem } from '../ui/glass/GlassPrimitives';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import type { CanvasListEntry } from './canvasIndexStore';

type CanvasMenuProps = {
  /** Where the menu opens; it is closed while undefined. */
  anchor?: RectCords;
  /** The conversation's canvases, in the order the menu lists them. */
  canvases: CanvasListEntry[];
  /** The canvas the panel shows, which may belong to another conversation. */
  openCanvasId?: string;
  /** A canvas was chosen: the shown one closes its panel, another opens it. */
  onChoose: (canvasId: string) => void;
  requestClose: () => void;
};

/** A menu of the conversation's canvases by title, with the update time to tell same-named ones apart. */
export function CanvasMenu({
  anchor,
  canvases,
  openCanvasId,
  onChoose,
  requestClose,
}: CanvasMenuProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const time = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
  // Escape or a click elsewhere dismisses the list; focus stays where the click put it.
  const dismiss = () => {
    requestClose();
    return true;
  };
  const trap = {
    initialFocus: false as const,
    returnFocusOnDeactivate: false,
    escapeDeactivates: dismiss,
    clickOutsideDeactivates: dismiss,
  };
  return (
    <PopOut
      anchor={anchor}
      position="Bottom"
      align="End"
      offset={4}
      content={
        <FocusTrap focusTrapOptions={trap}>
          <Menu
            style={{
              display: 'flex',
              flexDirection: 'column',
              maxHeight: `calc(100vh - ${config.space.S700} * 2)`,
              maxWidth: 'min(22rem, calc(100vw - 2rem))',
            }}
          >
            <Box
              shrink="No"
              style={{
                padding: `${config.space.S300} ${config.space.S300} ${config.space.S100}`,
              }}
            >
              <Text size="L400">{t('mindroomUi.threads.mindroomRoomViewHeader.canvases')}</Text>
            </Box>
            <Scroll size="300" hideTrack visibility="Hover">
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                {canvases.map((canvas) => {
                  const current = canvas.canvasId === openCanvasId;
                  return (
                    <MenuItem
                      key={canvas.canvasId}
                      size="400"
                      radii="300"
                      aria-current={current ? 'true' : undefined}
                      variant={current ? 'Primary' : 'Surface'}
                      fill={current ? 'Soft' : 'None'}
                      onClick={() => onChoose(canvas.canvasId)}
                    >
                      <Box direction="Column" style={{ minWidth: 0 }}>
                        <Text size="T300" truncate>
                          {canvas.title}
                        </Text>
                        <Text size="T200" priority="300" truncate>
                          {time.format(canvas.updatedTs)}
                        </Text>
                      </Box>
                    </MenuItem>
                  );
                })}
              </Box>
            </Scroll>
          </Menu>
        </FocusTrap>
      }
    />
  );
}

type CanvasHeaderButtonProps = {
  /** The conversation's canvases, in the order the menu lists them. */
  canvases: CanvasListEntry[];
  /** The canvas the panel shows, which may belong to another conversation. */
  openCanvasId?: string;
  onOpen: (canvasId: string) => void;
  onClose: () => void;
};

/**
 * The room header's canvas control. One canvas toggles its panel; several open a menu of their
 * titles, with the update time to tell same-named canvases apart.
 */
export function CanvasHeaderButton({
  canvases,
  openCanvasId,
  onOpen,
  onClose,
}: CanvasHeaderButtonProps) {
  const { t } = useTranslation();
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const several = canvases.length > 1;

  // A menu needs a choice; once one canvas is left it closes for good.
  useEffect(() => {
    if (!several) setMenuAnchor(undefined);
  }, [several]);

  if (canvases.length === 0) return null;

  const openHere = canvases.some((canvas) => canvas.canvasId === openCanvasId);
  let label = t('mindroomUi.threads.mindroomRoomViewHeader.canvases');
  if (!several) {
    label = openHere
      ? t('mindroomUi.threads.mindroomRoomViewHeader.hideCanvas')
      : t('mindroomUi.threads.mindroomRoomViewHeader.showCanvas');
  }

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (several) {
      setMenuAnchor(event.currentTarget.getBoundingClientRect());
      return;
    }
    const [only] = canvases;
    if (openHere) onClose();
    else if (only) onOpen(only.canvasId);
  };

  const choose = (canvasId: string) => {
    setMenuAnchor(undefined);
    if (canvasId === openCanvasId) onClose();
    else onOpen(canvasId);
  };

  const tooltip = (
    <Tooltip>
      <Text size="T200">{label}</Text>
    </Tooltip>
  );

  return (
    <>
      <TooltipProvider position="Bottom" offset={4} tooltip={tooltip}>
        {(anchorRef) => (
          <IconButton
            ref={anchorRef}
            size="400"
            radii="300"
            variant={openHere ? 'Primary' : 'Surface'}
            fill={openHere ? 'Soft' : 'None'}
            aria-label={label}
            aria-pressed={openHere}
            aria-haspopup={several ? 'menu' : undefined}
            aria-expanded={several ? !!menuAnchor : undefined}
            onClick={handleClick}
          >
            <Icon size="400" src={Icons.Category} filled={openHere} />
          </IconButton>
        )}
      </TooltipProvider>
      <CanvasMenu
        anchor={menuAnchor}
        canvases={canvases}
        openCanvasId={openCanvasId}
        onChoose={choose}
        requestClose={() => setMenuAnchor(undefined)}
      />
    </>
  );
}
