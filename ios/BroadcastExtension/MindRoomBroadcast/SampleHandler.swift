import LiveKit

#if os(iOS)
@available(macCatalyst 13.1, *)
final class SampleHandler: LKSampleHandler, @unchecked Sendable {
    override var enableLogging: Bool { true }
}
#endif