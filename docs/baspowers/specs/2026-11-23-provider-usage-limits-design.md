# Provider Usage Limits & Per-Account Token Usage — Design Spec (MindRoom Chat: Hybrid A + B)

**Date:** 2026-11-23
**Status:** Approved by Bas (Hybrid A + B: inline in Model Picker + Left Rail Usage page)

## Goal

Display per-account provider usage limits (remaining % bars with T3-style pace ticks and reset countdowns) and 7-day token/cost usage across linked providers (Claude Code, Codex, OpenRouter, pay-as-you-go API keys) in MindRoom Chat:
1. **Option A — Inline in Model Picker:** Compact remaining-capacity meter on each provider group header when all visible models in that provider group map to a single billing account, plus a footer button `"All usage & limits →"` that closes the picker and opens `/usage/`.
2. **Option B — Left Rail "Usage" tab & `/usage/` page:** Dedicated rail button (progressive reveal once the backend responds with usage data, matching `CanvasesTab`; subtle amber dot only when any linked window has `<15%` remaining; toggleable in Sidebar settings via `railButtons.ts`) opening a responsive T3-style **Usage & Limits** page (`Limits` | `Tokens & Cost` tabs, pace-tick bars, reset countdowns via `Intl`, 7-day stacked daily chart, per-account token/spend table, and Refresh button).

## Constraints & Rules

- **Encrypted to-device RPC only:** Uses the same `signedModelDevices` + `crypto.encryptToDeviceMessages` transport as `src/app/models/modelTransport.ts` (`io.mindroom.usage.request` / `io.mindroom.usage.response`). Never calls localhost HTTP APIs.
- **Cold `/usage/` discovery without router:** Discovers signed `mindroom_*` runtime devices across joined rooms (preferring the active/last-known runtime room if available, else scanning joined rooms with `mindroom_*` members) and sends `{version: 1, request_id, room_id, force_refresh}` so the room's elected responder answers. Keep responses separated by runtime ID; never merge runtimes.
- **Silent hiding for non-admins / older backends:** If no runtime answers, the rail tab stays hidden, Model Picker shows no quota bars or footer link, and direct navigation to `/usage/` shows a quiet empty/unavailable state with Retry.
- **Exact account-to-group mapping:** In `ModelPicker.tsx`, show a provider group's inline quota bar ONLY when every model in that visible group maps via `account.model_keys` to the same single `ProviderAccountUsage` record. If a provider group spans multiple accounts or has no matching account, omit the inline bar (the full `/usage/` page still lists every account).
- **No fabricated limits:** Uncapped OpenRouter keys and PAYG API-key accounts (`windows: []`) show `"No subscription limit"` / `"Pay-as-you-go"` (or 7d spend), never `"100% left"`.
- **Localization & accessibility:** All user-facing strings in `src/app/i18n/locales/en/translation.json` (and regenerated/checked per i18n tests); durations/resets formatted with `Intl`; `:focus-visible` outlines; contrast across light & dark palettes; responsive desktop & 390px phone layouts.
- **No runtime import cycles:** Verify with `npx vite build` and CI cycle check.

## Architecture & Module Map

1. **`src/app/usage/providerUsageProtocol.ts`**:
   - Strict runtime parser/validator for `io.mindroom.usage.response` (`version === 1`, 64 KB cap, bounded arrays/strings, finite numbers 0..100 for percentages).
   - Shared contract fixture at `src/app/usage/__fixtures__/providerUsageContract.json`.
2. **`src/app/usage/providerUsageController.ts`** + **`src/app/usage/useProviderUsage.ts`**:
   - Per-`MatrixClient` singleton owner (retained at app root alongside `useModelControllerLifetime`).
   - Sends encrypted `io.mindroom.usage.request` to discovered signed `mindroom_*` runtime devices (reusing `signedModelDevices` from `src/app/models/modelDeviceTrust.ts`).
   - Exposes snapshot (`status`, `runtimes`, `selectedRuntimeId`, `snapshot`, `loading`, `refreshing`, `hasLowQuota` (`<15%` left on any window), `available`) via `useSyncExternalStore`.
   - `ensureLoaded(roomId?)` triggers lazy discovery once per session (and refreshes on explicit `refresh(true)`).
3. **`src/app/usage/QuotaBar.tsx`** + **`QuotaBar.css.ts`** (shared primitive):
   - Renders T3-style horizontal remaining-% bar with pace tick mark (`timeLeft = clamp(0, 100, (resetsAt - now) / (windowDurationMins * 60_000) * 100)` when both `resets_at` and `window_duration_mins` are present), warning (`<=20%`) and critical (`<=10%`) tints, and `Intl`-formatted reset countdown.
   - Also exports `InlineQuotaSummary` for Model Picker group headers (`5h 62% · 7d 78%`).
4. **`src/app/usage/UsagePage.tsx`** + **`UsagePage.css.ts`**:
   - Route `/usage/` (`USAGE_PATH = '/usage/'` in `src/app/routes/paths.ts`, `pathUtils.ts`, `useUsageSelected.ts`, routed in `ClientRoot.tsx`).
   - Header with title, runtime switcher (only if >1 runtime answered), `Limits | Tokens & Cost` segmented control, and Refresh button.
   - `Limits` tab: responsive 2-column grid (1-column on phone, odd last card full-width) of account cards showing provider dot, display name, plan/account label, `QuotaBar` per window (or PAYG/unavailable note), stale indicator if `stale: true`, and 7-day token/spend footer.
   - `Tokens & Cost` tab: 7-day total tokens headline, responsive CSS stacked daily bar chart across accounts, and per-account breakdown table (including an `Unattributed` row only when `unattributed_tokens_7d > 0`).
5. **`src/app/sidebar/rail/UsageTab.tsx`** + rail wiring:
   - Progressive-reveal rail button (visible when `available` is true, like `CanvasesTab`), showing an amber warning dot when `hasLowQuota` is true.
   - Wired into `SidebarNav.tsx`, `railButtons.ts` (`usage: 'showUsageInSidebar'`), `settingsRegistry.ts`, `HiddenRailPages.tsx`, and phone nav drawer.
6. **Model Picker integration (`src/app/models/ModelPicker.tsx` + `ModelPicker.css.ts`)**:
   - Reads current runtime's `ProviderUsageSnapshot` (triggers passive fetch when picker opens if not loaded).
   - On each provider group header, if every visible model in that group maps to one `ProviderAccountUsage` record with at least one window, renders `InlineQuotaSummary`.
   - When usage data is available, renders a compact footer row (`Updated …` + `"All usage & limits →"` button that closes the picker and navigates to `/usage/`).
