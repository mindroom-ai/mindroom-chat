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

        let missing = store.reconcileAccount(
            accountTag: "acct",
            desiredEntries: [
                (roomId: "!a:x", sender: "@keep:x", mxcUrl: "mxc://x/keep"),
                // Its avatar changed; the new one is not downloaded yet, and may never be.
                (roomId: "!a:x", sender: "@changed:x", mxcUrl: "mxc://x/new"),
                (roomId: "!a:x", sender: "@new:x", mxcUrl: "mxc://x/brand-new"),
            ]
        )

        // What the caller has to download: not the avatar that is cached for its current URL.
        XCTAssertEqual(missing, ["mxc://x/new", "mxc://x/brand-new"])
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

        // Another account is not touched, and an account without a cache gets none: all of its
        // avatars are missing.
        XCTAssertEqual(store.cachedAvatar(accountTag: "other", roomId: "!a:x", sender: "@removed:x"), png)
        XCTAssertEqual(
            store.reconcileAccount(accountTag: "never-cached", desiredEntries: [(roomId: "!a:x", sender: "@keep:x", mxcUrl: "mxc://x/keep")]),
            ["mxc://x/keep"]
        )
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(at: tempDir, includingPropertiesForKeys: nil).count, 2)

        // An empty list empties the account, and misses nothing.
        XCTAssertEqual(store.reconcileAccount(accountTag: "acct", desiredEntries: []), [])
        XCTAssertNil(store.cachedAvatar(accountTag: "acct", roomId: "!a:x", sender: "@keep:x"))
        XCTAssertEqual(store.reconcileAccount(accountTag: "", desiredEntries: [(roomId: "!a:x", sender: "@keep:x", mxcUrl: "mxc://x/keep")]), [])
    }

    func testReconcileNamesEachMissingAvatarOnceInTheOrderOfTheList() {
        let store = NotificationAvatarStore(baseDirectory: tempDir)
        let png = TestImageFixtures.samplePNG
        XCTAssertTrue(store.storeAvatar(accountTag: "acct", roomId: "!a:x", sender: "@cached:x", mxcUrl: "mxc://x/cached", data: png))
        let desired: [(roomId: String?, sender: String, mxcUrl: String)] = [
            (roomId: "!a:x", sender: "@agent:x", mxcUrl: "mxc://x/agent"),
            (roomId: "!a:x", sender: "@cached:x", mxcUrl: "mxc://x/cached"),
            (roomId: "!a:x", sender: "@zoe:x", mxcUrl: "mxc://x/zoe"),
            // The same avatar in two more rooms, and one that is cached in another room only.
            (roomId: "!b:x", sender: "@agent:x", mxcUrl: "mxc://x/agent"),
            (roomId: "!c:x", sender: "@agent:x", mxcUrl: "mxc://x/agent"),
            (roomId: "!b:x", sender: "@cached:x", mxcUrl: "mxc://x/cached"),
        ]

        XCTAssertEqual(
            store.reconcileAccount(accountTag: "acct", desiredEntries: desired),
            ["mxc://x/agent", "mxc://x/zoe", "mxc://x/cached"]
        )

        // Stored for one room only, the avatar is still missing for the others.
        XCTAssertTrue(store.storeAvatar(accountTag: "acct", roomId: "!a:x", sender: "@agent:x", mxcUrl: "mxc://x/agent", data: png))
        XCTAssertEqual(
            store.reconcileAccount(accountTag: "acct", desiredEntries: desired),
            ["mxc://x/zoe", "mxc://x/agent", "mxc://x/cached"]
        )

        for entry in desired {
            XCTAssertTrue(store.storeAvatar(accountTag: "acct", roomId: entry.roomId, sender: entry.sender, mxcUrl: entry.mxcUrl, data: png))
        }
        XCTAssertEqual(store.reconcileAccount(accountTag: "acct", desiredEntries: desired), [])
    }

    func testReconcileMissesAnAvatarWhoseFileIsGoneOrIsNoImage() throws {
        let store = NotificationAvatarStore(baseDirectory: tempDir)
        let png = TestImageFixtures.samplePNG
        let desired: [(roomId: String?, sender: String, mxcUrl: String)] = [
            (roomId: "!a:x", sender: "@gone:x", mxcUrl: "mxc://x/gone"),
            (roomId: "!a:x", sender: "@broken:x", mxcUrl: "mxc://x/broken"),
            (roomId: "!a:x", sender: "@whole:x", mxcUrl: "mxc://x/whole"),
        ]
        for entry in desired {
            XCTAssertTrue(store.storeAvatar(accountTag: "acct", roomId: entry.roomId, sender: entry.sender, mxcUrl: entry.mxcUrl, data: png))
        }
        XCTAssertEqual(store.reconcileAccount(accountTag: "acct", desiredEntries: desired), [])

        // iOS empties `Caches` to make room, and a write can be cut short: the manifest then
        // lists what the directory does not hold.
        let accountDir = try XCTUnwrap(
            FileManager.default.contentsOfDirectory(at: tempDir, includingPropertiesForKeys: nil).first
        )
        let files = try FileManager.default.contentsOfDirectory(at: accountDir, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "img" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        XCTAssertEqual(files.count, 3)
        try FileManager.default.removeItem(at: files[0])
        try Data("<html>not an image</html>".utf8).write(to: files[1])

        let missing = store.reconcileAccount(accountTag: "acct", desiredEntries: desired)

        XCTAssertEqual(missing.count, 2)
        let cached = desired.filter { store.cachedAvatar(accountTag: "acct", roomId: $0.roomId, sender: $0.sender) != nil }
        XCTAssertEqual(cached.count, 1)
        XCTAssertEqual(Set(missing), Set(desired.map { $0.mxcUrl }).subtracting(cached.map { $0.mxcUrl }))
        // The file that is no image went, and the manifest lists neither of the two any more.
        let remaining = try FileManager.default.contentsOfDirectory(at: accountDir, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "img" }
        XCTAssertEqual(remaining.count, 1)
        let listed = desired.filter { store.cachedMxcUrl(accountTag: "acct", roomId: $0.roomId, sender: $0.sender) != nil }
        XCTAssertEqual(listed.count, 1)
    }

    func testPruneRemovesTheCacheOfEveryAccountThatIsNotKept() throws {
        let store = NotificationAvatarStore(baseDirectory: tempDir)
        let png = TestImageFixtures.samplePNG
        for accountTag in ["a1", "a2", "a3"] {
            XCTAssertTrue(store.storeAvatar(accountTag: accountTag, roomId: "!a:x", sender: "@u:x", mxcUrl: "mxc://x/u", data: png))
        }

        // A kept account without a cache gets none.
        store.pruneAccounts(keeping: ["a2", "never-cached"])

        XCTAssertNil(store.cachedAvatar(accountTag: "a1", roomId: "!a:x", sender: "@u:x"))
        XCTAssertEqual(store.cachedAvatar(accountTag: "a2", roomId: "!a:x", sender: "@u:x"), png)
        XCTAssertNil(store.cachedAvatar(accountTag: "a3", roomId: "!a:x", sender: "@u:x"))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(at: tempDir, includingPropertiesForKeys: nil).count, 1)

        store.pruneAccounts(keeping: [])
        XCTAssertNil(store.cachedAvatar(accountTag: "a2", roomId: "!a:x", sender: "@u:x"))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(at: tempDir, includingPropertiesForKeys: nil).count, 0)

        // Nothing to prune where nothing was ever cached.
        NotificationAvatarStore(baseDirectory: tempDir.appendingPathComponent("never-made")).pruneAccounts(keeping: [])
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
