import SwiftUI

/// Luminous MindRoom palette and reusable OLED glass primitives for Apple Watch.
enum WatchTheme {
    // MindRoom Ocean Teal & Warm Amber-Gold brand palette
    static let teal = Color(red: 0x45 / 255.0, green: 0xB5 / 255.0, blue: 0xC9 / 255.0)
    static let tealBright = Color(red: 0x70 / 255.0, green: 0xD2 / 255.0, blue: 0xE3 / 255.0)
    static let tealDeep = Color(red: 0x0E / 255.0, green: 0x34 / 255.0, blue: 0x42 / 255.0)
    static let tealInk = Color(red: 0x03 / 255.0, green: 0x15 / 255.0, blue: 0x1B / 255.0)
    static let amber = Color(red: 0xF5 / 255.0, green: 0xB9 / 255.0, blue: 0x52 / 255.0)
    static let amberWarm = Color(red: 0xFF / 255.0, green: 0xCF / 255.0, blue: 0x75 / 255.0)
    static let coral = Color(red: 0xFF / 255.0, green: 0x64 / 255.0, blue: 0x54 / 255.0)

    static let glassFill = Color.white.opacity(0.08)
    static let glassBorder = Color.white.opacity(0.13)

    /// Radial OLED background for the room home screen; adds a subtle warm amber top-right glow when urgent items wait.
    @ViewBuilder
    static func homeBackground(hasUrgent: Bool) -> some View {
        ZStack {
            Color.black
            RadialGradient(
                colors: [
                    Color(red: 44.0 / 255.0, green: 134.0 / 255.0, blue: 155.0 / 255.0).opacity(0.42),
                    tealDeep.opacity(0.30),
                    Color.black,
                ],
                center: hasUrgent ? UnitPoint(x: 0.20, y: 0.0) : .top,
                startRadius: 4,
                endRadius: 190
            )
            if hasUrgent {
                RadialGradient(
                    colors: [
                        amber.opacity(0.24),
                        Color.clear,
                    ],
                    center: UnitPoint(x: 0.85, y: 0.0),
                    startRadius: 4,
                    endRadius: 140
                )
            }
        }
    }

    /// Deep ocean-teal gradient fading cleanly into OLED black for threads, room picker, and pairing.
    static var threadBackground: some View {
        ZStack {
            Color.black
            RadialGradient(
                colors: [
                    Color(red: 36.0 / 255.0, green: 114.0 / 255.0, blue: 134.0 / 255.0).opacity(0.32),
                    Color(red: 5.0 / 255.0, green: 13.0 / 255.0, blue: 17.0 / 255.0).opacity(0.85),
                    Color.black,
                ],
                center: .top,
                startRadius: 4,
                endRadius: 190
            )
        }
    }

    /// Warm amber-coral glow over OLED black while recording audio.
    static var recordingBackground: some View {
        ZStack {
            Color.black
            RadialGradient(
                colors: [
                    amber.opacity(0.24),
                    coral.opacity(0.16),
                    Color.black,
                ],
                center: UnitPoint(x: 0.5, y: 0.36),
                startRadius: 6,
                endRadius: 165
            )
        }
    }
}

/// Reusable frosted glass card plate with hairline border and optional 3pt left status accent bar.
struct GlassCardBackground: View {
    var tint: Color = WatchTheme.glassFill
    var border: Color = WatchTheme.glassBorder
    var accentBar: Color? = nil
    var cornerRadius: CGFloat = 14

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        ZStack(alignment: .leading) {
            shape.fill(tint)
            if let accentBar {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(accentBar)
                    .frame(width: 3)
                    .padding(.vertical, 6)
            }
        }
        .clipShape(shape)
        .overlay(shape.strokeBorder(border, lineWidth: 0.75))
    }
}

/// Compact capsule status pill for urgent items, live runs, and approval outcomes.
struct StatusPill: View {
    let text: LocalizedStringKey
    let foreground: Color
    let background: Color
    var showSpinner: Bool = false
    var systemImage: String? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 3) {
            if showSpinner {
                if reduceMotion {
                    Circle()
                        .fill(foreground)
                        .frame(width: 6, height: 6)
                } else {
                    ProgressView()
                        .controlSize(.mini)
                        .tint(foreground)
                        .frame(width: 10, height: 10)
                }
            } else if let systemImage {
                Image(systemName: systemImage)
                    .font(.caption2.weight(.bold))
            }
            Text(text)
                .font(.caption2.weight(.bold))
                .lineLimit(1)
                .minimumScaleFactor(0.82)
        }
        .foregroundStyle(foreground)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(Capsule().fill(background))
    }
}

/// 16pt circular teal gradient badge with an agent's initial letter.
struct AgentMonogram: View {
    let name: String

    private var initial: String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.first.map { String($0).uppercased() } ?? "M"
    }

    var body: some View {
        Text(initial)
            .font(.system(size: 9.5, weight: .heavy))
            .foregroundStyle(WatchTheme.tealInk)
            .frame(width: 16, height: 16)
            .background(
                Circle().fill(
                    LinearGradient(
                        colors: [WatchTheme.tealBright, Color(red: 0x24 / 255.0, green: 0x78 / 255.0, blue: 0x8C / 255.0)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
            )
            .accessibilityHidden(true)
    }
}
