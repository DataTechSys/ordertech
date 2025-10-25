// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "OrderTechCore",
    platforms: [
        .iOS(.v16),
        .macOS(.v12)
    ],
    products: [
        .library(name: "OrderTechCore", targets: ["OrderTechCore"])
    ],
    targets: [
        .target(
            name: "OrderTechCore",
            path: "Sources/OrderTechCore"
        )
    ]
)
