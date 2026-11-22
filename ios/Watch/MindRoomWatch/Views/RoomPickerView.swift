import SwiftUI

/// The joined rooms, most recent first; picking one makes it the default.
struct RoomPickerView: View {
    @ObservedObject var rooms: RoomList
    let selected: String?
    let pick: (String) -> Void

    var body: some View {
        List {
            if rooms.rooms.isEmpty {
                ProgressView()
                    .tint(WatchTheme.tealBright)
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
            }
            ForEach(rooms.rooms) { room in
                let isSelected = room.id == selected
                Button { pick(room.id) } label: {
                    HStack(spacing: 8) {
                        Text(room.name)
                            .font(.headline)
                            .foregroundStyle(.white)
                            .lineLimit(2)
                        Spacer(minLength: 4)
                        if isSelected {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.body)
                                .foregroundStyle(WatchTheme.tealBright)
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 9)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        GlassCardBackground(
                            tint: isSelected ? WatchTheme.teal.opacity(0.18) : WatchTheme.glassFill,
                            border: isSelected ? WatchTheme.tealBright.opacity(0.42) : WatchTheme.glassBorder,
                            accentBar: isSelected ? WatchTheme.tealBright : nil,
                            cornerRadius: 13
                        )
                    )
                }
                .buttonStyle(.plain)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 3, leading: 2, bottom: 3, trailing: 2))
                .onAppear { if room.id == rooms.rooms.last?.id { rooms.loadMore() } }
            }
        }
        .containerBackground(for: .navigation) {
            WatchTheme.threadBackground
        }
        .navigationTitle(Text("Rooms"))
    }
}
