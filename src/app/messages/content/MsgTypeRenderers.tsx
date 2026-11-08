import { CSSProperties, ReactNode } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { Box, Icon, Icons, Text, color, config, toRem } from 'folds';
import {
  MessageBadEncryptedContent,
  MessageNotDecryptedContent,
  MessageEditedContent,
  MessageUnsupportedContent,
} from './FallbackContent';
import { BrokenContent } from './BrokenContent';
import { VoiceAudioContent } from './VoiceAudioContent';
import { MessageTextBody } from '../layout/layout';
import { isJumboEmojiBody } from './jumboEmoji';
import { getBodyUrls } from './bodyUrls';
import * as fileCss from './FileRow.css';
import { useGlassHighlight } from '../../ui/glass/liquid/useLiquidGlass';
import { revealDirectionControls, textDirection } from '../../ui/directional';
import {
  IAudioInfo,
  IEncryptedFile,
  IFileInfo,
  IImageInfo,
  IMatrixAudioDetails,
  IVideoInfo,
  MATRIX_AUDIO_DETAILS_PROPERTY_NAME,
  MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME,
  MATRIX_VOICE_MESSAGE_PROPERTY_NAME,
  MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME,
} from '../../matrix/types/common';
import type { EventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import { MEDIA_MAX_SIZE } from '../../event-store/timeline/timelineRowTypes';
import { trimReplyFromBody } from '../../matrix/room';
import { bytesToSize } from '../../lib/common';
import {
  FALLBACK_MIMETYPE,
  getBlobSafeMimeType,
  getFileNameExt,
  getMimeTypeBase,
} from '../../lib/mimeTypes';
import { isRecord } from '../../lib/isRecord';

type MessageContent = Record<string, unknown>;

export type RenderBodyProps = { body: string; customBody?: string };
type RenderBody = (props: RenderBodyProps) => ReactNode;

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const readEncryptedFile = (content: MessageContent): IEncryptedFile | undefined => {
  const { file } = content;
  return isRecord(file) && typeof file.url === 'string' ? (file as IEncryptedFile) : undefined;
};

/** The media URL (plain or encrypted) and the decryption info of an attachment event. */
const readMediaSource = (
  content: MessageContent
): { url: string; encInfo?: EncryptedAttachmentInfo } | undefined => {
  const encryptedFile = readEncryptedFile(content);
  if (encryptedFile)
    return { url: encryptedFile.url, encInfo: encryptedFile as EncryptedAttachmentInfo };
  const url = readString(content.url);
  return url ? { url } : undefined;
};

const readInfo = <T extends object>(content: MessageContent): T =>
  (isRecord(content.info) ? content.info : {}) as T;

const readMimeType = (info: { mimetype?: unknown }): string =>
  typeof info.mimetype === 'string' && info.mimetype ? info.mimetype : FALLBACK_MIMETYPE;

/** Since Matrix 1.10 a `filename` beside a different `body` makes the body a caption. */
const readFileName = (content: MessageContent): string | undefined =>
  readString(content.filename) ?? readString(content.body);

type TextMessageProps = {
  edited?: boolean;
  content: MessageContent;
  renderBody: RenderBody;
  renderStateSuffix?: () => ReactNode;
  renderAfterBody?: ReactNode;
  renderUrlsPreview?: (urls: string[]) => ReactNode;
  style?: CSSProperties;
};

function TextMessage({
  edited,
  content,
  renderBody,
  renderStateSuffix,
  renderAfterBody,
  renderUrlsPreview,
  style,
  prefix,
  notice,
}: TextMessageProps & { prefix?: ReactNode; notice?: boolean }) {
  const { body } = content;
  if (typeof body !== 'string') return <BrokenContent />;
  const trimmedBody = trimReplyFromBody(body);
  const customBody =
    content.format === 'org.matrix.custom.html' && typeof content.formatted_body === 'string'
      ? content.formatted_body
      : undefined;
  const urls = renderUrlsPreview ? getBodyUrls(trimmedBody) : [];
  // A plain body keeps its line breaks. An HTML body lays out by its markup: the newlines between
  // its paragraphs, list items and tables would otherwise show as blank lines.
  const whiteSpace = customBody ? 'normal' : 'pre-wrap';
  // A message of only emoji shows them large; an emote keeps them at the size of its sender name.
  const jumboEmoji = prefix === undefined && isJumboEmojiBody(trimmedBody, customBody);
  const direction = textDirection(trimmedBody);

  return (
    <>
      {/* The body reads in the direction of its plain text, so an English message keeps its
          punctuation at the end in a right-to-left interface, and an Arabic one in a
          left-to-right one. The interface's labels inside it, such as an agent's tool calls,
          keep the interface's direction (index.css), and a short body sits at its own side
          (layout.css.ts). A body reads at P400 opacity and a notice at P300, as in
          thread-light.png. */}
      <MessageTextBody
        priority={notice ? '300' : '400'}
        jumboEmoji={jumboEmoji}
        dir={direction ?? 'auto'}
        data-body-direction={direction}
        style={{ whiteSpace, overflowWrap: 'anywhere', ...style }}
      >
        {prefix}
        {renderBody({ body: trimmedBody, customBody })}
        {renderStateSuffix ? renderStateSuffix() : edited && <MessageEditedContent />}
      </MessageTextBody>
      {renderAfterBody}
      {renderUrlsPreview && urls.length > 0 && renderUrlsPreview(urls)}
    </>
  );
}

/**
 * A text message, or a notice (`m.notice`), which reads at a lower opacity. Both are one
 * component: an agent reply streams as a notice and ends as text, and keeps the state inside it,
 * such as an open tool-call list, when it does.
 */
export function MText(props: TextMessageProps) {
  return <TextMessage {...props} notice={props.content.msgtype === 'm.notice'} />;
}

export const MNotice = MText;

/** `/me` messages read as "* Name does something". */
export function MEmote({ displayName, ...props }: TextMessageProps & { displayName: string }) {
  return <TextMessage {...props} prefix={<b>{`* ${displayName} `}</b>} />;
}

export function MBadEncrypted() {
  return (
    <Text as="div" size="T400">
      <MessageBadEncryptedContent />
    </Text>
  );
}

export function MNotDecrypted() {
  return (
    <Text as="div" size="T400">
      <MessageNotDecryptedContent />
    </Text>
  );
}

export function UnsupportedContent() {
  return (
    <Text as="div" size="T400">
      <MessageUnsupportedContent />
    </Text>
  );
}

export type RenderImageContentArgs = {
  body: string;
  info: IImageInfo;
  mimeType: string;
  url: string;
  encInfo?: EncryptedAttachmentInfo;
};

/**
 * Box for a picture or video that keeps the media's aspect ratio inside the size limits. When the
 * message is narrower than that (phones), the box narrows and its height follows the ratio.
 */
const mediaBoxStyle = (info: { w?: number; h?: number }): CSSProperties => {
  const width = typeof info.w === 'number' && info.w > 0 ? info.w : undefined;
  const height = typeof info.h === 'number' && info.h > 0 ? info.h : undefined;
  const sized = width !== undefined && height !== undefined;
  const scale = sized
    ? Math.min(1, MEDIA_MAX_SIZE.width / width, MEDIA_MAX_SIZE.height / height)
    : 1;
  return {
    width: width ? toRem(Math.round(width * scale)) : toRem(MEDIA_MAX_SIZE.width),
    ...(sized
      ? { aspectRatio: `${Math.round(width * scale)} / ${Math.round(height * scale)}` }
      : { height: toRem(MEDIA_MAX_SIZE.height * 0.75) }),
    maxWidth: '100%',
    overflow: 'hidden',
    borderRadius: toRem(12),
    position: 'relative',
  };
};

/**
 * A hairline around an attachment that sits on a surface of the same color (the pinned
 * messages menu). An outline paints over the media, so images keep the edge too.
 */
const outlineStyle = (outlined: boolean | undefined, radius: string): CSSProperties | undefined =>
  outlined
    ? {
        outline: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
        outlineOffset: `calc(-1 * ${config.borderWidth.B300})`,
        borderRadius: radius,
      }
    : undefined;

type MImageProps = {
  content: MessageContent;
  renderAsFile: () => ReactNode;
  renderImageContent: (args: RenderImageContentArgs) => ReactNode;
  outlined?: boolean;
};

/** An image, or a file row for image types a browser should not render (SVG). */
export function MImage({ content, renderAsFile, renderImageContent, outlined }: MImageProps) {
  const source = readMediaSource(content);
  if (!source) return <BrokenContent />;
  const info = readInfo<IImageInfo>(content);
  const mimeType = readMimeType(info);
  if (
    !getMimeTypeBase(mimeType).startsWith('image/') ||
    getBlobSafeMimeType(mimeType) === FALLBACK_MIMETYPE
  ) {
    return <>{renderAsFile()}</>;
  }
  return (
    <Box style={{ ...mediaBoxStyle(info), ...outlineStyle(outlined, toRem(12)) }}>
      {renderImageContent({
        body: readFileName(content) ?? '',
        info,
        mimeType,
        url: source.url,
        encInfo: source.encInfo,
      })}
    </Box>
  );
}

type RenderVideoContentArgs = {
  body: string;
  info: IVideoInfo;
  mimeType: string;
  url: string;
  encInfo?: EncryptedAttachmentInfo;
};

type MVideoProps = {
  content: MessageContent;
  renderAsFile: () => ReactNode;
  renderVideoContent: (args: RenderVideoContentArgs) => ReactNode;
  outlined?: boolean;
};

/** A video, or a file row for types the browser should not play from a blob. */
export function MVideo({ content, outlined, renderAsFile, renderVideoContent }: MVideoProps) {
  const { t } = useTranslation();
  const source = readMediaSource(content);
  if (!source) return <BrokenContent />;
  const info = readInfo<IVideoInfo>(content);
  const mimeType = readMimeType(info);
  if (getBlobSafeMimeType(mimeType) === FALLBACK_MIMETYPE) return <>{renderAsFile()}</>;
  const fileName =
    readFileName(content) ?? t('mindroomUi.message-search.searchResultPreview.video');
  return (
    <Box
      style={{ ...mediaBoxStyle(info), ...outlineStyle(outlined, toRem(12)) }}
      title={revealDirectionControls(fileName)}
    >
      {renderVideoContent({
        body: fileName,
        info,
        mimeType,
        url: source.url,
        encInfo: source.encInfo,
      })}
    </Box>
  );
}

const readWaveform = (content: MessageContent): number[] | undefined => {
  const details =
    content[MATRIX_AUDIO_DETAILS_PROPERTY_NAME] ??
    content[MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME];
  if (!isRecord(details)) return undefined;
  const { waveform } = details as IMatrixAudioDetails;
  return Array.isArray(waveform) && waveform.every((point) => typeof point === 'number')
    ? waveform
    : undefined;
};

const isVoiceMessageContent = (content: MessageContent): boolean =>
  content[MATRIX_VOICE_MESSAGE_PROPERTY_NAME] !== undefined ||
  content[MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME] !== undefined;

type MAudioProps = {
  content: MessageContent;
  renderAsFile: () => ReactNode;
  owner?: EventAttachmentOwner;
  outlined?: boolean;
};

/** Voice messages and audio files share the voice player; unplayable types become a file row. */
export function MAudio({ content, renderAsFile, owner, outlined }: MAudioProps) {
  const { t } = useTranslation();
  const source = readMediaSource(content);
  if (!source) return <BrokenContent />;
  const info = readInfo<IAudioInfo>(content);
  const mimeType = readMimeType(info);
  if (getBlobSafeMimeType(mimeType) === FALLBACK_MIMETYPE) return <>{renderAsFile()}</>;
  const voice = isVoiceMessageContent(content);
  const player = (
    <VoiceAudioContent
      mimeType={mimeType}
      url={source.url}
      info={info}
      encInfo={source.encInfo}
      owner={owner}
      filename={readFileName(content) ?? t('mindroomUi.message-search.searchResultPreview.audio')}
      waveform={readWaveform(content)}
      isVoiceMessage={voice}
      label={
        voice ? t('sharedUi.msgTypeRenderers.voiceMessage') : t('sharedUi.msgTypeRenderers.audio')
      }
    />
  );
  // The player capsule has 16 px corners (VoiceAudioContent.css).
  return outlined ? <div style={outlineStyle(true, toRem(16))}>{player}</div> : player;
}

type RenderFileContentArgs = {
  body: string;
  mimeType: string;
  url: string;
  encInfo?: EncryptedAttachmentInfo;
};

const useFileTypeLabel = () => {
  const { t } = useTranslation();
  return (mimeType: string): string => {
    const base = getMimeTypeBase(mimeType);
    if (base === 'application/pdf') return t('sharedUi.msgTypeRenderers.pdfDocument');
    if (base.startsWith('text/')) return t('sharedUi.msgTypeRenderers.textFile');
    if (base.startsWith('image/')) return t('mindroomUi.message-search.searchResultPreview.image');
    if (base.startsWith('video/')) return t('mindroomUi.message-search.searchResultPreview.video');
    if (base.startsWith('audio/')) return t('mindroomUi.message-search.searchResultPreview.audio');
    return t('sharedUi.msgTypeRenderers.file');
  };
};

type MFileProps = {
  content: MessageContent;
  renderFileContent: (args: RenderFileContentArgs) => ReactNode;
  outlined?: boolean;
};

/** A file as one row: type tile, name, type and size, then the caller's actions. */
export function MFile(props: MFileProps) {
  const { content, renderFileContent, outlined } = props;
  const { t } = useTranslation();
  const cardRef = useGlassHighlight<HTMLDivElement>();
  const typeLabel = useFileTypeLabel();
  const source = readMediaSource(content);
  if (!source) return <BrokenContent />;
  const info = readInfo<IFileInfo>(content);
  const mimeType = readMimeType(info);
  const fileName = readFileName(content) ?? t('sharedUi.msgTypeRenderers.unnamedFile');
  // The name shows its direction controls, so `report<U+202E>fdp.exe` cannot pass for a PDF.
  const shownName = revealDirectionControls(fileName);
  const extension = getFileNameExt(fileName).slice(0, 4).toUpperCase();
  const detail =
    typeof info.size === 'number'
      ? t('sharedUi.msgTypeRenderers.fileMeta', {
          type: typeLabel(mimeType),
          size: bytesToSize(info.size),
        })
      : typeLabel(mimeType);

  return (
    <div ref={cardRef} className={classNames(fileCss.FileRow, outlined && fileCss.FileRowOutlined)}>
      <div className={fileCss.FileTile} aria-hidden="true">
        {extension || <Icon size="100" src={Icons.File} />}
      </div>
      <div className={fileCss.FileInfo}>
        <Text as="span" size="T300" className={fileCss.FileName} truncate title={shownName}>
          {shownName}
        </Text>
        <Text as="span" size="T200" priority="300" truncate>
          {detail}
        </Text>
      </div>
      {renderFileContent({ body: fileName, mimeType, url: source.url, encInfo: source.encInfo })}
    </div>
  );
}

/** Parses `geo:lat,lon` URIs. */
const parseGeoUri = (geoUri: string): { latitude: string; longitude: string } | undefined => {
  const [, latitude, longitude] = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(geoUri) ?? [];
  return latitude && longitude ? { latitude, longitude } : undefined;
};

export function MLocation({ content }: { content: MessageContent }) {
  const { t } = useTranslation();
  const geoUri = readString(content.geo_uri);
  const location = geoUri ? parseGeoUri(geoUri) : undefined;
  if (!location) return <BrokenContent />;
  const { latitude, longitude } = location;
  const body = readString(content.body);
  return (
    <Box direction="Column" alignItems="Start" gap="100">
      {/* The description shows its direction controls, as message text does. */}
      {body && <Text size="T400">{revealDirectionControls(body)}</Text>}
      <Text
        size="T300"
        as="a"
        href={`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`}
        target="_blank"
        rel="noreferrer noopener"
      >
        {t('sharedUi.msgTypeRenderers.openLocation')}
      </Text>
    </Box>
  );
}

type MStickerProps = {
  content: MessageContent;
  renderImageContent: (args: RenderImageContentArgs) => ReactNode;
};

export function MSticker({ content, renderImageContent }: MStickerProps) {
  const source = readMediaSource(content);
  if (!source) return <BrokenContent />;
  const info = readInfo<IImageInfo>(content);
  const size = (value: number | undefined) =>
    typeof value === 'number' && value > 0 ? Math.min(value, 256) : 256;
  return (
    <Box style={{ width: toRem(size(info.w)), height: toRem(size(info.h)), maxWidth: '100%' }}>
      {renderImageContent({
        body: readString(content.body) ?? '',
        info,
        mimeType: readMimeType(info),
        url: source.url,
        encInfo: source.encInfo,
      })}
    </Box>
  );
}
