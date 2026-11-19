# Thread model change as one activity line: plan

Spec: `docs/baspowers/specs/2026-11-19-thread-model-activity-line-design.md`.
Each task is test first: write the failing test, see it fail for the stated reason, then the code.

## Backend (`mindroom-ai/mindroom`)

1. A typed `!model <key>` or `!model reset` that was applied replies with the picker's `io.mindroom.model_selection_result` (`commands/model_commands.py`, `commands/handler.py`). Tests: the exact result of a typed set and reset; none for a listing, an unknown model or a command outside a thread; the complete reply of a set and a reset, typed and from the picker, names no inherited model, label or provider ID.
2. `docs/architecture/matrix.md`: the typed result and the privacy rule.

## Client (this repository)

1. `models/modelProtocol.ts`: `splitModelReference`. Test: key, key and level, an empty level.
2. `messages/modelChanges.ts`: `planModelChanges`, `sameModelChangePlan`, `useModelChangePlan`. Tests: one per pairing condition of the spec, each keeping both rows when it fails; a second acknowledgement of one command; the picker's and the typed shape; the plan's identity while it draws the same.
3. `models/modelController.ts`: `watch`, a listener that asks for nothing; `models/useModelPicker.ts`: `useThreadModelCatalog`. Tests: watching sends no request and starts no retry, and hears a catalog a composer's discovery brought.
4. `messages/ModelChangeMarker.tsx` and `.css.ts`. Tests: set with a catalog name and level, set without a catalog, reset, the disclosure's ARIA and panel, the scope sentence for the viewer and for someone else.
5. Timeline: `timeline/message-rendering/types.ts`, `useTimelineMessageFeature.tsx` (the marker as a quiet row of its own), `roomTimelineRows.tsx` (the command's row hidden), `RoomTimeline.tsx` (the plan, the hidden ids, the turn folds). Test: `timeline/__tests__/RoomTimeline.modelChanges.test.ts`, the thread's rows with a trusted router, without one, and with a rejected result.
6. Copy in `i18n/locales/additions/en.json` and the sixteen overlays.
7. `docs/architecture.md`: the event format row.
8. `e2e/models/agent-model-change-line.spec.ts` against a real backend (`just agent-stack`, pointed at the backend change): the picker's change and a typed reset become lines, a refused command stays two messages, on a desktop and a phone viewport; `e2e/models/agent-models.spec.ts` accepts the line or the reply text, so it passes against either backend.

## Checks

`just check` and `npx vite build` for the client; the backend's targeted tests, full suite, pre-commit and Tach.
