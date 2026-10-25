// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "AtollaIsland",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(
      name: "AtollaIsland",
      path: "Sources/AtollaIsland",
      resources: [
        .copy("Resources/jelly-sprites"),
      ]
    ),
    .testTarget(
      name: "AtollaIslandTests",
      dependencies: ["AtollaIsland"],
      path: "Tests/AtollaIslandTests"
    ),
  ]
)
