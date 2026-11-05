import { describe, expect, it } from 'vitest';
import { LongTextSource } from '../matrix/protocol/longText';
import { getLongTextDownloadName } from './content/longTextDownload';

const source = (overrides: Partial<LongTextSource> = {}): LongTextSource => ({
  previewContent: {
    msgtype: 'm.file',
    body: 'preview',
    url: 'mxc://mindroom/media-id',
  },
  mxcUri: 'mxc://mindroom/media-id',
  isV2ContentJson: true,
  ...overrides,
});

describe('getLongTextDownloadName', () => {
  it('uses a sanitized Matrix file name when one is available', () => {
    expect(
      getLongTextDownloadName(
        source({
          previewContent: {
            msgtype: 'm.file',
            body: 'preview',
            url: 'mxc://mindroom/media-id',
            info: {
              name: 'bad/<name>  with   spaces.json',
            },
          },
        })
      )
    ).toBe('bad__name_ with spaces.json');
  });

  it('falls back to the mxc media id and expected sidecar extension', () => {
    expect(
      getLongTextDownloadName(
        source({
          mxcUri: 'mxc://mindroom/overflow-body',
          isV2ContentJson: false,
        })
      )
    ).toBe('mindroom-long-text-overflow-body.txt');
  });
});
