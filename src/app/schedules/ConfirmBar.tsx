import type { Ref } from 'react';
import { Button, Text } from 'folds';
import * as css from './roomSchedules.css';

const CONFIRM_BTN = {
  type: 'button',
  size: '300',
  radii: '300',
  className: css.CancelBarButton,
} as const;

/** Inline destructive confirmation bar shared by scheduled task and room trigger rows. */
export function ConfirmBar({
  id,
  prompt,
  error,
  keepLabel,
  confirmLabel,
  busy = false,
  onKeep,
  onConfirm,
  keepRef,
  ref,
}: {
  id: string;
  prompt: string;
  error?: string;
  keepLabel: string;
  confirmLabel: string;
  busy?: boolean;
  onKeep: () => void;
  onConfirm: () => void;
  keepRef?: Ref<HTMLButtonElement>;
  ref?: Ref<HTMLDivElement>;
}) {
  const promptId = `${id}-q`;
  const disabled = busy || undefined;
  return (
    <div ref={ref} id={id} role="group" aria-labelledby={promptId} className={css.CancelBar}>
      <Text id={promptId} size="T200">
        {prompt}
      </Text>
      {error && (
        <Text size="T200" role="alert" className={css.CancelError}>
          {error}
        </Text>
      )}
      <div className={css.CancelBarActions}>
        <Button
          ref={keepRef}
          {...CONFIRM_BTN}
          variant="Secondary"
          fill="Soft"
          aria-describedby={promptId}
          aria-disabled={disabled}
          onClick={onKeep}
        >
          <Text size="T200">{keepLabel}</Text>
        </Button>
        <Button
          {...CONFIRM_BTN}
          variant="Critical"
          fill="Solid"
          aria-disabled={disabled}
          onClick={onConfirm}
        >
          <Text size="T200">{confirmLabel}</Text>
        </Button>
      </div>
    </div>
  );
}
