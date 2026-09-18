import Foundation
import XCTest
@testable import RoutingHost

final class NativeDiagnosticsStoreTests: XCTestCase {
    private let firstSession = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
    private let secondSession = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
    private var temporaryDirectories: [URL] = []

    override func tearDownWithError() throws {
        for directory in temporaryDirectories {
            try? FileManager.default.removeItem(at: directory)
        }
        temporaryDirectories = []
        try super.tearDownWithError()
    }

    private func temporaryDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("mindroom-native-diagnostics-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        temporaryDirectories.append(directory)
        return directory
    }

    private func makeStore(
        directory: URL,
        sessionId: UUID,
        atomicWrite: @escaping MindRoomDiagnosticsStore.AtomicWrite = MindRoomDiagnosticsStore.defaultAtomicWrite
    ) -> MindRoomDiagnosticsStore {
        var wallClockMilliseconds = 1_750_000_000_000.0
        var monotonicMilliseconds = 10_000.0
        return MindRoomDiagnosticsStore(
            directoryURL: directory,
            currentSessionId: sessionId,
            wallClockMilliseconds: {
                wallClockMilliseconds += 1
                return wallClockMilliseconds
            },
            monotonicMilliseconds: {
                monotonicMilliseconds += 1
                return monotonicMilliseconds
            },
            atomicWrite: atomicWrite
        )
    }

    func testRetainsNewest128EventsAndCountsDroppedEvents() throws {
        let store = makeStore(directory: try temporaryDirectory(), sessionId: firstSession)

        for _ in 0..<130 {
            store.record(name: .memoryWarning)
        }
        let snapshot = store.read()

        XCTAssertEqual(snapshot.status, .available)
        XCTAssertEqual(snapshot.events.count, 128)
        XCTAssertEqual(snapshot.events.first?.sequence, 3)
        XCTAssertEqual(snapshot.events.last?.sequence, 130)
        XCTAssertEqual(snapshot.droppedEventCount, 2)
        XCTAssertLessThanOrEqual(try JSONEncoder().encode(snapshot).count, 64 * 1_024)
    }

    func testReinstantiationLoadsPersistedEventsAndStartsANewSessionSequence() throws {
        let directory = try temporaryDirectory()
        let firstStore = makeStore(directory: directory, sessionId: firstSession)
        firstStore.record(name: .appLaunch)
        firstStore.record(name: .sceneBackground)
        XCTAssertEqual(firstStore.read().events.count, 2, "read must wait for prior writes")

        let secondStore = makeStore(directory: directory, sessionId: secondSession)
        secondStore.record(name: .appLaunch)
        let snapshot = secondStore.read()

        XCTAssertEqual(snapshot.status, .available)
        XCTAssertEqual(snapshot.currentSessionId, secondSession)
        XCTAssertEqual(snapshot.events.map(\.sessionId), [firstSession, firstSession, secondSession])
        XCTAssertEqual(snapshot.events.map(\.sequence), [1, 2, 1])
    }

    func testCorruptHistoryIsReportedWithoutExportingUntrustedBytes() throws {
        let directory = try temporaryDirectory()
        let firstStore = makeStore(directory: directory, sessionId: firstSession)
        firstStore.record(name: .appLaunch)
        _ = firstStore.read()
        let historyFile = try XCTUnwrap(
            FileManager.default.enumerator(at: directory, includingPropertiesForKeys: nil)?
                .compactMap { $0 as? URL }
                .first { $0.pathExtension == "json" }
        )
        try Data("{\"secret\":\"private-room-token\"".utf8).write(to: historyFile)

        let store = makeStore(directory: directory, sessionId: secondSession)
        let snapshot = store.read()
        let exported = String(decoding: try JSONEncoder().encode(snapshot), as: UTF8.self)

        XCTAssertEqual(snapshot.status, .corrupt)
        XCTAssertEqual(snapshot.currentSessionId, secondSession)
        XCTAssertTrue(snapshot.events.isEmpty)
        XCTAssertFalse(exported.contains("private-room-token"))
    }

    func testFailedAtomicWriteIsReportedWhileKeepingSanitizedMemoryEvidence() throws {
        struct WriteFailure: Error {}
        let store = makeStore(
            directory: try temporaryDirectory(),
            sessionId: firstSession,
            atomicWrite: { _, _ in throw WriteFailure() }
        )

        store.record(name: .sceneInactive)
        let snapshot = store.read()

        XCTAssertEqual(snapshot.status, .unavailable)
        XCTAssertEqual(snapshot.events.map(\.name), [.sceneInactive])
    }

    func testUnknownPersistedFieldsAreStrippedBeforeExport() throws {
        let directory = try temporaryDirectory()
        let firstStore = makeStore(directory: directory, sessionId: firstSession)
        firstStore.record(name: .navigationFailed, data: MindRoomDiagnosticState(errorCode: 404))
        _ = firstStore.read()
        let historyFile = try XCTUnwrap(
            FileManager.default.enumerator(at: directory, includingPropertiesForKeys: nil)?
                .compactMap { $0 as? URL }
                .first { $0.pathExtension == "json" }
        )
        var history = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: historyFile)) as? [String: Any]
        )
        var events = try XCTUnwrap(history["events"] as? [[String: Any]])
        events[0]["url"] = "capacitor://localhost/private-room?token=private-query"
        events[0]["errorDescription"] = "private-navigation-description"
        history["events"] = events
        history["futureSecretField"] = "private-cross-version-value"
        try JSONSerialization.data(withJSONObject: history).write(to: historyFile, options: .atomic)

        let snapshot = makeStore(directory: directory, sessionId: secondSession).read()
        let exported = String(decoding: try JSONEncoder().encode(snapshot), as: UTF8.self)

        XCTAssertEqual(snapshot.status, .available)
        XCTAssertEqual(snapshot.events.first?.data?.errorCode, 404)
        XCTAssertFalse(exported.contains("private"))
        XCTAssertFalse(exported.contains("capacitor://"))
    }

    func testErrorStateKeepsOnlyAllowlistedDomainAndNumericCode() throws {
        let secret = "private-room-and-query-token"
        let error = NSError(
            domain: NSURLErrorDomain,
            code: NSURLErrorCannotFindHost,
            userInfo: [
                NSURLErrorKey: URL(string: "capacitor://localhost/\(secret)?token=\(secret)")!,
                NSLocalizedDescriptionKey: "Failed to load \(secret)"
            ]
        )
        let store = makeStore(directory: try temporaryDirectory(), sessionId: firstSession)

        store.record(name: .navigationProvisionalFailed, data: MindRoomDiagnosticState(error: error))
        let snapshot = store.read()
        let exported = String(decoding: try JSONEncoder().encode(snapshot), as: UTF8.self)

        XCTAssertEqual(snapshot.events.first?.data?.errorDomain, .url)
        XCTAssertEqual(snapshot.events.first?.data?.errorCode, NSURLErrorCannotFindHost)
        XCTAssertFalse(exported.contains(secret))
        XCTAssertFalse(exported.contains("capacitor://"))
        XCTAssertFalse(exported.contains("localizedDescription"))
    }
}
