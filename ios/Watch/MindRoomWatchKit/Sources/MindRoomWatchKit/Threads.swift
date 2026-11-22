import Foundation

/// Thread tags (`com.mindroom.thread.tags` state), as the web client writes them.
public enum ThreadTags {
    public static let eventType = "com.mindroom.thread.tags"

    public static func resolvedStateKey(root: String) -> String { key(root, "resolved") }

    public static func resolvedContent(userId: String, at date: Date) -> JSON {
        let formatter = ISO8601DateFormatter()
        return ["set_by": userId, "set_at": formatter.string(from: date)]
    }

    /// The roots whose thread is resolved and not pinned, as the web client reads them: a per-tag record
    /// overrides the legacy per-thread tags, an empty one (a tombstone) removes the tag, and a pinned event
    /// (`m.room.pinned_events`) never reads as resolved.
    public static func resolvedRoots(state: [JSON]) -> Set<String> {
        var legacy = Set<String>(), perTag = Set<String>(), tombstones = Set<String>(), pinned = Set<String>()
        for event in state {
            if event["type"] as? String == "m.room.pinned_events" {
                pinned.formUnion(event.content["pinned"] as? [String] ?? [])
            }
            guard event["type"] as? String == eventType, let stateKey = event["state_key"] as? String else { continue }
            let content = event.content
            if let parts = try? JSONSerialization.jsonObject(with: Data(stateKey.utf8)) as? [String], parts.count == 2 {
                guard parts[1] == "resolved" else { continue }
                if content.isEmpty { tombstones.insert(parts[0]) } else { perTag.insert(parts[0]) }
            } else if let tags = content["tags"] as? JSON, tags["resolved"] != nil {
                legacy.insert(stateKey)
            }
        }
        return legacy.subtracting(tombstones).union(perTag).subtracting(pinned)
    }

    private static func key(_ root: String, _ tag: String) -> String {
        let data = try! JSONSerialization.data(withJSONObject: [root, tag], options: [.withoutEscapingSlashes])
        return String(decoding: data, as: UTF8.self)
    }
}

/// What a thread's row says at its end, most urgent first.
public enum ThreadRowState: Equatable, Sendable {
    case failed, queued, needsYou, running, idle(Date)
}

/// A recording's meter samples (dB, -160 to 0) as bars from 0 to 1.
public enum Waveform {
    public static func bars(from levels: [Float], count: Int = 48) -> [Float] {
        guard !levels.isEmpty else { return Array(repeating: 0, count: count) }
        let scaled = levels.map { max(0, min(1, ($0 + 50) / 50)) }
        return (0..<count).map { index in
            let start = index * scaled.count / count
            let end = max(start + 1, (index + 1) * scaled.count / count)
            let slice = scaled[min(start, scaled.count - 1)..<min(end, scaled.count)]
            return slice.reduce(0, +) / Float(slice.count)
        }
    }
}


/// A thread's resolved title together with its source event id and kind (summary notice vs voice-root transcript).
public struct KnownTitle: Equatable, Sendable {
    public enum Kind: String, Equatable, Sendable {
        case summary
        case transcript
    }

    public let text: String
    public let sourceEventId: String
    public let kind: Kind

    public init(text: String, sourceEventId: String, kind: Kind) {
        self.text = text
        self.sourceEventId = sourceEventId
        self.kind = kind
    }
}

/// One thread root returned by `/threads`, carrying Tuwunel's bundled summary fields
/// (`io.mindroom.title`, `io.mindroom.latest_reply`, `latest_event`, `count`) for instant first paint
/// and edit-aware cache invalidation.
public struct ThreadListEntry: Equatable, Sendable {
    public let rootId: String
    public let rootTs: Int
    public let latestTs: Int
    public let count: Int
    public let serverTitle: KnownTitle?
    public let fallbackTitle: String
    public let previewSender: String?
    public let previewText: String?
    public let previewIsEncrypted: Bool
    public let previewIsVoiceOnly: Bool
    public let voiceFile: String?
    /// Changes on any new reply, count change, or bundled edit of the latest reply / latest event / title / root.
    public let cacheKey: String

    public static func parse(_ root: JSON, ownUserId: String) -> ThreadListEntry? {
        guard let rootId = root.eventId else { return nil }
        let threadRel = ((root["unsigned"] as? JSON)?["m.relations"] as? JSON)?["m.thread"] as? JSON
        let count = (threadRel?["count"] as? NSNumber)?.intValue ?? 0
        let latestEvent = threadRel?["latest_event"] as? JSON
        let latestReply = threadRel?["io.mindroom.latest_reply"] as? JSON
        let titleEvent = threadRel?["io.mindroom.title"] as? JSON

        let serverTitle: KnownTitle? = titleEvent.flatMap { event in
            let content = effectiveContent(event, latestEdit: event.validBundledEdit)
            let summaryObj = content["io.mindroom.thread_summary"] as? JSON
            let raw: String?
            if let summaryObj, (summaryObj["version"] as? NSNumber)?.intValue == 1,
               let summary = summaryObj["summary"] as? String, !summary.isEmpty {
                raw = summary
            } else {
                raw = content["body"] as? String
            }
            guard let raw, !raw.isEmpty else { return nil }
            return KnownTitle(text: raw, sourceEventId: event.eventId ?? "", kind: .summary)
        }

        let rootEdit = root.validBundledEdit
        let rootContent = effectiveContent(root, latestEdit: rootEdit)
        let isAudioRoot = (rootContent["msgtype"] ?? root.content["msgtype"]) as? String == "m.audio"
        let encryptedRoot = root["type"] as? String == "m.room.encrypted"
        let rootText = PlainText.of(markdown: rootContent["body"] as? String ?? "")
        let fallbackTitle = isAudioRoot ? String(localized: "Voice message")
            : encryptedRoot ? String(localized: "Encrypted message") : rootText

        let isVoiceRoot = root.content["org.matrix.msc3245.voice"] is JSON || root.content["m.voice"] is JSON
        let voiceFile = isVoiceRoot ? root.content["filename"] as? String ?? root.content["body"] as? String : nil

        let isTitleNotice = { (event: JSON) in event.content["io.mindroom.thread_summary"] != nil }
        let isPreviewCandidate = { (event: JSON) -> Bool in
            guard !isTitleNotice(event),
                  (event["sender"] as? String) != ownUserId,
                  event.content["com.mindroom.original_sender"] == nil,
                  VoiceEcho.transcript(event, latestEdit: nil) == nil else { return false }
            return true
        }

        var previewSender: String?
        var previewText: String?
        var previewIsEncrypted = false
        var previewIsVoiceOnly = false
        if let preview = [latestReply, latestEvent].compactMap({ $0 }).first(where: isPreviewCandidate) {
            previewSender = preview["sender"] as? String
            let type = preview["type"] as? String
            if type == "m.room.encrypted" {
                previewIsEncrypted = true
            } else if type == ApprovalCard.eventType {
                previewText = ApprovalCard.parse(preview)?.toolName
            } else if type == "m.room.message" {
                let content = effectiveContent(preview, latestEdit: preview.validBundledEdit)
                let isAudio = (content["msgtype"] ?? preview.content["msgtype"]) as? String == "m.audio"
                if isAudio {
                    let caption = AudioCaption.of(content)
                    previewText = caption
                    previewIsVoiceOnly = caption == nil
                } else {
                    previewText = PlainText.of(markdown: content["body"] as? String ?? "")
                }
            }
        }

        var timestamps = [
            root.timestamp,
            rootEdit?.timestamp ?? 0,
            latestReply?.timestamp ?? 0,
            latestReply?.validBundledEdit?.timestamp ?? 0,
        ]
        if let latestEvent, !isTitleNotice(latestEvent) {
            timestamps.append(latestEvent.timestamp)
            timestamps.append(latestEvent.validBundledEdit?.timestamp ?? 0)
        }
        let latestTs = timestamps.max() ?? root.timestamp

        let cacheKey = [
            latestEvent?.eventId ?? rootId,
            String(count),
            latestEvent?.bundledEdit?.eventId ?? "",
            latestReply?.eventId ?? "",
            latestReply?.bundledEdit?.eventId ?? "",
            titleEvent?.eventId ?? "",
            titleEvent?.bundledEdit?.eventId ?? "",
            root.bundledEdit?.eventId ?? "",
        ].joined(separator: "|")

        return ThreadListEntry(
            rootId: rootId,
            rootTs: root.timestamp,
            latestTs: latestTs,
            count: count,
            serverTitle: serverTitle,
            fallbackTitle: fallbackTitle,
            previewSender: previewSender,
            previewText: previewText,
            previewIsEncrypted: previewIsEncrypted,
            previewIsVoiceOnly: previewIsVoiceOnly,
            voiceFile: voiceFile,
            cacheKey: cacheKey
        )
    }
}
