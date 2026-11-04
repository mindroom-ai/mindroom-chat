import { ReactNode, forwardRef, useId, useLayoutEffect, useRef } from 'react';
import { Box, Text } from 'folds';

type SettingTileProps = {
  title?: ReactNode;
  description?: ReactNode;
  /** Leading icon or avatar. */
  before?: ReactNode;
  /** Trailing control: a switch, button, or select. */
  after?: ReactNode;
  /** Extra content under the description. */
  children?: ReactNode;
  /** Lets settings search scroll to this tile. */
  focusId?: string;
};

/** A leading or trailing slot that keeps its content at natural size; empty slots vanish. */
const FixedSlot = forwardRef<HTMLDivElement, { children?: ReactNode }>(function FixedSlot(
  { children },
  ref
) {
  return children ? (
    <Box shrink="No" ref={ref}>
      {children}
    </Box>
  ) : null;
});

/** Switches and checkboxes show no text of their own; the tile's title is their name. */
const UNNAMED_TOGGLE = [
  '[role="switch"]:not([aria-label]):not([aria-labelledby])',
  'input[type="checkbox"]:not([aria-label]):not([aria-labelledby])',
].join(', ');

/**
 * Names a trailing switch after the tile's title and describes it with the description, unless
 * the caller named it already.
 */
const useNamedToggle = (titleId: string | undefined, descriptionId: string | undefined) => {
  const afterRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const toggle = afterRef.current?.querySelector?.(UNNAMED_TOGGLE);
    if (!toggle || !titleId) return;
    toggle.setAttribute('aria-labelledby', titleId);
    if (descriptionId && !toggle.hasAttribute('aria-describedby')) {
      toggle.setAttribute('aria-describedby', descriptionId);
    }
  });
  return afterRef;
};

/** One setting: title and description with an optional control beside them. */
export function SettingTile(props: SettingTileProps) {
  const { focusId, before, after, title, description, children } = props;
  const id = useId();
  const titleId = title ? `${id}-title` : undefined;
  const descriptionId = description ? `${id}-description` : undefined;
  const afterRef = useNamedToggle(titleId, descriptionId);
  const descriptionText = description ? (
    <Text id={descriptionId} priority="300" size="T200">
      {description}
    </Text>
  ) : null;

  return (
    <Box id={focusId} gap="300" alignItems="Center">
      <FixedSlot>{before}</FixedSlot>
      <Box style={{ minWidth: 0 }} gap="100" direction="Column" grow="Yes">
        {title ? (
          <Text id={titleId} size="T300">
            {title}
          </Text>
        ) : null}
        {descriptionText}
        {children}
      </Box>
      <FixedSlot ref={afterRef}>{after}</FixedSlot>
    </Box>
  );
}
