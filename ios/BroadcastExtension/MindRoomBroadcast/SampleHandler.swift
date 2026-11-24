import LiveKit

#if os(iOS)
@available(macCatalyst 13.1, *)
final class SampleHandler: LKSampleHandler, @unchecked Sendable {
    #if DEBUG
    override var enableLogging: Bool { true }
    #else
    override var enableLogging: Bool { false }
    #endif
}
#endif