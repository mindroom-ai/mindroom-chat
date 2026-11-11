import type { TUploadItem, Upload } from '../matrix/state/upload';
import type { TUploadContent } from '../matrix/matrix';

export type AttachmentSnapshot = {
  staged: TUploadItem[];
  enrolled: TUploadItem[];
  uploads: Upload[];
};

export type RoomInputAttachmentAccess = {
  /** Without a room, returns the active composer; explicit rooms include all staged drafts. */
  snapshot: (roomId?: string) => AttachmentSnapshot;
  append: (roomId: string, items: TUploadItem[]) => void;
  remove: (roomId: string, files: TUploadContent[]) => void;
  /** Takes files off the board without cancelling their uploads: another composer took them. */
  release: (roomId: string, files: TUploadContent[]) => void;
  enroll: (items: TUploadItem[]) => void;
  /** Releases the files a send session claimed with `enroll`. */
  clearEnrollment: (files: TUploadContent[]) => void;
  protectPasteItems: (items: TUploadItem[]) => () => void;
  subscribe: (listener: () => void) => () => void;
};
