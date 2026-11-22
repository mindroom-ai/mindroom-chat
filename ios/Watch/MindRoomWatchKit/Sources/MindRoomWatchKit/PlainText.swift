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

    /// CommonMark thematic break (`---`, `***`, `___`, optionally spaced). It tells how such a line shows and
    /// that it starts no list item; whether a side of a split shows anything is `hasSubstantiveMarkdown`'s.
    private static let thematicBreak = try! NSRegularExpression(pattern: #"^ {0,3}(?:(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})$"#)

    /// The block quote marks a line starts with (`> `, `> > `), each after up to three spaces.
    private static let quoteMarks = #"^(?:[ \t]{0,3}>[ \t]?)+"#
    private static let quotePrefix = try! NSRegularExpression(pattern: quoteMarks)

    /// The mark a list item's line starts with (`-`, `*`, `+`, `1.`, `1)`), before a space or the line's end.
    private static let listMarker = try! NSRegularExpression(pattern: #"^ *(?:[-*+]|[0-9]{1,9}[.)])(?= |$)"#)

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
    /// `workText` is populated only when both sides of the last tool line show something (`isSubstantive`) and
    /// no line taken as a tool marker is code (`probesAreOutsideCode`). The whole text is trimmed at both ends;
    /// the halves of a split keep their first line's indentation, which is part of a line of code.
    public static func withToolDetails(_ markdown: String) -> (text: String, markers: [ToolMarker], workText: String?, answerText: String) {
        var markers: [ToolMarker] = []
        var lastToolIndex: Int?
        var reader = LineReader()
        var lines: [SourceLine] = []
        var probed: [String] = []
        for line in markdown.components(separatedBy: .newlines) {
            switch reader.read(line) {
            case let .marker(marker):
                markers.append(marker)
                lastToolIndex = lines.count
                probed.append(probeLine)
            case let .source(source):
                lines.append(source)
                probed.append(line)
            }
        }
        let text = normalize(lines.compactMap(\.text))
        if let splitIndex = lastToolIndex, isSubstantive(lines[..<splitIndex]), isSubstantive(lines[splitIndex...]),
           probesAreOutsideCode(probed) {
            return (text, markers,
                    normalize(lines[..<splitIndex].compactMap(\.text), trimLeadingWhitespace: false),
                    normalize(lines[splitIndex...].compactMap(\.text), trimLeadingWhitespace: false))
        }
        return (text, markers, nil, text)
    }

    /// Splits a raw Markdown body at an LF-indexed line boundary (`body_line` in a v3 tool trace) in a single
    /// fence-aware pass. Counts `splitLine` strictly on LF bytes while formatting embedded newlines identically to
    /// `withToolDetails`. Returns `nil` if the boundary is out of range, lands inside an open code fence or other
    /// code (`probesAreOutsideCode`), or a side of it shows nothing (`isSubstantive`).
    public static func splitFinishedWork(markdown: String, atLFLine splitLine: Int) -> (workText: String, answerText: String)? {
        let rawLines = markdown.utf8.split(separator: 0x0A, omittingEmptySubsequences: false).map { slice -> String in
            let trimmed = slice.last == 0x0D ? slice.dropLast() : slice
            return String(decoding: trimmed, as: UTF8.self)
        }
        guard splitLine > 0 && splitLine < rawLines.count else { return nil }
        var reader = LineReader()
        var before: [SourceLine] = []
        var after: [SourceLine] = []
        var probed: [String] = []
        for (index, rawLine) in rawLines.enumerated() {
            if index == splitLine {
                if reader.fence != nil { return nil }
                probed.append(probeLine)
            }
            for line in rawLine.components(separatedBy: .newlines) {
                probed.append(line)
                guard case let .source(source) = reader.read(line) else { continue }
                if index < splitLine { before.append(source) } else { after.append(source) }
            }
        }
        guard isSubstantive(before[...]), isSubstantive(after[...]), probesAreOutsideCode(probed) else { return nil }
        return (normalize(before.compactMap(\.text), trimLeadingWhitespace: false),
                normalize(after.compactMap(\.text), trimLeadingWhitespace: false))
    }

    /// A line of a reply's source that is no tool marker, and the text it shows: none for a line that opens or
    /// closes a code fence.
    private typealias SourceLine = (raw: String, text: String?)

    private enum Line {
        case marker(ToolMarker)
        case source(SourceLine)
    }

    /// An open code fence: its character, how many of them opened it, and the indentation of the text it is in
    /// (a list item's; 0 outside a list).
    private typealias Fence = (char: Character, count: Int, container: Int)

    /// Reads a reply's lines in order and follows its code fences, in which no line is a tool marker or prose.
    /// CommonMark indents a fence by up to three spaces from the text it is in, so it also follows the list item
    /// a line is in: four spaces before a fence are code at the top and a fence in an item's text. It reads line
    /// by line and does not know every block of CommonMark, so a split also asks a parser (`probesAreOutsideCode`).
    private struct LineReader {
        private(set) var fence: Fence?
        /// The indentation of the text of the list item the last line was in; 0 outside a list.
        private var container = 0

        mutating func read(_ line: String) -> Line {
            let (indent, rest) = indentation(line)
            if let open = fence {
                // A line indented less than a list item's text ends the item, and with it a fence in it.
                if rest.isEmpty || indent >= open.container {
                    if isClosingFence(line, for: open) {
                        fence = nil
                        return .source((line, nil))
                    }
                    return .source((line, line))
                }
                fence = nil
            }
            if !rest.isEmpty {
                if indent <= container + 3, !matches(thematicBreak, line), let item = listItem(line) {
                    container = item.indent
                    // The item's text may start with the fence (`- ```swift`).
                    if let open = openingFence(item.text, in: 0) {
                        fence = (open.char, open.count, container)
                        return .source((line, nil))
                    }
                } else if indent < container {
                    container = 0
                }
            }
            if let open = openingFence(line, in: container) {
                fence = open
                return .source((line, nil))
            }
            if let marker = toolMarker(line) { return .marker(marker) }
            return .source((line, rendered(line)))
        }
    }

    /// The columns a line is indented by (a tab goes to the next multiple of four), and the line after them.
    private static func indentation(_ line: String) -> (columns: Int, rest: Substring) {
        var columns = 0
        var index = line.startIndex
        while index < line.endIndex, line[index] == " " || line[index] == "\t" {
            columns += line[index] == " " ? 1 : 4 - columns % 4
            index = line.index(after: index)
        }
        return (columns, line[index...])
    }

    /// The fence a line opens in text indented by `container`: up to three spaces further, then three or more
    /// backticks with no backtick after them on the line, or three or more tildes.
    private static func openingFence(_ line: String, in container: Int) -> Fence? {
        let (indent, rest) = indentation(line)
        guard indent <= container + 3, let char = rest.first, char == "`" || char == "~" else { return nil }
        let count = rest.prefix { $0 == char }.count
        guard count >= 3, char == "~" || !rest.dropFirst(count).contains("`") else { return nil }
        return (char, count, container)
    }

    /// Whether a line closes the fence: up to three spaces further than the text the fence is in, then at least
    /// as many of its character as opened it, then nothing but spaces and tabs.
    private static func isClosingFence(_ line: String, for fence: Fence) -> Bool {
        let (indent, rest) = indentation(line)
        let count = rest.prefix { $0 == fence.char }.count
        return indent <= fence.container + 3 && count >= fence.count
            && rest.dropFirst(count).allSatisfy { $0 == " " || $0 == "\t" }
    }

    /// The list item a line starts: the indentation of its text, and that text.
    private static func listItem(_ line: String) -> (indent: Int, text: String)? {
        guard let match = listMarker.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)),
              let marker = Range(match.range, in: line) else { return nil }
        let after = line[marker.upperBound...]
        let spaces = after.prefix { $0 == " " }.count
        // Five spaces or more after the mark are one, and code that is indented.
        let padding = (1...4).contains(spaces) && spaces < after.count ? spaces : 1
        return (line.distance(from: line.startIndex, to: marker.upperBound) + padding, String(after.dropFirst(padding)))
    }

    private static func toolMarker(_ line: String) -> ToolMarker? {
        guard let match = toolLine.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)),
              let nameRange = Range(match.range(at: 1), in: line),
              let indexRange = Range(match.range(at: 2), in: line),
              let index = Int(line[indexRange]) else { return nil }
        return ToolMarker(index: index, name: String(line[nameRange]))
    }

    /// A line outside a code fence that is no tool marker, as the text shows it. A thematic break shows as it
    /// is, without its quote marks: `prose` would make a list item of `- - -`.
    private static func rendered(_ line: String) -> String {
        let range = NSRange(line.startIndex..., in: line)
        let unquoted = quotePrefix.stringByReplacingMatches(in: line, range: range, withTemplate: "")
        return matches(thematicBreak, unquoted) ? unquoted : prose(line)
    }

    private static func matches(_ pattern: NSRegularExpression, _ line: String) -> Bool {
        pattern.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)) != nil
    }

    /// Whether a side of a work/answer split shows something of its own: in the text the watch shows, and in
    /// its source as a CommonMark parser reads it.
    private static func isSubstantive(_ lines: ArraySlice<SourceLine>) -> Bool {
        hasSubstantiveText(lines.compactMap(\.text).joined(separator: "\n"))
            && hasSubstantiveMarkdown(lines.map(\.raw).joined(separator: "\n"))
    }

    /// In the source a split gives to a CommonMark parser, a line that stands for one the reader took for text
    /// outside code: a tool marker, or the line a version-3 reply splits before. It ends in a private-use character.
    private static let probe: Unicode.Scalar = "\u{E000}"
    private static let probeLine = "🔧\(probe)"

    /// Whether Foundation's CommonMark parser has every probe line of the source in text: not in a code block
    /// and not in raw HTML. Else the reader took a line of code for a tool marker or for the start of the
    /// answer (it lost track of a fence in a block it does not know), and the reply stays unfolded.
    private static func probesAreOutsideCode(_ lines: [String]) -> Bool {
        let markdown = lines.joined(separator: "\n")
        guard let parsed = try? AttributedString(markdown: markdown, options: .init(interpretedSyntax: .full)) else { return false }
        var inText = 0
        for run in parsed.runs {
            let probes = String(parsed[run.range].characters).unicodeScalars.filter { $0 == probe }.count
            guard probes > 0 else { continue }
            let isCode = run.presentationIntent?.components.contains { if case .codeBlock = $0.kind { true } else { false } }
            guard isCode == false else { return false }
            inText += probes
        }
        return inText == markdown.unicodeScalars.filter { $0 == probe }.count
    }

    /// Whether Markdown draws text of its own, as Foundation's CommonMark parser reads it. A thematic break, a
    /// link reference definition (on one line or more), an empty block quote, list item or heading and the
    /// pending mark draw none, in a block quote either; a code block draws its code. Markdown the parser cannot
    /// read counts as none, which leaves a reply unfolded.
    private static func hasSubstantiveMarkdown(_ markdown: String) -> Bool {
        guard let parsed = try? AttributedString(markdown: markdown, options: .init(interpretedSyntax: .full)) else { return false }
        return parsed.runs.contains { run in
            let isBreak = run.presentationIntent?.components.contains { $0.kind == .thematicBreak } == true
            return !isBreak && hasSubstantiveText(String(parsed[run.range].characters))
        }
    }

    /// True when `text` has visible content beyond whitespace, pending hourglass markers (`⏳`), and zero-width characters
    /// (matching the web client's `finishedWorkSplit.ts`).
    private static func hasSubstantiveText(_ text: String) -> Bool {
        let invisible: Set<Unicode.Scalar> = ["\u{23F3}", "\u{200B}", "\u{200C}", "\u{200D}", "\u{2060}", "\u{FEFF}", "\u{FE0F}"]
        return text.unicodeScalars.contains { scalar in
            !CharacterSet.whitespacesAndNewlines.contains(scalar) && !invisible.contains(scalar)
        }
    }

    /// The lines as one text: without the blank lines before and after them and the spaces that end the last
    /// one, and with one blank line where there were more. The first line loses its indentation too, unless
    /// `trimLeadingWhitespace` is false: the half of a split may start with a line of code.
    private static func normalize(_ lines: [String], trimLeadingWhitespace: Bool = true) -> String {
        let isBlank = { (line: String) in line.unicodeScalars.allSatisfy(CharacterSet.whitespacesAndNewlines.contains) }
        guard let first = lines.firstIndex(where: { !isBlank($0) }),
              let last = lines.lastIndex(where: { !isBlank($0) }) else { return "" }
        var text = lines[first...last].joined(separator: "\n")
            .replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
        if trimLeadingWhitespace { return text.trimmingCharacters(in: .whitespacesAndNewlines) }
        while let scalar = text.unicodeScalars.last, CharacterSet.whitespacesAndNewlines.contains(scalar) {
            text.unicodeScalars.removeLast()
        }
        return text
    }

    private static func prose(_ line: String) -> String {
        var text = line
        let rules: [(String, String)] = [
            (#"^\s{0,3}#{1,6}\s+"#, ""),
            (quoteMarks, ""),
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
