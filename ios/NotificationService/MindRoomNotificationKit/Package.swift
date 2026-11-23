// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MindRoomNotificationKit",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "MindRoomNotificationKit", targets: ["MindRoomNotificationKit"])],
    targets: [
        .target(name: "MindRoomNotificationKit"),
        .testTarget(name: "MindRoomNotificationKitTests", dependencies: ["MindRoomNotificationKit"]),
    ]
)
