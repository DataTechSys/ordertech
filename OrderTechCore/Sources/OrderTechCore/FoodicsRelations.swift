import Foundation

@available(iOS 16.0, macOS 12.0, *)
public enum FoodicsRelations {
    public static func buildProductGroups(
        products: [FoodicsProduct],
        groups: [FoodicsModifierGroup],
        options: [FoodicsModifierOption],
        assignments: [FoodicsProductModifierGroup]
    ) -> [String: [FoodicsMappedGroup]] {
        let groupById: [String: FoodicsModifierGroup] = Dictionary(uniqueKeysWithValues: groups.map { ($0.id, $0) })
let optionsByGroup: [String: [FoodicsModifierOption]] = options.reduce(into: [:]) { dict, opt in
            let gid = opt.modifier_id ?? ""
            dict[gid, default: []].append(opt)
        }
        var out: [String: [FoodicsMappedGroup]] = [:]
        for a in assignments {
            guard let g = groupById[a.modifier_id] else { continue }
            let opts = optionsByGroup[a.modifier_id] ?? []
            let mapped = FoodicsMappedGroup(
                id: g.id,
                name: g.name,
                required: a.required ?? false,
                min: a.min ?? ((a.required ?? false) ? 1 : 0),
                max: a.max ?? Int.max,
                options: opts.map { FoodicsMappedOption(id: $0.id, name: $0.name, price: $0.price) }
            )
            out[a.product_id, default: []].append(mapped)
        }
        return out
    }
}