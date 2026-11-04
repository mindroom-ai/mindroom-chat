import { HTMLAttributes, ReactNode, forwardRef } from 'react';
import classNames from 'classnames';
import { Box, Icon, IconButton, Icons, ProgressBar, Text, percent } from 'folds';
import { bytesToSize } from '../../utils/common';
import * as css from './UploadCard.css';

type UploadCardProps = HTMLAttributes<HTMLDivElement> & {
  before?: ReactNode;
  after?: ReactNode;
  /** Progress, error or other detail below the file row. */
  bottom?: ReactNode;
  outlined?: boolean;
  compact?: boolean;
};

type UploadCardRowProps = Pick<UploadCardProps, 'before' | 'after' | 'children'>;

/** The file row: something leading, the file's details taking the free width, then actions. */
function UploadCardRow({ before, after, children }: UploadCardRowProps) {
  return (
    <Box alignItems="Center" gap="200">
      {before}
      <Box grow="Yes" direction="Column" style={{ minWidth: 0 }}>
        {children}
      </Box>
      {after}
    </Box>
  );
}

/** A card for one file being uploaded. */
export const UploadCard = forwardRef<HTMLDivElement, UploadCardProps>(
  ({ before, after, bottom, outlined, compact, children, className, ...props }, ref) => (
    <Box
      direction="Column"
      className={classNames(css.UploadCard({ outlined, compact }), className)}
      {...props}
      ref={ref}
    >
      <UploadCardRow before={before} after={after}>
        {children}
      </UploadCardRow>
      {bottom}
    </Box>
  )
);

/** The progress line of an upload: a bar, the percentage, and the bytes sent of the total. */
export function UploadCardProgress({
  sentBytes,
  totalBytes,
}: {
  sentBytes: number;
  totalBytes: number;
}) {
  // A zero-byte file would otherwise divide by zero.
  const total = Math.max(totalBytes, 1);
  return (
    <Box direction="Column" gap="200">
      <ProgressBar variant="Secondary" size="300" min={0} max={total} value={sentBytes} />
      <Box alignItems="Center" justifyContent="SpaceBetween">
        <Text as="span" size="T200">
          {`${Math.round(percent(0, total, sentBytes))}%`}
        </Text>
        <Text as="span" size="T200" priority="300">
          {`${bytesToSize(sentBytes)} / ${bytesToSize(totalBytes)}`}
        </Text>
      </Box>
    </Box>
  );
}

/** An upload error line under the file row. */
export const UploadCardError = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ children, className, ...props }, ref) => (
    <Box className={classNames(css.UploadCardError, className)} role="alert" {...props} ref={ref}>
      <Icon size="50" src={Icons.Warning} />
      <Text as="span" size="T200">
        {children}
      </Text>
    </Box>
  )
);

type UploadCardCancelProps = { label: string; onClick: () => void };

/** The round "x" at the end of an upload card's file row. */
export function UploadCardCancel({ label, onClick }: UploadCardCancelProps) {
  return (
    <IconButton type="button" size="300" radii="Pill" aria-label={label} onClick={onClick}>
      <Icon src={Icons.Cross} size="50" />
    </IconButton>
  );
}
