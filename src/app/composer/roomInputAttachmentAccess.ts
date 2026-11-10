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
  enroll: (items: TUploadItem[]) => void;
  clearEnrollment: () => void;
  protectPasteItems: (items: TUploadItem[]) => () => void;
  subscribe: (listener: () => void) => () => void;
  /** Takes files off the staged list for a send that finishes alone; their uploads go on. */
  unstage: (roomId: string, files: TUploadContent[]) => void;
  /** Puts a send's unsent files back on the staged list, unless their thread view closed. */
  restage: (roomId: string, items: TUploadItem[]) => void;
  /** Calls `listener` on each change of these files' uploads, also after the composer unmounts. */
  watchUploads: (files: TUploadContent[], listener: () => void) => () => void;
};
