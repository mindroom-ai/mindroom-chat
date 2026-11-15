// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "MatrixRustSDK",
    platforms: [.watchOS(.v10), .iOS(.v16), .macOS(.v13)],
    products: [.library(name: "MatrixRustSDK", targets: ["MatrixRustSDK"])],
    targets: [
        .binaryTarget(name: "MatrixSDKFFI", path: "MatrixSDKFFI.xcframework"),
        .target(
            name: "MatrixRustSDK",
            dependencies: [.target(name: "MatrixSDKFFI")],
            path: "Sources/MatrixRustSDK"
        ),
    ]
)
