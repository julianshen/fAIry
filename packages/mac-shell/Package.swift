// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "fairy-shell",
  platforms: [.macOS(.v13)],
  dependencies: [
    .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.6.0"),
  ],
  targets: [
    .target(name: "FairyShell", swiftSettings: [.swiftLanguageMode(.v5)]),
    .executableTarget(
      name: "fairy-shell",
      dependencies: ["FairyShell", .product(name: "Sparkle", package: "Sparkle")],
      resources: [.copy("Resources/panel")],
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    .testTarget(name: "FairyShellTests", dependencies: ["FairyShell"], swiftSettings: [.swiftLanguageMode(.v5)]),
  ]
)
