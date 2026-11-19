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

    func testAFilePromiseHasItsProposedNameWhenWebKitReadsTheDrop() throws {
        let board = try XCTUnwrap(UIPasteboard(name: FilePromiseDropNamer.dragPasteboard, create: true))
        board.setData(Data("Example recording.mov".utf8), forPasteboardType: FilePromiseDropNamer.proposedNameType)

        XCTAssertEqual(drop([promise()]), ["Example recording.mov"])
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
        let drops = { content.interactions.compactMap { $0 as? UIDropInteraction } }
        let webKit = try XCTUnwrap(drops().first?.delegate)

        let namer = try XCTUnwrap(FilePromiseDropNamer.install(in: webView))
        XCTAssertTrue(drops().count == 1 && drops()[0].delegate === namer)
        // Each change of the page's loading installs again: the namer in place stays, alone.
        XCTAssertNil(FilePromiseDropNamer.install(in: webView), "a namer stands in already")
        XCTAssertNil(FilePromiseDropNamer.install(in: webView))
        XCTAssertTrue(drops().count == 1 && drops()[0].delegate === namer)

        // WebKit adds its own interaction again as it restarts the page's process.
        content.addInteraction(UIDropInteraction(delegate: webKit))
        let next = try XCTUnwrap(FilePromiseDropNamer.install(in: webView))
        XCTAssertTrue(drops().count == 1 && drops()[0].delegate === next)
    }

    func testEveryOtherCallReachesWebKit() {
        let namer: UIDropInteractionDelegate = FilePromiseDropNamer(standingInFor: webKit)
        namer.dropInteraction?(UIDropInteraction(delegate: namer), sessionDidEnter: DropSession([]))

        XCTAssertTrue(webKit.entered)
        XCTAssertFalse(namer.responds(to: #selector(UIDropInteractionDelegate.dropInteraction(_:concludeDrop:))))
    }
}
