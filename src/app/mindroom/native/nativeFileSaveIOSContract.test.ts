import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pluginSource = readFileSync(
  new URL('../../../../ios/App/App/MindRoomFileSavePlugin.swift', import.meta.url),
  'utf8'
);
const presentSaveSource = pluginSource.slice(
  pluginSource.indexOf('@objc func presentSave'),
  pluginSource.indexOf('@objc func abortSave')
);
const presentationCompletionSource = presentSaveSource.slice(
  presentSaveSource.indexOf('viewController.present(picker')
);

describe('MindRoomFileSavePlugin iOS export contract', () => {
  it('exports a copy of the disposable staged file into the selected destination', () => {
    expect(pluginSource).toMatch(
      /UIDocumentPickerViewController\(\s*forExporting:\s*\[\s*session\.fileURL\s*\],\s*asCopy:\s*true\s*\)/
    );
    expect(pluginSource).not.toMatch(/asCopy:\s*false/);
  });

  it('waits for picker presentation to finish before testing its window', () => {
    expect(presentationCompletionSource).toMatch(
      /viewController\.present\(picker,\s*animated:\s*true\)\s*\{\s*\[weak self,\s*weak picker\]\s*in[\s\S]*?picker\.viewIfLoaded\?\.window/
    );
    expect(presentationCompletionSource).not.toContain('DispatchQueue.main.async');
  });
});
