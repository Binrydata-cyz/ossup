# OSS 上传助手

Tauri 2 + Rust 写的 OSS 上传 GUI，内部调用阿里云官方 `ossutil`。
专治 OSS Browser 传大批数据时卡断、断了要重传的问题。

## 它解决什么

| 痛点 | 这里的做法 |
| --- | --- |
| 传一半卡断，重开要重传 | `--checkpoint-dir` 固定在用户配置目录，重开软件再点一次就接着传 |
| 重跑会把已传的再传一遍 | 带 `-u`，已存在且未修改的文件直接跳过 |
| 不知道传完没有 | 传完自动跑一次 `ossutil ls`，对比本地 / 远端文件数 |
| 路径手敲打错传到野目录 | Bucket / 路径支持预置下拉，实时预览完整 `oss://` 地址 |
| 凭证明文满天飞 | 默认写临时 0600 配置文件，不上命令行，任务结束即删 |

## 目录结构

```
ossup/
  index.html            界面结构
  src/main.js           前端逻辑（invoke + 事件监听）
  src/style.css         样式
  src-tauri/
    src/lib.rs          全部 Rust 逻辑：配置 / 进程 / 进度解析 / 校验
    src/main.rs         入口
    binaries/           把 ossutil 可执行文件放这里
    tauri.conf.json     窗口 / 打包配置
    capabilities/       权限声明
```

## 跑起来

环境：Node 18+、Rust 1.77+、各平台的 Tauri 依赖（Windows 需 WebView2，Linux 需 webkit2gtk）。

```bash
# 1. 把 ossutil 放进 src-tauri/binaries/
#    Windows: ossutil.exe   macOS/Linux: ossutil (chmod +x)

npm install
npm run tauri:dev      # 开发
npm run tauri:build    # 打包安装包
```

图标：仓库里已经放了一套占位图标。想换成自己的，把一张 1024x1024 PNG 放好后跑
`npm run tauri icon path/to/icon.png` 即可重新生成全尺寸。

## 实际拼出来的命令

```
ossutil cp -r -u -f \
  --config-file  <配置目录>/session.ossutilconfig \
  --checkpoint-dir <配置目录>/checkpoints \
  --jobs 5 --parallel 8 --part-size 16777216 \
  <本地文件夹> oss://<bucket>/<prefix>/
```

## 几个实现上的关键点

**进度解析按字节读，不按行读**。`ossutil` 用 `\r` 反复重绘同一行，用 `read_line`
会一直阻塞到任务结束。`lib.rs` 里的 `pump()` 遇到 `\n` 或 `\r` 都刷一次，
进度条才能实时动。

**子进程用轮询而不是 `wait()`**。子进程存在 `Mutex` 里，如果直接 await `wait()`
会一直持锁，“停止”按钮就拿不到锁了。改成每 250ms `try_wait()` 一次。

**停止 = kill 进程**，断点文件会保留。再点一次开始上传就从断点继续。

**拖拽拿真实路径**。走 Tauri 的 `onDragDropEvent`（需要 `dragDropEnabled: true`），
拿到的是本地绝对路径，浏览器的 File API 拿不到。

## 参数怎么调

| 场景 | jobs | parallel | part-size |
| --- | --- | --- | --- |
| 大量小文件（图片、标注 json） | 16–32 | 4 | 8 MB |
| 少量大文件（4K 视频、压缩包） | 2–3 | 16–32 | 32–64 MB |
| 混合 | 5 | 8 | 16 MB |

带宽吃满了就别再加，并发过高反而容易被服务端限速。

## 安全说明

本地保存的凭证只做了 base64 混淆，**不是加密**。单人自用够了；
如果以后要发给更多人，把 `load_config` / `save_config` 里的 base64 换成
`keyring` crate（走 Windows Credential Manager / macOS Keychain）即可，
其他代码不用动。

不管几个人用，都建议用 RAM 子账号，策略限制到具体 bucket + prefix，
只给 `PutObject` / `ListObjects`，不给 delete。

## 兼容性

进度解析对 ossutil 1.x 和 2.x 的输出都做了宽松匹配（百分比、速度、文件数
各自独立取，取不到就不显示）。如果遇到鉴权报错，到“高级设置”里勾上
“用命令行参数传递凭证”再试。
