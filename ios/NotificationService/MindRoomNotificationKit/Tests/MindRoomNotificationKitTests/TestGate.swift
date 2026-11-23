import Foundation

/// Holds an async step of a test where it is until the test lets it go on.
final class TestGate: @unchecked Sendable {
    private let lock = NSLock()
    private var held: CheckedContinuation<Void, Never>?
    private var waiting: CheckedContinuation<Void, Never>?

    /// Called by the step: says that it has got here and waits to be let through.
    func hold() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            self.lock.lock()
            self.held = continuation
            let waiting = self.waiting
            self.waiting = nil
            self.lock.unlock()
            waiting?.resume()
        }
    }

    /// Returns once the step is held.
    func waitUntilHeld() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            self.lock.lock()
            if self.held != nil {
                self.lock.unlock()
                continuation.resume()
                return
            }
            self.waiting = continuation
            self.lock.unlock()
        }
    }

    func release() {
        lock.lock()
        let held = self.held
        self.held = nil
        lock.unlock()
        held?.resume()
    }
}
