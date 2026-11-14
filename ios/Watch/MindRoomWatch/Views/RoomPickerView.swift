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
            }
            ForEach(rooms.rooms) { room in
                Button { pick(room.id) } label: {
                    HStack {
                        Text(room.name).lineLimit(2)
                        Spacer()
                        if room.id == selected { Image(systemName: "checkmark").foregroundStyle(.tint) }
                    }
                }
                .onAppear { if room.id == rooms.rooms.last?.id { rooms.loadMore() } }
            }
        }
        .navigationTitle(Text("Rooms"))
    }
}
