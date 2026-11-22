import Foundation

/// An agent reply's Markdown as plain text for the watch, with MindRoom's tool-call lines counted.
public enum PlainText {
    /// A matched v2 inline tool marker (`🔧 \`tool_name\` [n]`).
    public struct ToolMarker: Equatable, Sendable {
        public let index: Int
        public let name: String
    }

    /// MindRoom writes each tool call as a line "🔧 `tool_name` [n]", with a trailing ⏳ while it runs.
    private static let toolLine = try! NSRegularExpression(pattern: #"^🔧[^\S\n]*`([^`\n]+)`[^\S\n]*\[(\d+)\](?:[^\S\n]*⏳)?[^\S\n]*$"#)

    /// CommonMark thematic break (`---`, `***`, `___`, optionally spaced): visual divider, not substantive prose.
    private static let thematicBreak = try! NSRegularExpression(pattern: #"^ {0,3}(?:(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})$"#)

    /// The block quote marks a line starts with (`> `, `> > `), each after up to three spaces.
    private static let quotePrefix = try! NSRegularExpression(pattern: #"^(?:[ \t]{0,3}>[ \t]?)+"#)

    /// CommonMark link reference definition on one line (`[label]: destination "title"`): it names a link's
    /// target and draws nothing. A line with more after the destination than a title is a paragraph.
    private static let linkReferenceDefinition = try! NSRegularExpression(
        pattern: #"^ {0,3}\[(?![ \t]*\])[^\]\n]+\]:[ \t]*(?:<[^<>\n]*>|\S+)(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^()]*\)))?[ \t]*$"#)

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
        return (details.text, details.markers.count)
    }

    /// Extracts plain text, ordered v2 tool markers, and an optional work/answer split around the last v2 tool line.
    /// `workText` is populated only when substantive prose exists both before and after the last tool line.
    public static func withToolDetails(_ markdown: String) -> (text: String, markers: [ToolMarker], workText: String?, answerText: String) {
        var markers: [ToolMarker] = []
        var lastToolIndex: Int?
        var fence: String?
        var lines: [(text: String, substantive: Bool)] = []
        for line in markdown.components(separatedBy: .newlines) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if let open = fence {
                if trimmed.hasPrefix(open) && trimmed.allSatisfy({ $0 == open.first }) {
                    fence = nil
                } else {
                    lines.append((line, hasSubstantiveText(line)))
                }
                continue
            }
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                fence = String(trimmed.prefix { $0 == trimmed.first })
                continue
            }
            if let match = toolLine.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)),
               let nameRange = Range(match.range(at: 1), in: line),
               let indexRange = Range(match.range(at: 2), in: line),
               let markerIndex = Int(line[indexRange]) {
                markers.append(ToolMarker(index: markerIndex, name: String(line[nameRange])))
                lastToolIndex = lines.count
                continue
            }
            lines.append(rendered(line))
        }
        let allText = lines.map(\.text)
        let text = normalize(allText[...])
        if let splitIndex = lastToolIndex {
            let beforeSlice = lines[..<splitIndex]
            let afterSlice = lines[splitIndex...]
            if beforeSlice.contains(where: \.substantive) && afterSlice.contains(where: \.substantive) {
                return (text, markers, normalize(allText[..<splitIndex]), normalize(allText[splitIndex...]))
            }
        }
        return (text, markers, nil, text)
    }

    /// Splits a raw Markdown body at an LF-indexed line boundary (`body_line` in a v3 tool trace) in a single
    /// fence-aware pass. Counts `splitLine` strictly on LF bytes while formatting embedded newlines identically to
    /// `withToolDetails`. Returns `nil` if the boundary is out of range, lands inside an open code fence, or lacks
    /// substantive prose on either side.
    public static func splitFinishedWork(markdown: String, atLFLine splitLine: Int) -> (workText: String, answerText: String)? {
        let rawLines = markdown.utf8.split(separator: 0x0A, omittingEmptySubsequences: false).map { slice -> String in
            let trimmed = slice.last == 0x0D ? slice.dropLast() : slice
            return String(decoding: trimmed, as: UTF8.self)
        }
        guard splitLine > 0 && splitLine < rawLines.count else { return nil }
        var fence: String?
        var beforeLines: [(text: String, substantive: Bool)] = []
        var afterLines: [(text: String, substantive: Bool)] = []
        for (index, rawLine) in rawLines.enumerated() {
            if index == splitLine && fence != nil { return nil }
            for line in rawLine.components(separatedBy: .newlines) {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                let formatted: (text: String, substantive: Bool)?
                if let open = fence {
                    if trimmed.hasPrefix(open) && trimmed.allSatisfy({ $0 == open.first }) {
                        fence = nil
                        formatted = nil
                    } else {
                        formatted = (line, hasSubstantiveText(line))
                    }
                } else if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                    fence = String(trimmed.prefix { $0 == trimmed.first })
                    formatted = nil
                } else if toolLine.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)) != nil {
                    formatted = nil
                } else {
                    formatted = rendered(line)
                }
                if let formatted {
                    if index < splitLine { beforeLines.append(formatted) } else { afterLines.append(formatted) }
                }
            }
        }
        guard beforeLines.contains(where: \.substantive) && afterLines.contains(where: \.substantive) else { return nil }
        let before = normalize(beforeLines.map(\.text)[...])
        let after = normalize(afterLines.map(\.text)[...])
        return (before, after)
    }

    /// A line outside a code fence that is no tool marker, as the text shows it, and whether it is substantive.
    /// A thematic break and a link reference definition are not, in a block quote either: the web client draws
    /// a rule for one and nothing for the other, so neither alone makes a side of a work/answer split. The break
    /// is read before `prose` would make a list item of `- - -`, and shows without its quote marks.
    private static func rendered(_ line: String) -> (text: String, substantive: Bool) {
        let range = NSRange(line.startIndex..., in: line)
        let unquoted = quotePrefix.stringByReplacingMatches(in: line, range: range, withTemplate: "")
        if isThematicBreak(unquoted) { return (unquoted, false) }
        let formatted = prose(line)
        let shows = !isThematicBreak(formatted) && !matches(linkReferenceDefinition, unquoted)
        return (formatted, shows && hasSubstantiveText(formatted))
    }

    private static func matches(_ pattern: NSRegularExpression, _ line: String) -> Bool {
        pattern.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)) != nil
    }

    private static func isThematicBreak(_ line: String) -> Bool { matches(thematicBreak, line) }

    /// True when `text` has visible content beyond whitespace, pending hourglass markers (`⏳`), and zero-width characters
    /// (matching the web client's `finishedWorkSplit.ts`).
    private static func hasSubstantiveText(_ text: String) -> Bool {
        let invisible: Set<Unicode.Scalar> = ["\u{23F3}", "\u{200B}", "\u{200C}", "\u{200D}", "\u{2060}", "\u{FEFF}", "\u{FE0F}"]
        return text.unicodeScalars.contains { scalar in
            !CharacterSet.whitespacesAndNewlines.contains(scalar) && !invisible.contains(scalar)
        }
    }

    /// The lines as one text: without the blank lines before and after them and the spaces that end the last
    /// one, and with one blank line where there were more. The first line keeps its indentation, as every
    /// line after it does: it may be a line of code, and the answer of a split may start with one.
    private static func normalize(_ lines: ArraySlice<String>) -> String {
        let isBlank = { (line: String) in line.unicodeScalars.allSatisfy(CharacterSet.whitespacesAndNewlines.contains) }
        guard let first = lines.firstIndex(where: { !isBlank($0) }),
              let last = lines.lastIndex(where: { !isBlank($0) }) else { return "" }
        var text = lines[first...last].joined(separator: "\n")
            .replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
        while let scalar = text.unicodeScalars.last, CharacterSet.whitespacesAndNewlines.contains(scalar) {
            text.unicodeScalars.removeLast()
        }
        return text
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
