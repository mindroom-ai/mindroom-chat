import Foundation

/// An agent reply's Markdown as plain text for the watch, with MindRoom's tool-call lines counted.
public enum PlainText {
    /// MindRoom writes each tool call as a line "🔧 `tool_name` [n]", with a trailing ⏳ while it runs.
    private static let toolLine = try! NSRegularExpression(pattern: #"^🔧[^\S\n]*`[^`\n]+`[^\S\n]*\[\d+\](?:[^\S\n]*⏳)?[^\S\n]*$"#)

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
        var tools = 0
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
            if toolLine.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)) != nil {
                tools += 1
                continue
            }
            lines.append(prose(line))
        }
        let text = lines.joined(separator: "\n")
            .replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return (text, tools)
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
