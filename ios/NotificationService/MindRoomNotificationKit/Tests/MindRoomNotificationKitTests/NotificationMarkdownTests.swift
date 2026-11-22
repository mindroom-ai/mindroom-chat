import MindRoomNotificationKit
import XCTest

final class NotificationMarkdownTests: XCTestCase {
    func testStripsMatrixRichReplyFallbackOnlyWithPrefixAndBlankLine() {
        let reply = """
        > <@alice:mindroom.chat> Original question
        > second line
        >

        Here is **my** answer.
        """
        XCTAssertEqual(NotificationMarkdown.strip(reply), "Here is my answer.")

        // Regular blockquote not starting with `> <@` is kept (with `> ` stripped).
        let quote = """
        > A normal quote

        Follow-up
        """
        XCTAssertEqual(NotificationMarkdown.strip(quote), "A normal quote\nFollow-up")

        // Rich reply prefix without separating blank line is not dropped blindly.
        let malformed = "> <@alice:mindroom.chat> Only fallback line"
        XCTAssertEqual(NotificationMarkdown.strip(malformed), "<@alice:mindroom.chat> Only fallback line")
    }

    func testDropsToolCallMarkersOutsideCodeFencesOnly() {
        let input = """
        Let me check.

        🔧 `web_search` [1]
        🔧 `read_file` [2] ⏳

        ```
        🔧 `inside_fence` [3]
        ```

        Done!
        """
        XCTAssertEqual(
            NotificationMarkdown.strip(input),
            "Let me check.\n🔧 `inside_fence` [3]\nDone!"
        )
    }

    func testCodeFencesDropDelimitersAndKeepCodeLiteral() {
        let input = """
        Here is code:

        ```swift
        # not a heading
        let x = **not bold**
        - not a bullet
        ```

        ~~~python
        def __init__(self):
            return x**2
        ~~~
        """
        XCTAssertEqual(
            NotificationMarkdown.strip(input),
            "Here is code:\n# not a heading\nlet x = **not bold**\n- not a bullet\ndef __init__(self):\nreturn x**2"
        )
    }

    func testTablesHorizontalRulesHeadingsQuotesAndLists() {
        let input = """
        ## Summary

        | Agent | Status |
        | :--- | ---: |
        | **Code** | `Ready` |
        | [Docs](https://mindroom.chat) | Done |

        ---
        * * *
        ___

        > > Nested quote
        - First item
        * Second item
        + Third item
        """
        XCTAssertEqual(
            NotificationMarkdown.strip(input),
            "Summary\nAgent · Status\nCode · Ready\nDocs · Done\nNested quote\n• First item\n• Second item\n• Third item"
        )
    }

    func testLinksImagesAndBalancedParentheses() {
        let input = "See ![Diagram](https://example.com/a(1).png) and [Swift](https://en.wikipedia.org/wiki/Swift_(programming_language))."
        XCTAssertEqual(NotificationMarkdown.strip(input), "See Diagram and Swift.")
    }

    func testEmphasisMathAndUnderscores() {
        XCTAssertEqual(
            NotificationMarkdown.strip("***bold italic*** and **bold** and *italic*"),
            "bold italic and bold and italic"
        )
        XCTAssertEqual(
            NotificationMarkdown.strip("Compute x**2 + y**2 and 2*3*4 quickly"),
            "Compute x**2 + y**2 and 2*3*4 quickly"
        )
        XCTAssertEqual(
            NotificationMarkdown.strip("Keep snake_case and __init__ and _private_ literal"),
            "Keep snake_case and __init__ and _private_ literal"
        )
        XCTAssertEqual(
            NotificationMarkdown.strip("Remove ~~old~~ and use `new_fn()`"),
            "Remove old and use new_fn()"
        )
    }

    func testNormalizesWhitespaceAndCapsLongInput() {
        let input = "  Hello\t\tworld   \n\n\n   Next   line  "
        XCTAssertEqual(NotificationMarkdown.strip(input), "Hello world\nNext line")

        let huge = String(repeating: "**a** ", count: 1000)
        let stripped = NotificationMarkdown.strip(huge)
        XCTAssertFalse(stripped.isEmpty)
        XCTAssertLessThanOrEqual(stripped.count, 2000)
    }
}
