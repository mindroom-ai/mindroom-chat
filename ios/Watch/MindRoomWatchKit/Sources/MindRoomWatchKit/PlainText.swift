import Foundation

/// An agent reply's Markdown as plain text for the watch, with MindRoom's tool-call lines counted.
public enum PlainText {
    /// MindRoom writes each tool call as a line "🔧 `tool_name` [n]", with a trailing ⏳ while it runs.
    private static let toolLine = try! NSRegularExpression(pattern: #"^🔧[^\S\n]*`([^`\n]+)`[^\S\n]*\[\d+\](?:[^\S\n]*⏳)?[^\S\n]*$"#)

    public static func of(markdown: String) -> String { withToolCount(markdown).text }

    /// A Matrix user id in text: `@localpart:server`, without trailing punctuation.
    private static let userId = try! NSRegularExpression(pattern: #"@[a-z0-9._=\-/+]+:[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*(?::\d+)?"#)

    /// The user ids the text names, in order.
    public static func mentionedUserIds(_ text: String) -> [String] {
        userId.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap { Range($0.range, in: text).map { String(text[$0]) } }
    }

    /// The text with each user id that has a name replaced by the name.
    public static func replacingMentions(_ text: String, names: [String: String]) -> String {
        var result = text
        for id in Set(mentionedUserIds(text)).sorted(by: { $0.count > $1.count }) {
            if let name = names[id] { result = result.replacingOccurrences(of: id, with: name) }
        }
        return result
    }

    public static func withToolCount(_ markdown: String) -> (text: String, tools: Int) {
        let details = withToolDetails(markdown)
        return (details.text, details.toolNames.count)
    }

    /// Extracts plain text, ordered v2 tool names, and an optional work/answer split around the last v2 tool line.
    /// `workText` is populated only when non-empty prose exists both before and after the last tool line.
    public static func withToolDetails(_ markdown: String) -> (text: String, toolNames: [String], workText: String?, answerText: String) {
        var toolNames: [String] = []
        var lastToolIndex: Int?
        var fence: String?
        var lines: [String] = []
        for line in markdown.components(separatedBy: .newlines) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if let open = fence {
                if trimmed.hasPrefix(open) && trimmed.allSatisfy({ $0 == open.first }) { fence = nil } else { lines.append(line) }
                continue
            }
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                fence = String(trimmed.prefix { $0 == trimmed.first })
                continue
            }
            if let match = toolLine.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)),
               let nameRange = Range(match.range(at: 1), in: line) {
                toolNames.append(String(line[nameRange]))
                lastToolIndex = lines.count
                continue
            }
            lines.append(prose(line))
        }
        let text = normalize(lines[...])
        if let splitIndex = lastToolIndex {
            let before = normalize(lines[..<splitIndex])
            let after = normalize(lines[splitIndex...])
            if !before.isEmpty && !after.isEmpty {
                return (text, toolNames, before, after)
            }
        }
        return (text, toolNames, nil, text)
    }

    /// Splits a raw Markdown body at an LF-indexed line boundary (`body_line` in a v3 tool trace) in a single
    /// fence-aware pass. Counts `splitLine` strictly on LF bytes while formatting embedded newlines identically to
    /// `withToolDetails`. Returns `nil` if the boundary is out of range, lands inside an open code fence, or has
    /// no non-empty prose on either side.
    public static func splitFinishedWork(markdown: String, atLFLine splitLine: Int) -> (workText: String, answerText: String)? {
        let rawLines = markdown.utf8.split(separator: 0x0A, omittingEmptySubsequences: false).map { slice -> String in
            let trimmed = slice.last == 0x0D ? slice.dropLast() : slice
            return String(decoding: trimmed, as: UTF8.self)
        }
        guard splitLine > 0 && splitLine < rawLines.count else { return nil }
        var fence: String?
        var beforeLines: [String] = []
        var afterLines: [String] = []
        for (index, rawLine) in rawLines.enumerated() {
            if index == splitLine && fence != nil { return nil }
            for line in rawLine.components(separatedBy: .newlines) {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                let formatted: String?
                if let open = fence {
                    if trimmed.hasPrefix(open) && trimmed.allSatisfy({ $0 == open.first }) {
                        fence = nil
                        formatted = nil
                    } else {
                        formatted = line
                    }
                } else if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                    fence = String(trimmed.prefix { $0 == trimmed.first })
                    formatted = nil
                } else if toolLine.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)) != nil {
                    formatted = nil
                } else {
                    formatted = prose(line)
                }
                if let formatted {
                    if index < splitLine { beforeLines.append(formatted) } else { afterLines.append(formatted) }
                }
            }
        }
        let before = normalize(beforeLines[...])
        let after = normalize(afterLines[...])
        guard !before.isEmpty && !after.isEmpty else { return nil }
        return (before, after)
    }

    private static func normalize(_ lines: ArraySlice<String>) -> String {
        lines.joined(separator: "\n")
            .replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func prose(_ line: String) -> String {
        var text = line
        let rules: [(String, String)] = [
            (#"^\s{0,3}#{1,6}\s+"#, ""),
            (#"^\s{0,3}>\s?"#, ""),
            (#"^(\s*)[-*+]\s+"#, "$1• "),
            (#"!?\[([^\]]*)\]\([^)]*\)"#, "$1"),
            (#"`([^`]*)`"#, "$1"),
            (#"(\*\*|__)(.+?)\1"#, "$2"),
            (#"(?<![\w*])[*_](?!\s)(.+?)(?<!\s)[*_](?![\w*])"#, "$1"),
            (#"~~(.+?)~~"#, "$1"),
        ]
        for (pattern, template) in rules {
            text = text.replacingOccurrences(of: pattern, with: template, options: .regularExpression)
        }
        return text
    }
}
