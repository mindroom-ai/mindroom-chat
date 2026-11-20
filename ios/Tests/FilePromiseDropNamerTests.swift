import UIKit
import WebKit
import XCTest
@testable import RoutingHost

/// What WebKit's drop delegate sees: the names of the dropped items as it reads the drop.
private final class WebKitDrop: NSObject, UIDropInteractionDelegate {
    var namesAtDrop: [String?]?
    var entered = false

    func dropInteraction(_ interaction: UIDropInteraction, sessionDidEnter session: UIDropSession) {
        entered = true
    }

    func dropInteraction(_ interaction: UIDropInteraction, performDrop session: UIDropSession) {
        namesAtDrop = session.items.map(\.itemProvider.suggestedName)
    }
}

private final class DropSession: NSObject, UIDropSession {
    let items: [UIDragItem]
    let progress = Progress()
    let localDragSession: UIDragSession? = nil
    var progressIndicatorStyle = UIDropSessionProgressIndicatorStyle.none
    let allowsMoveOperation = true
    let isRestrictedToDraggingApplication = false

    init(_ providers: [NSItemProvider]) {
        items = providers.map(UIDragItem.init(itemProvider:))
    }

    func location(in view: UIView) -> CGPoint { .zero }
    func hasItemsConforming(toTypeIdentifiers typeIdentifiers: [String]) -> Bool { false }
    func canLoadObjects(ofClass aClass: NSItemProviderReading.Type) -> Bool { false }
    func loadObjects(
        ofClass aClass: NSItemProviderReading.Type, completion: @escaping ([NSItemProviderReading]) -> Void
    ) -> Progress { progress }
}

@MainActor
final class FilePromiseDropNamerTests: XCTestCase {
    private let webKit = WebKitDrop()

    /// A file promise as Mac Catalyst hands it over: the file's type and the promise, and no name.
    private func promise() -> NSItemProvider {
        let provider = NSItemProvider()
        for type in ["com.apple.quicktime-movie", FilePromiseDropNamer.promiseType] {
            provider.registerDataRepresentation(forTypeIdentifier: type, visibility: .all) { completion in
                completion(Data(), nil)
                return nil
            }
        }
        return provider
    }

    private func drop(_ providers: [NSItemProvider]) -> [String?]? {
        let namer = FilePromiseDropNamer(standingInFor: webKit)
        namer.dropInteraction(UIDropInteraction(delegate: namer), performDrop: DropSession(providers))
        return webKit.namesAtDrop
    }

    override func tearDown() {
        UIPasteboard.remove(withName: FilePromiseDropNamer.dragPasteboard)
        super.tearDown()
    }

    private func propose(_ name: String) throws {
        let board = try XCTUnwrap(UIPasteboard(name: FilePromiseDropNamer.dragPasteboard, create: true))
        board.setData(Data(name.utf8), forPasteboardType: FilePromiseDropNamer.proposedNameType)
    }

    func testAFilePromiseHasItsProposedNameWhenWebKitReadsTheDrop() throws {
        try propose("Example recording.mov")

        XCTAssertEqual(drop([promise()]), ["Example recording.mov"])
    }

    func testAProposedNameReachesWebKitAsOneFileNameOrNotAtAll() throws {
        // WebKit puts the name in a path of its own: the drag's source must not choose the folder.
        let names = [
            "Example 11.35.49\u{202F}AM.mov": "Example 11.35.49\u{202F}AM.mov",
            "../../example/Example.mov": "Example.mov", "/example/Example.mov": "Example.mov",
            "example/..": "File", "..": "File", ".": "File", "/": "File", "  ": "File",
            "Example\u{0}.mov": "File", "Example\nrecording.mov": "File", "Example\u{7F}.mov": "File",
        ]
        for (proposed, expected) in names {
            try propose(proposed)
            XCTAssertEqual(drop([promise()]), [expected], "for \(proposed.debugDescription)")
        }
    }

    func testAFilePromiseWithoutAProposedNameStillGetsAName() {
        XCTAssertEqual(drop([promise()]), ["File"])
    }

    func testOnlyUnnamedFilePromisesAreNamed() {
        // Dragged text must not reach the page as a file, and a named file keeps its name.
        let text = NSItemProvider(object: "example" as NSString)
        let named = promise()
        named.suggestedName = "example.mov"

        XCTAssertEqual(drop([text, named]), [nil, "example.mov"])
    }

    func testTheWebViewKeepsOneDropInteractionWhichTheNamerOwns() async throws {
        let (_, webView) = try await loadNativeTestFixture()
        let content = try XCTUnwrap(webView.scrollView.subviews.first { $0.interactions.contains { $0 is UIDropInteraction } })
        // The delegates of the content's drop interactions, bar those of `other`.
        let other = UIDropInteraction(delegate: self.webKit)
        let drops = {
            content.interactions.compactMap { $0 as? UIDropInteraction }.filter { $0 !== other }.map(\.delegate)
        }
        let webKit = try XCTUnwrap(drops().first ?? nil)
        XCTAssertTrue(webKit === content, "WebKit's content view is its own drop delegate")
        // A drop interaction that is not WebKit's stays through every install.
        content.addInteraction(other)

        let namer = try XCTUnwrap(FilePromiseDropNamer.install(in: webView))
        XCTAssertTrue(drops().count == 1 && drops()[0] === namer)
        XCTAssertNil(FilePromiseDropNamer.install(in: webView), "a namer stands in already")

        // WebKit adds its own interaction again as it restarts the page's process.
        content.addInteraction(UIDropInteraction(delegate: webKit))
        let next = try XCTUnwrap(FilePromiseDropNamer.install(in: webView))
        XCTAssertTrue(drops().count == 1 && drops()[0] === next)
        XCTAssertTrue(content.interactions.contains { $0 === other })
    }

    func testEveryOtherCallReachesWebKit() {
        let namer: UIDropInteractionDelegate = FilePromiseDropNamer(standingInFor: webKit)
        namer.dropInteraction?(UIDropInteraction(delegate: namer), sessionDidEnter: DropSession([]))

        XCTAssertTrue(webKit.entered)
        XCTAssertFalse(namer.responds(to: #selector(UIDropInteractionDelegate.dropInteraction(_:concludeDrop:))))
    }
}
