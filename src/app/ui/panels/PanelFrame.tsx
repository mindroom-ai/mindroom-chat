import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, IconButton, Icons, Text } from 'folds';
import { IconTooltip } from '../IconTooltip';
import { ExpandIcon, ShrinkIcon } from './panelIcons';
import { usePanelFrame, type PanelFrame } from './panelFrameContext';
import * as css from './PanelFrame.css';

/**
 * The frame's edge strip: folded, the vertical tab at the room's end edge that brings the panel
 * back beside the conversation. Open, renders nothing by default (Fill and Fold live in the
 * panel's header control pill), or the 40 px Fill/Fold strip when `openStrip` is set for legacy
 * `title: 'own'` plugins that do not declare `frameControls: 'own'`.
 */
export function PanelFrameStrip({
  frame: { label, layout, setLayout },
  openStrip = false,
}: {
  frame: PanelFrame;
  openStrip?: boolean;
}) {
  const { t } = useTranslation();
  if (layout === 'folded') {
    return (
      <button
        type="button"
        className={css.Tab}
        aria-label={t('mindroomUi.sidePanel.unfold', { label })}
        onClick={() => setLayout('beside')}
      >
        <Icon size="200" src={Icons.ChevronLeft} data-directional />
        <Text as="span" size="L400" className={css.TabLabel}>
          {label}
        </Text>
      </button>
    );
  }
  if (!openStrip) return null;

  const filled = layout === 'filled';
  const fill = t('mindroomUi.sidePanel.fill', { label });
  const fold = t('mindroomUi.sidePanel.fold', { label });
  return (
    <div className={css.Strip}>
      <IconTooltip label={fill} position="Left">
        {(triggerRef) => (
          <IconButton
            ref={triggerRef}
            size="300"
            radii="300"
            variant="Surface"
            fill="None"
            aria-label={fill}
            aria-pressed={filled}
            onClick={() => setLayout(filled ? 'beside' : 'filled')}
          >
            <Icon size="200" src={filled ? ShrinkIcon : ExpandIcon} />
          </IconButton>
        )}
      </IconTooltip>
      <IconTooltip label={fold} position="Left">
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
 * Floating control pill at the end of a side panel's header: optional panel-specific controls, a
 * divider when present, Fill and Fold from the enclosing PanelFrame, and Close.
 */
export function PanelHeaderControls({
  children,
  onClose,
  closeLabel,
  showFrame = true,
}: PanelHeaderControlsProps) {
  const { t } = useTranslation();
  const frame = usePanelFrame();
  const hasFrame = showFrame && frame !== undefined && frame.layout !== 'folded';
  if (children === undefined && !hasFrame && !onClose) return null;

  const filled = frame?.layout === 'filled';
  const fill = hasFrame ? t('mindroomUi.sidePanel.fill', { label: frame.label }) : undefined;
  const fold = hasFrame ? t('mindroomUi.sidePanel.fold', { label: frame.label }) : undefined;

  return (
    <div className={css.ControlPill}>
      {children !== undefined && (
        <>
          <span className={css.ControlExtras}>{children}</span>
          <span className={css.ControlSeparator} aria-hidden="true" />
        </>
      )}
      {(hasFrame || onClose) && (
        <span className={css.ControlCore}>
          {hasFrame && fill && fold && (
            <>
              <IconTooltip label={fill} position="Bottom">
                {(triggerRef) => (
                  <IconButton
                    ref={triggerRef}
                    size="300"
                    radii="300"
                    variant="SurfaceVariant"
                    fill="None"
                    aria-label={fill}
                    aria-pressed={filled}
                    onClick={() => frame.setLayout(filled ? 'beside' : 'filled')}
                  >
                    <Icon size="200" src={filled ? ShrinkIcon : ExpandIcon} />
                  </IconButton>
                )}
              </IconTooltip>
              <IconTooltip label={fold} position="Bottom">
                {(triggerRef) => (
                  <IconButton
                    ref={triggerRef}
                    size="300"
                    radii="300"
                    variant="SurfaceVariant"
                    fill="None"
                    aria-label={fold}
                    onClick={() => frame.setLayout('folded')}
                  >
                    <Icon size="200" src={Icons.ChevronRight} data-directional />
                  </IconButton>
                )}
              </IconTooltip>
            </>
          )}
          {onClose && (
            <IconButton
              size="300"
              radii="300"
              variant="SurfaceVariant"
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
