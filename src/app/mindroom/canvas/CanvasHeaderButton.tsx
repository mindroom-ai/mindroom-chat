import React, { MouseEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import {
  Box,
  Icon,
  IconButton,
  Icons,
  PopOut,
  RectCords,
  Scroll,
  Text,
  Tooltip,
  TooltipProvider,
  config,
} from 'folds';
import { Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import type { CanvasListEntry } from './canvasIndexStore';

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
  const language = useAppLanguageCode();
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
    if (openHere) onClose();
    else onOpen(canvases[0].canvasId);
  };

  const choose = (canvasId: string) => {
    setMenuAnchor(undefined);
    if (canvasId === openCanvasId) onClose();
    else onOpen(canvasId);
  };

  const time = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
  const closeMenu = () => {
    setMenuAnchor(undefined);
    return true;
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
            size="300"
            radii="300"
            variant={openHere ? 'Primary' : 'Surface'}
            fill={openHere ? 'Soft' : 'None'}
            aria-label={label}
            aria-pressed={openHere}
            aria-haspopup={several ? 'menu' : undefined}
            aria-expanded={several ? !!menuAnchor : undefined}
            onClick={handleClick}
          >
            <Icon size="200" src={Icons.Category} filled={openHere} />
          </IconButton>
        )}
      </TooltipProvider>
      <PopOut
        offset={4}
        align="End"
        position="Bottom"
        anchor={menuAnchor}
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              escapeDeactivates: closeMenu,
              clickOutsideDeactivates: closeMenu,
            }}
          >
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
                        onClick={() => choose(canvas.canvasId)}
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
    </>
  );
}
