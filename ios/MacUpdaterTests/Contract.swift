import Foundation

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}

@main
struct Contract {
    static func main() {
        require(CommandLine.arguments.count == 2, "pass the updater bundle path")
        let url = URL(fileURLWithPath: CommandLine.arguments[1])
        guard let bundle = Bundle(url: url), bundle.load(),
              let principal = bundle.principalClass as? NSObject.Type,
              let updater = principal.init() as? MindRoomMacUpdaterProtocol else {
            require(false, "the updater bundle must load through its declared protocol")
            return
        }
        // start() is not called: it would check a feed with this process's defaults.
        require(!updater.install(), "nothing staged, nothing to install")
        require(!updater.canCheckForUpdates, "an updater that never started cannot check")
        updater.checkForUpdates()
        print("PASS: updater bundle loading, an install with nothing staged, no check before start")
    }
}
