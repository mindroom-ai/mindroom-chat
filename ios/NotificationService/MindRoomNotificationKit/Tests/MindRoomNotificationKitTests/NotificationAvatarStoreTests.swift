import MindRoomNotificationKit
import XCTest

final class NotificationAvatarStoreTests: XCTestCase {
    private var tempDir: URL!

    private static let samplePNG = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01])
    private static let sampleJPEG = Data([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10])
    private static let sampleGIF = Data([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00])
    private static let sampleWebP = Data([0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00])

    override func setUpWithError() throws {
        tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("MindRoomNotificationAvatarStoreTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        if let tempDir {
            try? FileManager.default.removeItem(at: tempDir)
        }
    }

    func testStoresAndLoadsValidImageFormatsPerAccount() {
        let store = NotificationAvatarStore(baseDirectory: tempDir)

        XCTAssertTrue(store.storeAvatar(accountTag: "acct-1", sender: "@png:x", mxcUrl: "mxc://x/1", data: Self.samplePNG))
        XCTAssertTrue(store.storeAvatar(accountTag: "acct-1", sender: "@jpg:x", mxcUrl: "mxc://x/2", data: Self.sampleJPEG))
        XCTAssertTrue(store.storeAvatar(accountTag: "acct-1", sender: "@gif:x", mxcUrl: "mxc://x/3", data: Self.sampleGIF))
        XCTAssertTrue(store.storeAvatar(accountTag: "acct-2", sender: "@webp:x", mxcUrl: "mxc://x/4", data: Self.sampleWebP))

        XCTAssertEqual(store.cachedAvatar(accountTag: "acct-1", sender: "@png:x"), Self.samplePNG)
        XCTAssertEqual(store.cachedMxcUrl(accountTag: "acct-1", sender: "@png:x"), "mxc://x/1")
        XCTAssertEqual(store.cachedAvatar(accountTag: "acct-1", sender: "@jpg:x"), Self.sampleJPEG)
        XCTAssertEqual(store.cachedAvatar(accountTag: "acct-1", sender: "@gif:x"), Self.sampleGIF)
        XCTAssertEqual(store.cachedAvatar(accountTag: "acct-2", sender: "@webp:x"), Self.sampleWebP)

        // Account isolation
        XCTAssertNil(store.cachedAvatar(accountTag: "acct-1", sender: "@webp:x"))
        XCTAssertNil(store.cachedAvatar(accountTag: "acct-2", sender: "@png:x"))
    }

    func testRejectsInvalidEmptyAndOversizedImages() {
        let store = NotificationAvatarStore(baseDirectory: tempDir)

        XCTAssertFalse(store.storeAvatar(accountTag: "acct", sender: "@empty:x", mxcUrl: "mxc://x/1", data: Data()))
        XCTAssertFalse(store.storeAvatar(accountTag: "acct", sender: "@text:x", mxcUrl: "mxc://x/2", data: Data("<html>not an image</html>".utf8)))

        var oversized = Self.samplePNG
        oversized.append(Data(repeating: 0x00, count: NotificationAvatarStore.maxAvatarBytes))
        XCTAssertFalse(store.storeAvatar(accountTag: "acct", sender: "@big:x", mxcUrl: "mxc://x/3", data: oversized))

        XCTAssertNil(store.cachedAvatar(accountTag: "acct", sender: "@empty:x"))
        XCTAssertNil(store.cachedAvatar(accountTag: "acct", sender: "@text:x"))
        XCTAssertNil(store.cachedAvatar(accountTag: "acct", sender: "@big:x"))
    }

    func testEvictsOldestEntriesBeyondLimit() {
        final class Clock: @unchecked Sendable {
            var current: Double = 100
            func next() -> Double {
                current += 1
                return current
            }
        }
        let clock = Clock()
        let store = NotificationAvatarStore(
            baseDirectory: tempDir,
            maxEntriesPerAccount: 3,
            now: { clock.next() }
        )

        XCTAssertTrue(store.storeAvatar(accountTag: "acct", sender: "@u1:x", mxcUrl: "mxc://x/1", data: Self.samplePNG))
        XCTAssertTrue(store.storeAvatar(accountTag: "acct", sender: "@u2:x", mxcUrl: "mxc://x/2", data: Self.samplePNG))
        XCTAssertTrue(store.storeAvatar(accountTag: "acct", sender: "@u3:x", mxcUrl: "mxc://x/3", data: Self.samplePNG))
        // Refresh u1 so u2 becomes oldest
        XCTAssertTrue(store.storeAvatar(accountTag: "acct", sender: "@u1:x", mxcUrl: "mxc://x/1b", data: Self.sampleJPEG))
        // Adding u4 should evict u2
        XCTAssertTrue(store.storeAvatar(accountTag: "acct", sender: "@u4:x", mxcUrl: "mxc://x/4", data: Self.samplePNG))

        XCTAssertNil(store.cachedAvatar(accountTag: "acct", sender: "@u2:x"))
        XCTAssertNil(store.cachedMxcUrl(accountTag: "acct", sender: "@u2:x"))
        XCTAssertEqual(store.cachedAvatar(accountTag: "acct", sender: "@u1:x"), Self.sampleJPEG)
        XCTAssertNotNil(store.cachedAvatar(accountTag: "acct", sender: "@u3:x"))
        XCTAssertNotNil(store.cachedAvatar(accountTag: "acct", sender: "@u4:x"))
    }

    func testRemoveClearAccountAndClearAll() {
        let store = NotificationAvatarStore(baseDirectory: tempDir)
        XCTAssertTrue(store.storeAvatar(accountTag: "a1", sender: "@u1:x", mxcUrl: "mxc://x/1", data: Self.samplePNG))
        XCTAssertTrue(store.storeAvatar(accountTag: "a1", sender: "@u2:x", mxcUrl: "mxc://x/2", data: Self.samplePNG))
        XCTAssertTrue(store.storeAvatar(accountTag: "a2", sender: "@u3:x", mxcUrl: "mxc://x/3", data: Self.samplePNG))

        store.removeAvatar(accountTag: "a1", sender: "@u1:x")
        XCTAssertNil(store.cachedAvatar(accountTag: "a1", sender: "@u1:x"))
        XCTAssertNotNil(store.cachedAvatar(accountTag: "a1", sender: "@u2:x"))

        store.clearAccount(accountTag: "a1")
        XCTAssertNil(store.cachedAvatar(accountTag: "a1", sender: "@u2:x"))
        XCTAssertNotNil(store.cachedAvatar(accountTag: "a2", sender: "@u3:x"))

        store.clearAll()
        XCTAssertNil(store.cachedAvatar(accountTag: "a2", sender: "@u3:x"))
    }
}
