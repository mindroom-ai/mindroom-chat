import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pluginSource = readFileSync(
  new URL('../../../../ios/App/App/MindRoomFileSavePlugin.swift', import.meta.url),
  'utf8'
);

describe('MindRoomFileSavePlugin iOS export contract', () => {
  it('moves the disposable staged file into the selected destination', () => {
    expect(pluginSource).toMatch(
      /UIDocumentPickerViewController\(\s*forExporting:\s*\[\s*session\.fileURL\s*\]\s*\)/
    );
    expect(pluginSource).not.toMatch(/asCopy:\s*true/);
  });
});
