import Foundation

/// Strips Markdown and Matrix/MindRoom noise from notification bodies on-device.
public enum NotificationMarkdown {
    private static let maxInlineInputLength = 2000

    private static let toolCallMarkerRegex = try! NSRegularExpression(
        pattern: #"^🔧[^\S\n]*`[^`\n]+`[^\S\n]*\[\d+\](?:[^\S\n]*⏳)?[^\S\n]*$"#
    )
    private static let openingFenceRegex = try! NSRegularExpression(
        pattern: #"^\s*(`{3,}|~{3,})(.*)$"#
    )
    private static let tableDelimiterRegex = try! NSRegularExpression(
        pattern: #"^\s*\|(?:\s*:?-+:?\s*\|)+\s*$"#
    )
    private static let horizontalRuleRegex = try! NSRegularExpression(
        pattern: #"^\s*(?:[-*_]\s*){3,}\s*$"#
    )
    private static let atxHeadingRegex = try! NSRegularExpression(
        pattern: #"^\s{0,3}#{1,6}\s+"#
    )
    private static let blockquotePrefixRegex = try! NSRegularExpression(
        pattern: #"^\s*(?:>\s?)+"#
    )
    private static let unorderedBulletRegex = try! NSRegularExpression(
        pattern: #"^\s*[-*+]\s+"#
    )
    private static let imageRegex = try! NSRegularExpression(
        pattern: #"!\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)"#
    )
    private static let linkRegex = try! NSRegularExpression(
        pattern: #"\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)"#
    )
    private static let boldItalicRegex = try! NSRegularExpression(
        pattern: #"(?<![\w*])\*\*\*([^\s*](?:.*?[^\s*])?)\*\*\*(?![\w*])"#
    )
    private static let boldRegex = try! NSRegularExpression(
        pattern: #"(?<![\w*])\*\*([^\s*](?:.*?[^\s*])?)\*\*(?![\w*])"#
    )
    private static let italicRegex = try! NSRegularExpression(
        pattern: #"(?<![\w*])\*([^\s*](?:.*?[^\s*])?)\*(?![\w*])"#
    )
    private static let strikethroughRegex = try! NSRegularExpression(
        pattern: #"~~([^\s~](?:.*?[^\s~])?)~~"#
    )
    private static let inlineCodeRegex = try! NSRegularExpression(
        pattern: #"`([^`\n]+)`"#
    )
    private static let horizontalWhitespaceRegex = try! NSRegularExpression(
        pattern: #"[ \t]+"#
    )

    public static func strip(_ text: String) -> String {
        guard !text.isEmpty else { return "" }

        let normalized = text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")

        let withoutReply = stripMatrixReplyFallback(normalized)
        let withoutTools = stripToolCallMarkersOutsideFences(withoutReply)
        let capped = withoutTools.count > maxInlineInputLength
            ? String(withoutTools.prefix(maxInlineInputLength))
            : withoutTools

        let lines = capped.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var outputLines: [String] = []
        var activeFence: (char: Character, length: Int)?

        for line in lines {
            if let fence = activeFence {
                if isClosingFence(line, char: fence.char, minLength: fence.length) {
                    activeFence = nil
                } else {
                    let cleaned = normalizeWhitespace(line)
                    if !cleaned.isEmpty {
                        outputLines.append(cleaned)
                    }
                }
                continue
            }

            if let opening = parseOpeningFence(line) {
                activeFence = opening
                continue
            }

            if matches(tableDelimiterRegex, in: line) || matches(horizontalRuleRegex, in: line) {
                continue
            }

            if let tableRow = formatPipeTableRow(line) {
                if !tableRow.isEmpty {
                    outputLines.append(tableRow)
                }
                continue
            }

            var current = replace(blockquotePrefixRegex, in: line, with: "")
            if matches(horizontalRuleRegex, in: current) {
                continue
            }
            current = replace(atxHeadingRegex, in: current, with: "")
            current = replace(unorderedBulletRegex, in: current, with: "• ")
            current = stripInlineMarkdown(current)
            current = normalizeWhitespace(current)

            if !current.isEmpty {
                outputLines.append(current)
            }
        }

        return outputLines
            .joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func stripMatrixReplyFallback(_ text: String) -> String {
        guard text.hasPrefix("> <@") else { return text }
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        var index = 1
        while index < lines.count {
            let line = lines[index]
            if line.hasPrefix("> ") || line == ">" {
                index += 1
                continue
            }
            if line.isEmpty {
                let remainder = lines[(index + 1)...].joined(separator: "\n")
                return remainder.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? text
                    : remainder
            }
            return text
        }
        return text
    }

    private static func stripToolCallMarkersOutsideFences(_ text: String) -> String {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var kept: [String] = []
        var activeFence: (char: Character, length: Int)?

        for line in lines {
            if let fence = activeFence {
                if isClosingFence(line, char: fence.char, minLength: fence.length) {
                    activeFence = nil
                }
                kept.append(line)
                continue
            }

            if let opening = parseOpeningFence(line) {
                activeFence = opening
                kept.append(line)
                continue
            }

            if matches(toolCallMarkerRegex, in: line) {
                continue
            }

            kept.append(line)
        }

        return kept.joined(separator: "\n")
    }

    private static func parseOpeningFence(_ line: String) -> (char: Character, length: Int)? {
        let range = NSRange(line.startIndex..<line.endIndex, in: line)
        guard let match = openingFenceRegex.firstMatch(in: line, range: range),
              let markerRange = Range(match.range(at: 1), in: line),
              let infoRange = Range(match.range(at: 2), in: line),
              let firstChar = line[markerRange].first else {
            return nil
        }
        let info = line[infoRange]
        // CommonMark: backtick fence info strings may not contain backticks (keeps ```inline``` literal).
        if firstChar == "`" && info.contains("`") {
            return nil
        }
        return (char: firstChar, length: line[markerRange].count)
    }

    private static func isClosingFence(_ line: String, char: Character, minLength: Int) -> Bool {
        let trimmed = line.trimmingCharacters(in: CharacterSet(charactersIn: " \t"))
        guard trimmed.count >= minLength else { return false }
        return trimmed.allSatisfy { $0 == char }
    }

    private static func formatPipeTableRow(_ line: String) -> String? {
        let trimmed = line.trimmingCharacters(in: CharacterSet(charactersIn: " \t"))
        guard trimmed.count >= 2, trimmed.hasPrefix("|"), trimmed.hasSuffix("|") else {
            return nil
        }
        let inner = trimmed.dropFirst().dropLast()
        let cells = inner
            .split(separator: "|", omittingEmptySubsequences: false)
            .map { cell -> String in
                normalizeWhitespace(stripInlineMarkdown(String(cell)))
            }
            .filter { !$0.isEmpty }
        return cells.joined(separator: " · ")
    }

    private static func stripInlineMarkdown(_ line: String) -> String {
        var result = line
        result = replace(imageRegex, in: result, with: "$1")
        result = replace(linkRegex, in: result, with: "$1")
        result = replace(boldItalicRegex, in: result, with: "$1")
        result = replace(boldRegex, in: result, with: "$1")
        result = replace(italicRegex, in: result, with: "$1")
        result = replace(strikethroughRegex, in: result, with: "$1")
        result = replace(inlineCodeRegex, in: result, with: "$1")
        return result
    }

    private static func normalizeWhitespace(_ line: String) -> String {
        replace(horizontalWhitespaceRegex, in: line, with: " ")
            .trimmingCharacters(in: CharacterSet(charactersIn: " \t"))
    }

    private static func matches(_ regex: NSRegularExpression, in string: String) -> Bool {
        let range = NSRange(string.startIndex..<string.endIndex, in: string)
        return regex.firstMatch(in: string, range: range) != nil
    }

    private static func replace(
        _ regex: NSRegularExpression,
        in string: String,
        with template: String
    ) -> String {
        let range = NSRange(string.startIndex..<string.endIndex, in: string)
        return regex.stringByReplacingMatches(in: string, range: range, withTemplate: template)
    }
}
