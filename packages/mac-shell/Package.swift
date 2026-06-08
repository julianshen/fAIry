// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "fairy-shell",
  platforms: [.macOS(.v13)],
  targets: [
    .target(name: "FairyShell", swiftSettings: [.swiftLanguageMode(.v5)]),
    .testTarget(name: "FairyShellTests", dependencies: ["FairyShell"], swiftSettings: [.swiftLanguageMode(.v5)]),
  ]
)
