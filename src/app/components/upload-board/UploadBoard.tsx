import React, { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import classNames from 'classnames';
import { Badge, Box, Chip, Icon, Icons, Spinner, Text, as } from 'folds';
import { Header } from '../glass/GlassPrimitives';
import { type TUploadFamilyObserverAtom, type Upload, UploadStatus } from '../../state/upload';
import * as css from './UploadBoard.css';

type UploadBoardProps = {
  header: ReactNode;
  children?: ReactNode;
};

/** The panel of staged uploads above the composer: a header and, when open, the file cards. */
export function UploadBoard({ header, children }: UploadBoardProps) {
  return (
    <Box className={css.UploadBoardBase}>
      <Box className={css.UploadBoardContainer}>
        <Box className={css.UploadBoard} direction="Column">
          {header}
          {children}
        </Box>
      </Box>
    </Box>
  );
}

/** The file cards under the header, shown while the board is open. */
export const UploadBoardContent = as<'div'>((props, ref) => {
  const { as: List = 'div', className, ...rest } = props;
  return <List ref={ref} {...rest} className={classNames(css.UploadBoardContent, className)} />;









};

/**
 * The board's title row: how many files, how many are still uploading or failed, a toggle for
 * the card list and Remove All. Sending happens from the composer, so there is no Send here.
 */
export function UploadBoardHeader(props: UploadBoardHeaderProps) {
  const { open, onToggle, uploadFamilyObserverAtom, onCancel } = props;
  const uploads = useAtomValue(uploadFamilyObserverAtom);
  const { t } = useTranslation();
  const loading = uploads.filter((upload) => upload.status === UploadStatus.Loading).length;
  const failed = uploads.filter((upload) => upload.status === UploadStatus.Error).length;

  return (
    <Header size="400">
      <Box className={css.UploadBoardHeaderContent} grow="Yes" alignItems="Center">
        <Box
          as="button"
          type="button"
          grow="Yes"
          alignItems="Center"
          gap="200"
          onClick={onToggle}
          aria-expanded={open}
          style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
        >
          <Icon size="50" src={open ? Icons.ChevronTop : Icons.ChevronRight} />
          <Text as="span" size="H6">
            {`${uploads.length} ${t('sharedUi.uploadBoard.files')}`}
          </Text>
          {loading > 0 && <Spinner size="100" variant="Secondary" />}
          {failed > 0 && (
            <Badge
              variant="Critical"
              fill="Solid"
              radii="Pill"
              size="400"
              title={t('sharedUi.uploadBoard.uploadFailed')}
            >
              <Text as="span" size="L400">
                {failed}
              </Text>
            </Badge>
          )}
        </Box>
        <Chip
          type="button"
          variant="SurfaceVariant"
          radii="Pill"
          before={<Icon size="50" src={Icons.Cross} />}
          onClick={() => onCancel(uploads)}
        >
          <Text as="span" size="B300">
            {t('sharedUi.uploadBoard.removeAll')}
          </Text>
        </Chip>
      </Box>
    </Header>
  );
}
