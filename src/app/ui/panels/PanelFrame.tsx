import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, IconButton, Icons, Text } from 'folds';
import { IconTooltip } from '../IconTooltip';
import { ExpandIcon, ShrinkIcon } from './panelIcons';
import { usePanelFrame, type PanelFrame } from './panelFrameContext';
import * as css from './PanelFrame.css';

/** Fill and Fold icon buttons shared by the legacy open strip and the panel header controls. */
function FrameActionButtons({
  frame: { label, layout, setLayout, fillLabel, foldLabel },
  tooltipPosition,
}: {
  frame: PanelFrame;
  tooltipPosition: 'Right' | 'Bottom';
}) {
  const { t } = useTranslation();
  const filled = layout === 'filled';
  const fill = fillLabel ?? t('mindroomUi.sidePanel.fill', { label });
  const fold = foldLabel ?? t('mindroomUi.sidePanel.fold', { label });
  return (
    <>
      <IconTooltip label={fill} position={tooltipPosition}>
        {(triggerRef) => (
          <IconButton
            ref={triggerRef}
            size="300"
            radii="300"
            variant="Surface"
            fill="None"
            aria-label={fill}
            aria-pressed={filled}
            data-panel-fill-button=""
            onClick={() => setLayout(filled ? 'beside' : 'filled')}
          >
            <Icon size="200" src={filled ? ShrinkIcon : ExpandIcon} />
          </IconButton>
        )}
      </IconTooltip>
      <IconTooltip label={fold} position={tooltipPosition}>
        {(triggerRef) => (
          <IconButton
            ref={triggerRef}
            size="300"
            radii="300"
            variant="Surface"
            fill="None"
            aria-label={fold}
            onClick={() => setLayout('folded')}
          >
            <Icon size="200" src={Icons.ChevronRight} data-directional />
          </IconButton>
        )}
      </IconTooltip>
    </>
  );
}

/**
 * The frame's edge strip: folded, the vertical tab at the room's end edge that brings the panel
 * back beside the conversation. Open, renders nothing by default (Fill and Fold live in the
 * panel's header controls), or the 40 px Fill/Fold strip when `openStrip` is set for legacy
 * `title: 'own'` plugins that do not declare `frameControls: 'own'`.
 */
export function PanelFrameStrip({
  frame,
  openStrip = false,
}: {
  frame: PanelFrame;
  openStrip?: boolean;
}) {
  const { t } = useTranslation();
  if (frame.layout === 'folded') {
    return (
      <button
        type="button"
        className={css.Tab}
        aria-label={t('mindroomUi.sidePanel.unfold', { label: frame.label })}
        onClick={() => frame.setLayout('beside')}
      >
        <Icon size="200" src={Icons.ChevronLeft} data-directional />
        <Text as="span" size="L400" className={css.TabLabel}>
          {frame.label}
        </Text>
      </button>
    );
  }
  if (!openStrip) return null;

  return (
    <div className={css.Strip}>
      <FrameActionButtons frame={frame} tooltipPosition="Right" />
    </div>
  );
}

export type PanelHeaderControlsProps = {
  children?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  showFrame?: boolean;
};

/**
 * Flat, borderless header controls at the end of a side panel's header: optional panel-specific
 * controls, a hairline divider when present, Fill and Fold from the enclosing PanelFrame, and
 * Close.
 */
export function PanelHeaderControls({
  children,
  onClose,
  closeLabel,
  showFrame = true,
}: PanelHeaderControlsProps) {
  const frame = usePanelFrame();
  const activeFrame = showFrame && frame && frame.layout !== 'folded' ? frame : undefined;
  if (children === undefined && !activeFrame && !onClose) return null;

  return (
    <div className={css.ControlPill}>
      {children !== undefined && (
        <>
          <span className={css.ControlExtras}>{children}</span>
          <span className={css.ControlSeparator} aria-hidden="true" />
        </>
      )}
      {(activeFrame || onClose) && (
        <span className={css.ControlCore}>
          {activeFrame && <FrameActionButtons frame={activeFrame} tooltipPosition="Bottom" />}
          {onClose && (
            <IconButton
              size="300"
              radii="300"
              variant="Surface"
              fill="None"
              aria-label={closeLabel}
              onClick={onClose}
            >
              <Icon size="200" src={Icons.Cross} />
            </IconButton>
          )}
        </span>
      )}
    </div>
  );
}
