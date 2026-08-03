# 把 ossutil 放在这里

构建前把官方 `ossutil` 可执行文件放进本目录，文件名必须是：

- Windows：`ossutil.exe`
- macOS / Linux：`ossutil`（记得 `chmod +x ossutil`）

下载地址：https://help.aliyun.com/zh/oss/developer-reference/install-ossutil

`tauri.conf.json` 中的 `bundle.resources` 会把本目录打包进安装包，
运行时从 `resource_dir()/binaries/` 解析。

如果不想打包，也可以把 ossutil 加到系统 PATH，
或者在软件的“高级设置 → ossutil 可执行文件路径”里手动指定。
