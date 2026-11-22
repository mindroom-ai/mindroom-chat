# Incoming-call push for DM calls on iPhone

Date: 2026-11-21, revised after Astra's review. Status: design only; nothing is implemented, deployed or committed.

Goal: when someone starts a call in a small room (a direct chat, or two people and an agent), the other person's iPhone shows "Incoming call from <name>" and plays a ringtone, with the app closed or in the background.

Fixed by Bas: plain APNs alert, no CallKit or PushKit. In encrypted rooms the ring event may carry an unencrypted ring hint.

Read at: mindroom-chat main `d52d94960`, mindroom-tuwunel main `0a178f68f`, Sygnal `v0.17.0`, matrix-js-sdk 45.1.0. Open points with my confidence are in section 8.

## 1. How it works end to end

0. Ordinary push must work first (section 7, step 0). The callee in the incident had no pusher at all.
1. The SDK sends one ring event (`org.matrix.msc4075.rtc.notification`, `notification_type: "ring"`), as today. In an encrypted room our SDK patch adds one cleartext field that says "this is a ring".
2. Tuwunel matches it with a new default push rule and sends the push with the tweak `sound: "ring"`.
3. The gateway (Sygnal plus one subclass file) turns that into an APNs alert with the text for "Incoming call from X", `sound: "ring.wav"`, and an expiry at the end of the ring.
4. The iOS app bundles `ring.wav`. A tap opens the room; the existing call UI shows whether the call is still live.

## 2. Sender

### What the code says

- The SDK sends the ring once per join, when `pendingNotificationToSend && ownMembership && oldMemberships.length === 0`, and then clears the pending flag (`MatrixRTCSession.ts:909-924`). The same gate is in 41.7.0, the incident build. 45.1.0 adds a sticky-event attempt (MSC4354) with a fallback to `sendEvent`; Tuwunel does not advertise it.
- Transport errors are already retried. The ring has an `m.reference`, so it goes through the message queue (`scheduler.ts:59-65`), and Chat's `MessageSendScheduler` retries network and server errors with the same transaction ID for up to 60 s (`matrixClientFactory.ts:73-105,135`). My first draft's "no retry" was wrong.
- Not retried: an encryption failure. `encryptEventIfNeeded` runs before the scheduler (`client.ts:3072` vs `:3089`); the event goes to `NOT_SENT` and the SDK only logs it.
- The app decides whether to ring at `CallPanel.tsx:479`: nothing if someone is already in the call, `ring` only if the room is in `m.direct`, else `notification`.
- `e2e/calls/calls.spec.ts:266-292` already covers a ring in a clear and an encrypted direct chat on web. So the path works on web; the incident is conditional (I did not rerun the test).

### Cause: unresolved

The server shows only that no ring from the caller landed. It does not show whether the app asked for a ring, whether the SDK's gate passed, or whether encryption or the send failed. I do not guess.

### Decision: the SDK stays the only sender; trace, then fix at the point found

1. **Trace** (app code, no SDK change): one record per join with
   - the `notify` choice and its inputs (people in the call, `m.direct`, joined member count);
   - the own membership echo and whether it has an event ID (read from `session.memberships`; `activeMemberships()` drops the ID, `callMemberships.ts:10-18`);
   - the ring's local echo status changes (`ENCRYPTING`, `QUEUED`, `SENDING`, `SENT`, `NOT_SENT` with the error) and `DidSendCallNotification`;
   - "no ring echo within 3 s of the own membership while alone", which means the gate skipped it.
   It goes to the console and the existing deep diagnostics.
2. **Reproduce** on an iPhone against a throwaway deployment and read the trace. The fix goes where the trace points: the app's `notify` choice, the SDK gate (patch), or the encryption failure (one `resendEvent` of the same local event inside the ring's lifetime). No fix is built blind.
3. **Two changes the code justifies now:**
   - Deadline and queue isolation: each ring gets its own scheduler queue (`call-ring:<id>`) so an expired ring cannot reject unrelated queued sends or a redial's ring, and retries stop at its `lifetime` (30 s, rejected at expiry), not 60 s (`isPastRetryWindow`). No second retry loop.
   - The `notify` choice no longer depends on `m.direct` alone: `ring` when the room is direct **or** has two or three joined members; else `notification`. This matches the server rule (section 4).

One ring per call comes from the client: the SDK sends once per join and retries reuse the transaction ID. The homeserver does not deduplicate rings.

### Tests

- Unit: trace records for each path; the retry window of a ring ends at its lifetime; `notify` for direct, two-member, three-member and four-member rooms.
- E2E: extend `calls.spec.ts:266-292` (clear and encrypted): exactly one ring event follows the caller's membership; in the encrypted room it is `m.room.encrypted` with the hint.

## 3. Ring hint for encrypted rooms

**Upstream.** MSC4075 defines push rules only for the unencrypted event and says the event MUST be encrypted in encrypted rooms, with clients re-applying push rules after decryption. Synapse `develop` has those two rules behind `msc4075_enabled` and nothing for the encrypted case. There is no upstream cleartext hint, so ours is under `io.mindroom.*`.

**Format.** A top-level field of the `m.room.encrypted` content, beside `algorithm`, `ciphertext` and `m.relates_to`:

```json
"io.mindroom.rtc.notification": {
  "notification_type": "ring", "sender_ts": 1795300000000, "lifetime": 30000, "m.call.intent": "audio"
}
```

- It discloses that this event is a ring, and when. The server already sees the caller's call membership and the ring's cleartext `m.reference` to it. It holds no recipient IDs.
- Receiving clients ignore it and ring only from the decrypted content, as `readRing` does.

**How it is added.** Patch-package change in `rust-crypto/RoomEncryptor.ts`, `encryptEventInner` (and `lib/`). After `encryptRoomEvent`, for a non-state event of type `EventType.RTCNotification` whose `notification_type` is `"ring"`, build the hint from an allowlist and add it to the parsed encrypted content before `makeEncrypted`:

- `notification_type`: the literal `"ring"`;
- `sender_ts`, `lifetime`: only if integers;
- `m.call.intent`: only `"audio"` or `"video"`.

Nothing is copied as an object, so no other field can reach the cleartext. An app-level send cannot do this: the SDK keeps only `m.relates_to` in the clear, inside the Rust crypto, with no hook.

## 4. Tuwunel

### Rules

Two new server-default **override** rules, inserted just before `.m.rule.is_user_mention`:

```json
{ "rule_id": ".io.mindroom.rule.rtc.ring", "default": true, "enabled": true,
  "conditions": [
    { "kind": "event_property_is", "key": "type", "value": "org.matrix.msc4075.rtc.notification" },
    { "kind": "event_property_is", "key": "content.notification_type", "value": "ring" },
    { "kind": "room_member_count", "is": "<=3" } ],
  "actions": ["notify", { "set_tweak": "sound", "value": "ring" }] }

{ "rule_id": ".io.mindroom.rule.rtc.ring_encrypted", "default": true, "enabled": true,
  "conditions": [
    { "kind": "event_property_is", "key": "type", "value": "m.room.encrypted" },
    { "kind": "event_property_is",
      "key": "content.io\\.mindroom\\.rtc\\.notification.notification_type", "value": "ring" },
    { "kind": "room_member_count", "is": "<=3" } ],
  "actions": ["notify", { "set_tweak": "sound", "value": "ring" }] }
```

- Both match the event type and `notification_type: "ring"` exactly (`event_property_is`, no globs, case-sensitive), so a group `notification` never gets the ring tweak and keeps today's behaviour.
- Two or three joined members, independent of `m.direct`: a direct chat, or two people and an agent.
- Our own rule IDs: the conditions differ from MSC4075's rules (member count, `notification_type`, no mention conditions). In a room this small everyone else is the target.
- Mute and ignore keep their precedence: user override rules sit before server defaults, and `append_pdu` drops ignored senders before any rule runs. Both are tested.

### When a ring rule wins

`Service::get_actions` evaluates the rules in order, as Ruma does, with one addition. A ring rule that matches wins only if all of these hold:

1. its actions still notify and hold exactly one sound tweak, `"ring"` (a user may have changed them);
2. the room's joined count is known and at most 3 (a failed count lookup would otherwise read as 0 and pass the rule's own `<=3` condition);
3. no enabled room-kind rule mutes the room (matrix-js-sdk writes a muted room that way; an override mute already wins by order).

Otherwise the ring rules are skipped and the unchanged event goes on to the later rules, so it gets exactly what it would get today.

The server does not check that a call exists. It does not look at the ring's `m.reference` or at the sender's call membership, and it keeps no record of rings it let through. Any member who can send the event can therefore ring the others in a room of up to three, and can do it again. The recipient's remedies are the usual ones: mute the room, ignore the sender, or disable the two rules.

### Migration: merge on read, persist with the next write

- New `src/service/pusher/ring_rules.rs`: `server_default(user_id)` (Ruma's defaults plus the two rules; Ruma is pinned from `matrix-construct/ruma`, so the rules live in the fork) and `merged(stored)`, which inserts a ring rule the stored ruleset lacks and changes nothing else.
- `merged` is used on every read of stored rules: `pusher::Service::ruleset()` (evaluation), both `GET /pushrules` routes, and `load_push_rules` (`api/client/push/mod.rs:37-42`), which the single-rule routes use. A user can then disable a ring rule before any full GET without a 404.
- No new write on GET. The merged set is saved only as part of a rule write, which is already read-modify-write, so a concurrent mute cannot be overwritten.
- The two full GET routes already repair legacy rulesets with `update_with_server_default`, which drops stored default rules Ruma does not know. The repair keeps a stored ring rule with the user's `enabled` and `actions`, and still stores no missing one.
- Upstream: not now. The hint rule is MindRoom-only; MSC4075's own rules belong in Ruma once the MSC settles.

## 5. Push gateway

### What Sygnal v0.17.0 does

The pinned digest is the `v0.17.0` tag, which exists only in `element-hq/sygnal` (AGPL-3.0). In `sygnal/apnspushkin.py`:

- `_get_payload_full` sets `loc-key` and `loc-args`; `m.room.encrypted` and unknown types give `MSG_FROM_USER`. Tweaks are parsed and never used; the sound comes only from the pusher's fixed `default_payload`. No `apns-expiration`.
- The payload is built once and sent up to three times, 10 and 20 s apart (`:93-94`, `:340-384`).
- `sygnal.py:178-191` loads a pushkin by dotted path, so one mounted file is enough. `default_payload` cannot vary per push; patching the image or writing a gateway is more work.

### Decision: `MindroomApnsPushkin(ApnsPushkin)`, one file

```python
RTC, HINT = "org.matrix.msc4075.rtc.notification", "io.mindroom.rtc.notification"

def ring_of(n, now):                      # the ring's fields, or None if this push is not a valid ring
    c = n.content or {}
    r = c if n.type == RTC else c.get(HINT) if n.type == "m.room.encrypted" else None
    if not isinstance(r, dict) or r.get("notification_type") != "ring":
        return None
    ts, life = r.get("sender_ts"), r.get("lifetime")
    if type(ts) is not int or type(life) is not int or life <= 0 or ts > now + 20_000:
        return None                       # no timestamp is invented for a bad one
    return r

class MindroomApnsPushkin(ApnsPushkin):
    def _get_payload_full(self, n, device, log, send_badge_counts):
        payload = super()._get_payload_full(n, device, log, send_badge_counts)
        ring = ring_of(n, now_ms()) if device.tweaks.sound == "ring" else None
        if payload is None or ring is None or "alert" not in payload["aps"]:
            return payload                # also legacy m.call.invite: unchanged
        name = (n.sender_display_name or n.sender or " ")[: self.MAX_FIELD_LENGTH]
        video = ring.get("m.call.intent") == "video"
        payload["aps"]["alert"] = {"loc-key": "VIDEO_CALL_FROM_USER" if video else "VOICE_CALL_FROM_USER",
                                   "loc-args": [name]}
        payload["aps"]["sound"] = "ring.wav"
        payload["mindroom_ring"] = {"expires_at": ring["sender_ts"] + min(ring["lifetime"], 120_000)}
        return payload

    async def _dispatch_request(self, log, span, device, shaved_payload, prio, notif_id):
        ring = shaved_payload.get("mindroom_ring")
        if ring and ring["expires_at"] <= now_ms():
            return []                     # runs before every APNs attempt, retries included
        return await super()._dispatch_request(log, span, device, shaved_payload, prio, notif_id)

    async def _send_notification(self, request):
        ring = request.message.get("mindroom_ring")
        if ring:
            request.time_to_live = max(0, math.ceil((ring["expires_at"] - now_ms()) / 1000))
        return await super()._send_notification(request)
```

- A ring needs three things: the homeserver's `sound: ring` tweak, the exact wire type (the RTC type with the fields at top level, or `m.room.encrypted` with the hint), and valid times.
- An expired ring is never sent, on the first try or a retry. A push that is not a valid ring keeps Sygnal's normal alert.
- Only `full` pushers are affected; `event_id_only` stays generic.
- The file lives in dotfiles next to `sygnal.nix`, as the only copy. Its tests run in the pinned image (`podman run … python -m unittest`).
- `sygnal.nix`: install the file to `/run/sygnal/`, `PYTHONPATH = "/sygnal"`, app `type: mindroom_pushkin.MindroomApnsPushkin`.
- **AGPL.** Section 13 (`LICENSE-AGPL-3.0:542-549`) asks a modified version to prominently offer its source to remote users. The file is AGPL-3.0, and `https://push.mindroom.chat/` answers `GET /` with a short text naming Sygnal v0.17.0 and linking the tag and the pushkin file at the deployed dotfiles commit (the repo is public). Caddy serves it.

## 6. iOS

- **Ringtone**: `ios/App/App/ring.wav`, 16-bit PCM mono, 11.025 kHz, 28.6 s (11 cycles of the bell pattern of `ringtone.ts`), about 630 KB, made by a committed script. A custom sound of 30 s or more, or a missing file, plays the default sound.
- **Project**: a file reference and a Resources entry in `project.pbxproj` (the App target is not a synchronized folder; check `scripts/ios-xcode-project.mjs` first).
- **Info.plist and entitlements**: no change. No Time Sensitive entitlement, so Focus and the silent switch apply.
- **Text**: `VOICE_CALL_FROM_USER` and `VIDEO_CALL_FROM_USER` exist in 17 `Localizable.strings`; change them to "Incoming call from %1$@" and "Incoming video call from %1$@". It is the alert body under the app name.
- **Web ringtone on native iOS.** In front, Capacitor presents no banner or sound (`capacitor.config.ts` sets no `presentationOptions`), and the web ringtone rings. There is no separate sound-owner policy: on native iOS, hiding the app (`visibilitychange`) stops the web ringtone, and if the app becomes visible again while the ring is still live (`Date.now() < expiresAt` and the call is still active), the web ringtone may play again (so opening the app after an APNs ring within the ring lifetime rings in-app again; accepted). For a muted non-`m.direct` small room, the local ringtone and desktop notification stay silent while the card may still show.
- **Tap**: `readPushTarget` (`IOSPushFeature.tsx`) reads `mindroom_ring` and opens the room without the event ID, as the ring card's own Open does (`IncomingCalls.tsx:235`). After the first sync the existing UI decides: the ring card inside the lifetime, the call bar and Join if the caller is still there, nothing more if the call is over. No auto-join.
- **Expired ring**: APNs drops an undelivered ring at its expiry. A delivered banner stays in Notification Center and reads as a missed call.
- **Limits**: one sound of at most 28.6 s; answering on another device does not stop it.

## 7. Work split: three PRs

| # | Repo | Contents | Est. LOC (code + tests) |
|---|---|---|---|
| 1 | mindroom-tuwunel | `pusher/ring_rules.rs` (rules, `merged`), the check in `get_actions` that lets a ring rule win, callers of `server_default`, the read paths; tests in `pusher/tests.rs`, `api/client/push/tests.rs`, `main/tests/pusher_notify.rs` | 220 + 320 |
| 2 | mindroom-chat | Ring trace, retry deadline, `notify` choice, the fix the trace points to, hint in `patches/matrix-js-sdk+45.1.0.patch`, `ring.wav` + script + `project.pbxproj`, 17 strings, tap, iOS hide-stops-ringtone and room mute; unit tests and the extended `calls.spec.ts` | 220 + 300 |
| 3 | dotfiles | `mindroom_pushkin.py`, its tests, `sygnal.nix`, the source offer in `caddy.nix` | 110 + 130 |

Tuwunel tests: clear ring and encrypted ring give `sound: ring` in rooms of two and three; four members, an unknown joined count, a case variant of the event type, and ring rules whose actions were emptied or carry a second sound give today's actions; a group `notification` is unchanged; room mute (override and room-kind) and ignore win; a stored old ruleset is merged for evaluation and GET; a ring rule can be disabled before any GET and stays disabled through the legacy repair; a GET stores no missing ring rule.

Pushkin tests: clear ring, hint ring, video, group `notification`, `m.call.invite`, wrong wire type, bad or far-future timestamp, no tweak (all unchanged where they should be); expired before the first try and before a retry (nothing sent); `time_to_live`.

**Step 0, before any call QA: ordinary push.** On each test phone: a build with #597; notifications and sounds allowed; `GET /pushers` shows the `chat.mindroom.app` HTTP pusher with `format: full` and the gateway URL (registration is conditional, `IOSPushFeature.tsx:59-89`); a normal message reaches the locked phone with banner and sound. The capture-server test below does not prove this.

**Order.** Step 0, then PR 1, PR 2 (web, then the iOS build), PR 3. Each is harmless alone: without the gateway the tweak is ignored; without the iOS build the phone shows "Voice call from X" with the default sound.

**Throwaway deployment check** (never lab or prod): Tuwunel from PR 1, Chat from PR 2, a capture server as the callee's pusher URL. Start a call in an encrypted two-person room and in one with an agent; assert the captured `/notify` body (`tweaks.sound == "ring"`, `prio: high`, the hint), and feed that body to the pushkin tests as a fixture. APNs itself needs real phones: locked, closed, in front, background then front during one ring, muted room, expired ring, silent switch.

**Needs Bas:** sign the dotfiles change and restart `podman-sygnal` and Caddy; roll Tuwunel to production; sign and distribute the iOS build; two iPhones for step 0, the trace and the last check; say if the bell pattern is the ringtone you want and who translates the two strings.

## 8. Open points

1. Caller-side cause: unknown until the trace on a real phone. The size of that fix is unknown too.
2. Ringing rooms of three, in the client's `notify` choice and in the rules (75%): three people in a room also ring each other. It is a product call.
3. The server does not check that a ring belongs to a call (decided, to keep the fork change small): a member of a room of up to three can ring the others without one, and repeatedly. Mute, ignore and disabling the rules are the remedies.
4. AGPL: the source offer on the push domain and an AGPL file in dotfiles (75%, not legal advice).
5. Whether iOS stops the APNs sound when the app is opened (unknown; the design does not depend on it, the phone check shows it).
