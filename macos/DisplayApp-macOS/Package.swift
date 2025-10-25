// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "DisplayApp-macOS",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "DisplayApp", targets: ["DisplayApp"])
    ],
    dependencies: [
        .package(path: "../../OrderTechCore")
    ],
    targets: [
        .executableTarget(
            name: "DisplayApp",
            dependencies: [
                .product(name: "OrderTechCore", package: "OrderTechCore")
            ],
            path: "Sources"
        )
    ]
)