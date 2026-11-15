// swift-tools-version:5.9
// MindRoom's Matrix event formats and the watch app's pure logic, tested on macOS with `swift test`.
import PackageDescription

let package = Package(
    name: "MindRoomWatchKit",
    platforms: [.watchOS(.v10), .macOS(.v13)],
    products: [.library(name: "MindRoomWatchKit", targets: ["MindRoomWatchKit"])],
    targets: [
        .target(name: "MindRoomWatchKit"),
        .testTarget(name: "MindRoomWatchKitTests", dependencies: ["MindRoomWatchKit"]),
    ]
)
