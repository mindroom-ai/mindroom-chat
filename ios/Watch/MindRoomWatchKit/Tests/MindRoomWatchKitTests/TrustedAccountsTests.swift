import XCTest
@testable import MindRoomWatchKit

final class TrustedAccountsTests: XCTestCase {
    private let router = "@mindroom_router:example.org"
    private let agent = "@mindroom_helper:example.org"

    private func binding(_ content: JSON, sender: String? = nil, stateKey: String = "") -> JSON {
        ["type": "io.mindroom.router", "state_key": stateKey, "sender": sender ?? router, "content": content]
    }

    private func powerLevels(_ content: JSON) -> JSON {
        ["type": "m.room.power_levels", "state_key": "", "sender": router, "content": content]
    }

    private func create(roomVersion: Any? = "11", sender: String = "@creator:example.org", additionalCreators: [Any]? = nil) -> JSON {
        var content: JSON = [:]
        if let roomVersion { content["room_version"] = roomVersion }
        if let additionalCreators { content["additional_creators"] = additionalCreators }
        return ["type": "m.room.create", "state_key": "", "sender": sender, "content": content]
    }

    private func roster(sender: String? = nil, stateKey: String? = nil, accounts: Any = ["@mindroom_helper:example.org"]) -> JSON {
        ["type": "io.mindroom.accounts", "state_key": stateKey ?? router, "sender": sender ?? router, "content": ["accounts": accounts]]
    }

    private func member(_ userId: String, membership: String = "join") -> JSON {
        ["type": "m.room.member", "state_key": userId, "sender": userId, "content": ["membership": membership]]
    }

    private var routerAt50: JSON { powerLevels(["users_default": 0, "users": [router: 50]]) }

    func testTrustsBoundAccountWhenOrdinaryMembersCannotWriteBinding() {
        XCTAssertEqual(TrustedAccounts.inRoom(state: [binding(["user_id": router]), routerAt50]), [router])
        let customLevels = powerLevels([
            "users_default": 0,
            "state_default": 0,
            "users": [router: 100],
            "events": ["io.mindroom.router": 100],
        ])
        XCTAssertEqual(TrustedAccounts.inRoom(state: [binding(["user_id": router]), customLevels]), [router])
    }

    func testTrustsPrivilegedCreatorInRoomV12AndHydra() {
        let levels = powerLevels(["users_default": 0, "state_default": 50])
        XCTAssertEqual(
            TrustedAccounts.inRoom(state: [create(roomVersion: "12", sender: router), binding(["user_id": router]), levels]),
            [router]
        )
        XCTAssertEqual(
            TrustedAccounts.inRoom(state: [create(roomVersion: "12", sender: "@owner:example.org", additionalCreators: [router, 7]),
                                           binding(["user_id": router]), levels]),
            [router]
        )
        XCTAssertEqual(
            TrustedAccounts.inRoom(state: [create(roomVersion: "org.matrix.hydra.11", sender: router), binding(["user_id": router]), levels]),
            [router]
        )
        // Room v11 does not have privileged creators.
        XCTAssertEqual(
            TrustedAccounts.inRoom(state: [create(roomVersion: "11", sender: router), binding(["user_id": router]), levels]),
            []
        )
        // A creator binding that ordinary members can write is still rejected.
        let openLevels = powerLevels(["users_default": 0, "state_default": 0])
        XCTAssertEqual(
            TrustedAccounts.inRoom(state: [create(roomVersion: "12", sender: router), binding(["user_id": router]), openLevels]),
            []
        )
    }

    func testRejectsMissingPowerLevelsEvent() {
        // Without m.room.power_levels, state_default is 0 so any member can send state events.
        XCTAssertEqual(
            TrustedAccounts.inRoom(state: [create(roomVersion: "12", sender: router), binding(["user_id": router])]),
            []
        )
    }

    func testRejectsMissingMalformedOrForeignBinding() {
        XCTAssertEqual(TrustedAccounts.inRoom(state: [routerAt50]), [])
        let withAdmin = powerLevels(["users_default": 0, "users": [router: 50, "@admin:example.org": 100]])
        XCTAssertEqual(TrustedAccounts.inRoom(state: [binding(["user_id": router], sender: "@admin:example.org"), withAdmin]), [])
        XCTAssertEqual(TrustedAccounts.inRoom(state: [binding(["user_id": router], stateKey: router), routerAt50]), [])
        for badContent: JSON in [[:], ["user_id": 7], ["user_id": ""]] {
            XCTAssertEqual(TrustedAccounts.inRoom(state: [binding(badContent), routerAt50]), [])
        }
    }

    func testRejectsDemotedWriterAndOpenBindings() {
        let attacker = "@mindroom_router:elsewhere.org"
        let tightened = powerLevels(["users_default": 0, "events": ["io.mindroom.router": 50]])
        XCTAssertEqual(TrustedAccounts.inRoom(state: [binding(["user_id": attacker], sender: attacker), tightened]), [])
        let openCases: [JSON] = [
            ["users_default": 50, "state_default": 50, "users": [router: 100]],
            ["users_default": 0, "state_default": 0, "users": [router: 100]],
            ["users_default": 0, "events": ["io.mindroom.router": 0], "users": [router: 100]],
        ]
        for levels in openCases {
            XCTAssertEqual(TrustedAccounts.inRoom(state: [binding(["user_id": router]), powerLevels(levels)]), [])
        }
    }

    func testRejectsNonNumericPowerLevelsReadByCheck() {
        let malformed: [JSON] = [
            ["users": [router: 50], "events": ["io.mindroom.router": "100"]],
            ["users": [router: 50], "state_default": "100"],
            ["users": [router: 50], "users_default": "0"],
            ["users": [router: "100"]],
            ["users": [router: true]],
            ["users": [router: 50], "state_default": true],
            ["users": [router: 50], "state_default": NSNull()],
        ]
        for raw in malformed {
            XCTAssertEqual(TrustedAccounts.inRoom(state: [binding(["user_id": router]), powerLevels(raw)]), [])
        }
        // Unrelated malformed user levels do not break trust.
        let unrelated = powerLevels(["users_default": 0, "users": [router: 50, "@sam:example.org": "odd"]])
        XCTAssertEqual(TrustedAccounts.inRoom(state: [binding(["user_id": router]), unrelated]), [router])
    }

    func testTrustsJoinedAccountsFromBoundRosterAndIgnoresInvalidRosters() {
        let base = [binding(["user_id": router]), routerAt50]
        // Joined string entries are trusted; non-strings and non-joined accounts are ignored.
        let validRoster = roster(accounts: [agent, "@mindroom_left:example.org", 7, ["user_id": agent]])
        XCTAssertEqual(
            TrustedAccounts.inRoom(state: base + [validRoster, member(agent, membership: "join"), member("@mindroom_left:example.org", membership: "leave")]),
            [router, agent]
        )
        // Listed account not joined is not trusted.
        XCTAssertEqual(TrustedAccounts.inRoom(state: base + [roster()]), [router])
        // Foreign sender, foreign state key, or non-array accounts are ignored.
        let invalidRosters: [JSON] = [
            roster(sender: agent, stateKey: agent),
            roster(sender: agent, stateKey: router),
            roster(accounts: agent),
        ]
        for bad in invalidRosters {
            XCTAssertEqual(TrustedAccounts.inRoom(state: base + [bad, member(agent)]), [router])
        }
        // Without a trusted binding, a roster trusts no one.
        let open = powerLevels(["users_default": 0, "state_default": 0])
        XCTAssertEqual(TrustedAccounts.inRoom(state: [binding(["user_id": router]), open, roster(), member(agent)]), [])
    }

    private func decodeState(_ rawJSON: String) throws -> [JSON] {
        let object = try JSONSerialization.jsonObject(with: Data(rawJSON.utf8))
        return try XCTUnwrap(object as? [JSON])
    }

    func testDecodedWireJSONAllowsNumericZeroAndOnePowerLevelsAndRejectsJSONBooleans() throws {
        // Real /state JSON decoded through JSONSerialization turns 0 and 1 into __NSCFNumber, which
        // bridges to Bool in Swift even though it is not a CFBoolean.
        let withZeroDefault = try decodeState(#"""
        [
          {"type": "m.room.create", "state_key": "", "sender": "@mindroom_router:example.org", "content": {"room_version": "12"}},
          {"type": "m.room.power_levels", "state_key": "", "sender": "@mindroom_router:example.org", "content": {"users_default": 0, "state_default": 50}},
          {"type": "io.mindroom.router", "state_key": "", "sender": "@mindroom_router:example.org", "content": {"user_id": "@mindroom_router:example.org"}},
          {"type": "io.mindroom.accounts", "state_key": "@mindroom_router:example.org", "sender": "@mindroom_router:example.org", "content": {"accounts": ["@mindroom_helper:example.org"]}},
          {"type": "m.room.member", "state_key": "@mindroom_helper:example.org", "sender": "@mindroom_helper:example.org", "content": {"membership": "join"}}
        ]
        """#)
        XCTAssertEqual(TrustedAccounts.inRoom(state: withZeroDefault), [router, agent])

        let withOneDefault = try decodeState(#"""
        [
          {"type": "m.room.power_levels", "state_key": "", "sender": "@mindroom_router:example.org", "content": {"users_default": 1, "events": {"io.mindroom.router": 50}, "users": {"@mindroom_router:example.org": 50}}},
          {"type": "io.mindroom.router", "state_key": "", "sender": "@mindroom_router:example.org", "content": {"user_id": "@mindroom_router:example.org"}}
        ]
        """#)
        XCTAssertEqual(TrustedAccounts.inRoom(state: withOneDefault), [router])

        let withOneEventAndUser = try decodeState(#"""
        [
          {"type": "m.room.power_levels", "state_key": "", "sender": "@mindroom_router:example.org", "content": {"users_default": 0, "events": {"io.mindroom.router": 1}, "users": {"@mindroom_router:example.org": 1}}},
          {"type": "io.mindroom.router", "state_key": "", "sender": "@mindroom_router:example.org", "content": {"user_id": "@mindroom_router:example.org"}}
        ]
        """#)
        XCTAssertEqual(TrustedAccounts.inRoom(state: withOneEventAndUser), [router])

        // True JSON booleans (CFBoolean) must still be rejected.
        let booleanLevels = [
            #"{"users_default": false, "users": {"@mindroom_router:example.org": 50}}"#,
            #"{"users_default": true, "users": {"@mindroom_router:example.org": 50}}"#,
            #"{"state_default": true, "users": {"@mindroom_router:example.org": 50}}"#,
            #"{"users_default": 0, "events": {"io.mindroom.router": true}, "users": {"@mindroom_router:example.org": 50}}"#,
            #"{"users_default": 0, "users": {"@mindroom_router:example.org": true}}"#,
        ]
        for levels in booleanLevels {
            let state = try decodeState(#"""
            [
              {"type": "m.room.power_levels", "state_key": "", "sender": "@mindroom_router:example.org", "content": \#(levels)},
              {"type": "io.mindroom.router", "state_key": "", "sender": "@mindroom_router:example.org", "content": {"user_id": "@mindroom_router:example.org"}}
            ]
            """#)
            XCTAssertEqual(TrustedAccounts.inRoom(state: state), [], "Expected rejection for \(levels)")
        }
    }
}
