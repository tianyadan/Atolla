# Atolla Island 回滚快照

`pre-uneven-corners-20261022/` 保存「上小下大圆角」改动前的源码。

回滚示例（在项目内执行，勿用 rm）：

```bash
SNAP="macos/AtollaIsland/.rollback/pre-uneven-corners-20261022"
SRC="macos/AtollaIsland/Sources/AtollaIsland"
cp "$SNAP/IslandMorphDriver.swift" "$SRC/"
cp "$SNAP/IslandViews.swift" "$SRC/"
cp "$SNAP/IslandViewModel.swift" "$SRC/"
cp "$SNAP/IslandPanelController.swift" "$SRC/"
bash macos/AtollaIsland/scripts/install-launchagent.sh
```
