# iOS Exported File Access Design

## Context

MindRoom Chat saves attachments and on-device diagnostic logs through the shared `MindRoomFileSavePlugin` bridge on native iOS.

The bridge stages bytes in an app-private temporary file, presents `UIDocumentPickerViewController` in export-as-copy mode, and deletes the staging directory when the picker reports success.

Files saved to both On My iPhone and iCloud Drive appear in Files but fail to open with a permission error.

This cross-provider behavior and the shared failure path identify the export-as-copy handoff from immediately deleted private storage as the root cause.

## Goals

- Save attachments and diagnostic JSON as readable files in local and cloud Files destinations.
- Preserve the direct native destination picker.
- Preserve bounded chunk transfer from JavaScript to Swift.
- Preserve cancellation, overlap protection, reload recovery, filename sanitization, and failure cleanup.
- Preserve the existing web and Android `file-saver` behavior.

## Non-goals

- Do not add a custom folder browser.
- Do not replace the picker with a share sheet.
- Do not change attachment download, decryption, or diagnostic payload generation.
- Do not retain private staging files after a completed or cancelled picker flow.

## Considered Approaches

### Move the staged export

The document picker can move a local document into the selected destination instead of copying it.

The staged file is intentionally disposable, so move semantics match the ownership transfer.

This is the recommended approach because the destination receives the actual file while the app retains only an empty private staging directory to remove.

### Select a directory and copy manually

The app could request a security-scoped directory URL and copy the staged file with `NSFileCoordinator`.

This adds security-scope lifecycle, file coordination, collision handling, and provider-specific failure paths that the document picker already owns.

### Present a share sheet

`UIActivityViewController` could offer Save to Files alongside other activities.

This adds an extra user choice and makes the direct save destination flow less predictable.

## Design

`MindRoomFileSavePlugin.presentSave` will create the export picker with move semantics by using `UIDocumentPickerViewController(forExporting:)`.

The system will transfer the staged file into the selected local or cloud destination before invoking the success delegate.

The success path will resolve the existing JavaScript promise and remove only the app-private session directory.

Because the staged file has moved, directory cleanup cannot remove or invalidate the delivered file.

Cancellation and presentation failure will continue to remove the private staged file and directory.

The JavaScript bridge API and all attachment and diagnostic callers remain unchanged.

## Error Handling

Chunk decoding, staging writes, invalid sessions, overlapping prompts, unavailable presentation, and cancellation retain their current behavior.

A failed native operation rejects the existing promise and allows the JavaScript caller to expose its current retry state.

Successful saves continue to resolve `true`, while user cancellation continues to resolve `false`.

## Validation

A native source contract regression will assert that the plugin uses move export semantics and does not reintroduce export-as-copy mode.

The regression will be run before implementation to prove it fails for the current code.

Focused native-save and attachment-download tests will verify that the shared JavaScript behavior remains unchanged.

Validation will include the full Vitest suite, typecheck, production build, relevant lint and formatting checks, Capacitor iOS sync, and an unsigned iOS Simulator build.

A physical-device smoke test should save and open one diagnostic JSON file and one attachment from both On My iPhone and iCloud Drive.
