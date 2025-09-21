import SwiftUI

struct BasketView: View {
    @StateObject private var store = BasketStore()
    var body: some View {
        List {
            ForEach(store.items) { item in
                HStack {
                    Text("\(item.name) × \(item.qty)")
                    Spacer()
                    Text(String(format: "%.3f KWD", item.price * Double(item.qty)))
                }
            }
            HStack {
                Text("Total")
                Spacer()
                Text(String(format: "%.3f KWD", store.total))
            }.font(.headline)
        }
        .navigationTitle("Basket")
    }
}

