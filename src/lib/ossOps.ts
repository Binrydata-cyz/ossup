/* 右键菜单里那些操作，全部落到 ossutil 子命令上。
   OSS 本身没有"重命名"和"移动"这两个 API —— 都是 cp 再 rm。 */

import { invoke } from "@tauri-apps/api/core"

import type { Auth } from "./ossApi.ts"

/** 目录在 OSS 里是 key 前缀，必须带尾斜杠且递归 */
export type Target = { uri: string; folder: boolean }

const ossRun = (auth: Auth, args: string[]): Promise<string> =>
	invoke("oss_run", { auth, args })

const recurse = (folder: boolean) => (folder ? ["-r"] : [])

export const uriOf = (bucket: string, key: string) => `oss://${bucket}/${key}`

/** 服务端复制，不经过本机。大对象 ossutil 会自动走分片复制。 */
export const copyTo = (auth: Auth, src: Target, dstUri: string) =>
	ossRun(auth, ["cp", ...recurse(src.folder), "-f", src.uri, dstUri])

export const remove = (auth: Auth, src: Target) =>
	ossRun(auth, ["rm", ...recurse(src.folder), "-f", src.uri])

/** OSS 没有 move，只能复制完再删原件。中途失败会留下副本，所以分两步报错。 */
export async function moveTo(auth: Auth, src: Target, dstUri: string) {
	await copyTo(auth, src, dstUri)
	try {
		await remove(auth, src)
	} catch (err) {
		throw new Error(`已复制到 ${dstUri}，但删除原件失败，请手动清理：${err}`)
	}
}

export const rename = (auth: Auth, src: Target, dstUri: string) => moveTo(auth, src, dstUri)

export const makeDir = (auth: Auth, uri: string) =>
	ossRun(auth, ["mkdir", uri.endsWith("/") ? uri : `${uri}/`])

/** presign 会连日志一起吐出来，URL 是其中以 http 开头的那一行 */
export async function presign(auth: Auth, uri: string, duration = "1h"): Promise<string> {
	const out = await ossRun(auth, ["presign", uri, "--expires-duration", duration])
	const url = out
		.split("\n")
		.map((l) => l.trim())
		.find((l) => l.startsWith("http"))
	if (!url) throw new Error(`没能从 ossutil 输出里找到链接：\n${out}`)
	return url
}

/** 下载走独立的流式命令，好复用进度条、断点续传和"停止"。
    凭证在 req 里（沿用 UploadRequest 的形状），不需要再传一份 auth。 */
export const download = (
	uploadReq: Record<string, unknown>,
	source: string,
	target: string,
	/* 远端是目录才递归。单个对象带 -r 会被 ossutil 拒绝，
	   而 oss:// 路径没法在后端 stat，只能由这里按列表里的类型告知。 */
	recursive: boolean,
	taskId: string,
) => invoke("start_download", { req: uploadReq, source, target, recursive, taskId })
