import MindRoomNotificationKit
import XCTest

final class NotificationAvatarStoreTests: XCTestCase {
    private var tempDir: URL!

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

        XCTAssertTrue(store.storeAvatar(accountTag: "acct-1", sender: "@png:x", mxcUrl: "mxc://x/1", data: TestImageFixtures.samplePNG))
        XCTAssertTrue(store.storeAvatar(accountTag: "acct-1", sender: "@jpg:x", mxcUrl: "mxc://x/2", data: TestImageFixtures.sampleJPEG))
        XCTAssertTrue(store.storeAvatar(accountTag: "acct-1", sender: "@gif:x", mxcUrl: "mxc://x/3", data: TestImageFixtures.sampleGIF))
        XCTAssertTrue(store.storeAvatar(accountTag: "acct-2", sender: "@webp:x", mxcUrl: "mxc://x/4", data: TestImageFixtures.sampleWebP))

        XCTAssertEqual(store.cachedAvatar(accountTag: "acct-1", sender: "@png:x"), TestImageFixtures.samplePNG)
        XCTAssertEqual(store.cachedMxcUrl(accountTag: "acct-1", sender: "@png:x"), "mxc://x/1")
        XCTAssertEqual(store.cachedAvatar(accountTag: "acct-1", sender: "@jpg:x"), TestImageFixtures.sampleJPEG)
        XCTAssertEqual(store.cachedAvatar(accountTag: "acct-1", sender: "@gif:x"), TestImageFixtures.sampleGIF)
        XCTAssertEqual(store.cachedAvatar(accountTag: "acct-2", sender: "@webp:x"), TestImageFixtures.sampleWebP)

        // Account isolation
        XCTAssertNil(store.cachedAvatar(accountTag: "acct-1", sender: "@webp:x"))
        XCTAssertNil(store.cachedAvatar(accountTag: "acct-2", sender: "@png:x"))
    }

    func testRejectsInvalidEmptyOversizedAndDecompressionBombImages() {
        let store = NotificationAvatarStore(baseDirectory: tempDir)

        XCTAssertFalse(store.storeAvatar(accountTag: "acct", sender: "@empty:x", mxcUrl: "mxc://x/1", data: Data()))
        XCTAssertFalse(store.storeAvatar(accountTag: "acct", sender: "@text:x", mxcUrl: "mxc://x/2", data: Data("<html>not an image</html>".utf8)))

        // Truncated magic bytes with no valid image dimensions
        let truncatedPNG = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01])
        XCTAssertFalse(store.storeAvatar(accountTag: "acct", sender: "@trunc:x", mxcUrl: "mxc://x/3", data: truncatedPNG))

        // Decompression bomb header (5000x5000 exceeds 2048 max dimension / 4M pixels)
        XCTAssertFalse(store.storeAvatar(accountTag: "acct", sender: "@bomb:x", mxcUrl: "mxc://x/4", data: TestImageFixtures.bomb5000x5000PNG))

        // One pixel wider than the largest picture the extension may decode
        XCTAssertEqual(TestImageFixtures.imageDimensions(of: TestImageFixtures.wide2049PNG)?.width, 2049)
        XCTAssertFalse(NotificationAvatarStore.isValidImageData(TestImageFixtures.wide2049PNG))
        XCTAssertFalse(store.storeAvatar(accountTag: "acct", sender: "@wide:x", mxcUrl: "mxc://x/6", data: TestImageFixtures.wide2049PNG))

        var oversized = TestImageFixtures.samplePNG
        oversized.append(Data(repeating: 0x00, count: NotificationAvatarStore.maxAvatarBytes))
        XCTAssertFalse(store.storeAvatar(accountTag: "acct", sender: "@big:x", mxcUrl: "mxc://x/5", data: oversized))

        XCTAssertNil(store.cachedAvatar(accountTag: "acct", sender: "@empty:x"))
        XCTAssertNil(store.cachedAvatar(accountTag: "acct", sender: "@text:x"))
        XCTAssertNil(store.cachedAvatar(accountTag: "acct", sender: "@trunc:x"))
        XCTAssertNil(store.cachedAvatar(accountTag: "acct", sender: "@bomb:x"))
        XCTAssertNil(store.cachedAvatar(accountTag: "acct", sender: "@big:x"))
        XCTAssertNil(store.cachedAvatar(accountTag: "acct", sender: "@wide:x"))
    }

    func testKeepsAMemberAvatarPerRoom() {
        let store = NotificationAvatarStore(baseDirectory: tempDir)
        let sender = "@agent:x"

        XCTAssertTrue(store.storeAvatar(accountTag: "acct", roomId: "!a:x", sender: sender, mxcUrl: "mxc://x/in-a", data: TestImageFixtures.samplePNG))
        XCTAssertTrue(store.storeAvatar(accountTag: "acct", roomId: "!b:x", sender: sender, mxcUrl: "mxc://x/in-b", data: TestImageFixtures.sampleJPEG))

        XCTAssertEqual(store.cachedAvatar(accountTag: "acct", roomId: "!a:x", sender: sender), TestImageFixtures.samplePNG)
        XCTAssertEqual(store.cachedMxcUrl(accountTag: "acct", roomId: "!a:x", sender: sender), "mxc://x/in-a")
        XCTAssertEqual(store.cachedAvatar(accountTag: "acct", roomId: "!b:x", sender: sender), TestImageFixtures.sampleJPEG)
        XCTAssertEqual(store.cachedMxcUrl(accountTag: "acct", roomId: "!b:x", sender: sender), "mxc://x/in-b")

        // Another room, and a caller that names no room, get neither room's avatar.
        XCTAssertNil(store.cachedAvatar(accountTag: "acct", roomId: "!c:x", sender: sender))
        XCTAssertNil(store.cachedMxcUrl(accountTag: "acct", roomId: "!c:x", sender: sender))
        XCTAssertNil(store.cachedAvatar(accountTag: "acct", sender: sender))
        XCTAssertNil(store.cachedMxcUrl(accountTag: "acct", sender: sender))

        // The room and the sender do not run into each other.
        XCTAssertNil(store.cachedAvatar(accountTag: "acct", roomId: "!a:x@agent", sender: ":x"))

        store.removeAvatar(accountTag: "acct", roomId: "!a:x", sender: sender)
        XCTAssertNil(store.cachedAvatar(accountTag: "acct", roomId: "!a:x", sender: sender))
        XCTAssertNil(store.cachedMxcUrl(accountTag: "acct", roomId: "!a:x", sender: sender))
        XCTAssertEqual(store.cachedAvatar(accountTag: "acct", roomId: "!b:x", sender: sender), TestImageFixtures.sampleJPEG)

        store.clearAccount(accountTag: "acct")
        XCTAssertNil(store.cachedAvatar(accountTag: "acct", roomId: "!b:x", sender: sender))
    }

    func testDownsamplesLargeValidImageToMaxStoredPixelSize() throws {
        let store = NotificationAvatarStore(baseDirectory: tempDir)
        let originalDims = try XCTUnwrap(TestImageFixtures.imageDimensions(of: TestImageFixtures.large512PNG))
        XCTAssertEqual(originalDims.width, 512)
        XCTAssertEqual(originalDims.height, 512)

        XCTAssertTrue(store.storeAvatar(accountTag: "acct", sender: "@hd:x", mxcUrl: "mxc://x/hd", data: TestImageFixtures.large512PNG))
        let stored = try XCTUnwrap(store.cachedAvatar(accountTag: "acct", sender: "@hd:x"))
        let storedDims = try XCTUnwrap(TestImageFixtures.imageDimensions(of: stored))
        XCTAssertLessThanOrEqual(storedDims.width, NotificationAvatarStore.maxStoredPixelSize)
        XCTAssertLessThanOrEqual(storedDims.height, NotificationAvatarStore.maxStoredPixelSize)
    }

    func testFlattensAnImageOfSeveralFramesToOne() throws {
        let store = NotificationAvatarStore(baseDirectory: tempDir)
        XCTAssertEqual(TestImageFixtures.frameCount(of: TestImageFixtures.twoFrameGIF), 2)

        // Small enough to be kept as it is, were it a single frame.
        let flattened = try XCTUnwrap(NotificationAvatarStore.validatedImageData(TestImageFixtures.twoFrameGIF))
        XCTAssertEqual(TestImageFixtures.frameCount(of: flattened), 1)

        XCTAssertTrue(store.storeAvatar(accountTag: "acct", sender: "@anim:x", mxcUrl: "mxc://x/anim", data: TestImageFixtures.twoFrameGIF))
        let stored = try XCTUnwrap(store.cachedAvatar(accountTag: "acct", sender: "@anim:x"))
        XCTAssertEqual(TestImageFixtures.frameCount(of: stored), 1)

        // A single frame of that size stays byte for byte.
        XCTAssertEqual(NotificationAvatarStore.validatedImageData(TestImageFixtures.sampleGIF), TestImageFixtures.sampleGIF)
    }

    func testReconcileKeepsOnlyTheListedAvatarsOfTheirCurrentUrl() throws {
        let store = NotificationAvatarStore(baseDirectory: tempDir)
        let png = TestImageFixtures.samplePNG
        XCTAssertTrue(store.storeAvatar(accountTag: "acct", roomId: "!a:x", sender: "@keep:x", mxcUrl: "mxc://x/keep", data: png))
        XCTAssertTrue(store.storeAvatar(accountTag: "acct", roomId: "!a:x", sender: "@changed:x", mxcUrl: "mxc://x/old", data: png))
        XCTAssertTrue(store.storeAvatar(accountTag: "acct", roomId: "!a:x", sender: "@removed:x", mxcUrl: "mxc://x/removed", data: png))
        XCTAssertTrue(store.storeAvatar(accountTag: "acct", roomId: "!b:x", sender: "@capped:x", mxcUrl: "mxc://x/capped", data: png))

        // Files the manifest never listed, as a write that was cut short leaves them.
        let accountDirs = try FileManager.default.contentsOfDirectory(at: tempDir, includingPropertiesForKeys: nil)
        XCTAssertEqual(accountDirs.count, 1)
        let accountDir = try XCTUnwrap(accountDirs.first)
        try png.write(to: accountDir.appendingPathComponent("unlisted.img"))
        try png.write(to: accountDir.appendingPathComponent("leftover.tmp"))

        XCTAssertTrue(store.storeAvatar(accountTag: "other", roomId: "!a:x", sender: "@removed:x", mxcUrl: "mxc://x/removed", data: png))

        store.reconcileAccount(
            accountTag: "acct",
            desiredEntries: [
                (roomId: "!a:x", sender: "@keep:x", mxcUrl: "mxc://x/keep"),
                // Its avatar changed; the new one is not downloaded yet, and may never be.
                (roomId: "!a:x", sender: "@changed:x", mxcUrl: "mxc://x/new"),
                (roomId: "!a:x", sender: "@new:x", mxcUrl: "mxc://x/brand-new"),
            ]
        )

        XCTAssertEqual(store.cachedAvatar(accountTag: "acct", roomId: "!a:x", sender: "@keep:x"), png)
        XCTAssertEqual(store.cachedMxcUrl(accountTag: "acct", roomId: "!a:x", sender: "@keep:x"), "mxc://x/keep")
        // Changed, removed, and dropped from the list (as by its cap): none of them is shown again.
        XCTAssertNil(store.cachedAvatar(accountTag: "acct", roomId: "!a:x", sender: "@changed:x"))
        XCTAssertNil(store.cachedMxcUrl(accountTag: "acct", roomId: "!a:x", sender: "@changed:x"))
        XCTAssertNil(store.cachedAvatar(accountTag: "acct", roomId: "!a:x", sender: "@removed:x"))
        XCTAssertNil(store.cachedAvatar(accountTag: "acct", roomId: "!b:x", sender: "@capped:x"))
        XCTAssertNil(store.cachedAvatar(accountTag: "acct", roomId: "!a:x", sender: "@new:x"))

        // Only the manifest and the avatar that stays are left.
        let remaining = try FileManager.default.contentsOfDirectory(at: accountDir, includingPropertiesForKeys: nil)
        XCTAssertEqual(remaining.count, 2)
        XCTAssertTrue(remaining.contains { $0.lastPathComponent == "manifest.json" })
        XCTAssertFalse(remaining.contains { $0.lastPathComponent == "unlisted.img" })
        XCTAssertFalse(remaining.contains { $0.lastPathComponent == "leftover.tmp" })

        // Another account is not touched, and an account without a cache gets none.
        XCTAssertEqual(store.cachedAvatar(accountTag: "other", roomId: "!a:x", sender: "@removed:x"), png)
        store.reconcileAccount(accountTag: "never-cached", desiredEntries: [(roomId: "!a:x", sender: "@keep:x", mxcUrl: "mxc://x/keep")])
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(at: tempDir, includingPropertiesForKeys: nil).count, 2)

        // An empty list empties the account.
        store.reconcileAccount(accountTag: "acct", desiredEntries: [])
        XCTAssertNil(store.cachedAvatar(accountTag: "acct", roomId: "!a:x", sender: "@keep:x"))
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

        XCTAssertTrue(store.storeAvatar(accountTag: "acct", sender: "@u1:x", mxcUrl: "mxc://x/1", data: TestImageFixtures.samplePNG))
        XCTAssertTrue(store.storeAvatar(accountTag: "acct", sender: "@u2:x", mxcUrl: "mxc://x/2", data: TestImageFixtures.samplePNG))
        XCTAssertTrue(store.storeAvatar(accountTag: "acct", sender: "@u3:x", mxcUrl: "mxc://x/3", data: TestImageFixtures.samplePNG))
        // Refresh u1 so u2 becomes oldest
        XCTAssertTrue(store.storeAvatar(accountTag: "acct", sender: "@u1:x", mxcUrl: "mxc://x/1b", data: TestImageFixtures.sampleJPEG))
        // Adding u4 should evict u2
        XCTAssertTrue(store.storeAvatar(accountTag: "acct", sender: "@u4:x", mxcUrl: "mxc://x/4", data: TestImageFixtures.samplePNG))

        XCTAssertNil(store.cachedAvatar(accountTag: "acct", sender: "@u2:x"))
        XCTAssertNil(store.cachedMxcUrl(accountTag: "acct", sender: "@u2:x"))
        XCTAssertEqual(store.cachedAvatar(accountTag: "acct", sender: "@u1:x"), TestImageFixtures.sampleJPEG)
        XCTAssertNotNil(store.cachedAvatar(accountTag: "acct", sender: "@u3:x"))
        XCTAssertNotNil(store.cachedAvatar(accountTag: "acct", sender: "@u4:x"))
    }

    func testRemoveClearAccountAndClearAll() {
        let store = NotificationAvatarStore(baseDirectory: tempDir)
        XCTAssertTrue(store.storeAvatar(accountTag: "a1", sender: "@u1:x", mxcUrl: "mxc://x/1", data: TestImageFixtures.samplePNG))
        XCTAssertTrue(store.storeAvatar(accountTag: "a1", sender: "@u2:x", mxcUrl: "mxc://x/2", data: TestImageFixtures.samplePNG))
        XCTAssertTrue(store.storeAvatar(accountTag: "a2", sender: "@u3:x", mxcUrl: "mxc://x/3", data: TestImageFixtures.samplePNG))

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
