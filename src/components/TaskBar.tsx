/* 窗口底部状态栏。进度不是"栏里放了一根条"，而是整条栏本身从左往右被浸染，
   浸染长度 = 总体进度（见 style.css 里 .statusbar 的 --fill）。
   点一下从上方滑出明细面板，每个并发任务一行。

   后端复用现成的 start_upload / start_download / cancel_transfer 和 upload://event，
   事件里带 taskId，按 id 分派到对应的任务上。 */

import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWebview } from "@tauri-apps/api/webview"
import { open } from "@tauri-apps/plugin-dialog"
import { useEffect, useState } from "react"

import { formatSpeed } from "../lib/format.ts"
import { newTaskId, uploadReqFor } from "../lib/transferReq.ts"
import { splitPath, useExplorerStore } from "../store/explorer.ts"
import { useSessionStore } from "../store/session.ts"
import {
	overallPercent,
	running,
	summarize,
	totalSpeed,
	useTransfersStore,
} from "../store/transfers.ts"
import { useUiStore } from "../store/ui.ts"
import { Icon } from "./Icon.tsx"

type UploadEvent = {
	kind?: string
	taskId?: string | null
	line?: string | null
	percent?: number | null
	speed?: string | null
	okNum?: number | null
	totalNum?: number | null
	code?: number | null
}

export function TaskBar() {
	const [open_, setOpen] = useState(false)

	const items = useTransfersStore((s) => s.items)
	const currentPath = useExplorerStore((s) => s.currentPath)
	const refresh = useExplorerStore((s) => s.refresh)
	const config = useSessionStore((s) => s.config)
	const appendLog = useSessionStore((s) => s.appendLog)
	const showToast = useUiStore((s) => s.showToast)

	useEffect(() => {
		const unlisten = listen<UploadEvent>("upload://event", ({ payload }) => {
			if (payload.line) appendLog(payload.line)

			/* 没有 taskId 的是启动前的日志行，没法归属到任务上，只进日志面板 */
			const id = payload.taskId
			if (!id) return

			const store = useTransfersStore.getState()

			if (payload.kind === "finished") {
				store.finish(id, payload.code ?? -1)
				if (payload.code === 0) {
					showToast("传输完成", "success")
					/* 刚动过文件，列表已经过期 */
					void refresh()
				} else {
					showToast("传输未完成，再传一次即可续传", "error")
				}
				return
			}

			store.progress(id, {
				percent: payload.percent,
				files: payload.totalNum,
				speed: payload.speed,
			})
		})
		return () => {
			void unlisten.then((f) => f())
		}
	}, [appendLog, refresh, showToast])

	const startUpload = async (localPath: string) => {
		const { bucket, prefix } = splitPath(currentPath)
		if (!bucket) {
			showToast("先进入一个 Bucket 再上传", "error")
			return
		}
		const id = newTaskId()
		const label = localPath.split(/[\\/]/).filter(Boolean).pop() ?? localPath
		setOpen(true)
		/* 入队而不是直接启动：超过并发上限就排队，由 store 放行 */
		useTransfersStore.getState().enqueue({ id, kind: "upload", label }, async () => {
			try {
				await invoke("start_upload", {
					req: uploadReqFor(config, localPath, bucket, prefix),
					taskId: id,
				})
			} catch (err) {
				useTransfersStore.getState().fail(id, String(err))
				appendLog(`[upload] ${err}`)
				showToast(String(err), "error")
			}
		})
	}

	/* 拖文件夹到窗口 = 传到当前目录。依赖 startUpload 的最新闭包，故不加依赖数组 */
	useEffect(() => {
		const unlisten = getCurrentWebview().onDragDropEvent((event) => {
			if (event.payload.type !== "drop") return
			for (const path of event.payload.paths ?? []) void startUpload(path)
		})
		return () => {
			void unlisten.then((f) => f())
		}
	})

	const pick = async () => {
		const selected = await open({ directory: true, multiple: true })
		if (Array.isArray(selected)) for (const p of selected) void startUpload(p)
		else if (typeof selected === "string") void startUpload(selected)
	}

	const live = running(items)
	const busy = live.length > 0
	const percent = overallPercent(items)
	const speed = totalSpeed(items)

	/* 百分比前的"约"不能去：ossutil 报的是字节级进度，多任务下又是各任务平均，
	   和用户感知的"传了几个文件"差得更远，写"约"才诚实。 */
	const headline = busy
		? `进行中（约 ${Math.round(percent)}%）`
		: items.length
			? items.every((t) => t.phase === "done")
				? "已完成"
				: "部分任务未完成"
			: "暂无传输任务"

	const phaseClass = busy
		? "running"
		: items.length && items.some((t) => t.phase === "error")
			? "error"
			: items.length
				? "done"
				: "idle"

	return (
		<div className="statusbar-wrap">
			{open_ && (
				<div className="taskpanel" role="region" aria-label="传输明细">
					<div className="taskpanel-head">
						<span>{headline}</span>
						{busy && <span className="taskpanel-sub">{summarize(items)}</span>}
					</div>

					{items.length === 0 ? (
						<div className="taskpanel-row">
							<span className="taskpanel-what">把文件或文件夹拖进窗口即可上传到当前目录</span>
						</div>
					) : (
						<div className="tasklist">
							{items.map((t) => (
								<div className="taskrow" key={t.id}>
									<Icon name={t.kind === "upload" ? "upload" : "back"} />
									<span className="taskpanel-what" title={t.label}>
										{t.kind === "upload" ? "正在上传" : "正在下载"} {t.label}
										{t.files ? `（${t.files} 个文件）` : ""}
										{t.phase !== "running" && ` · ${t.note}`}
									</span>
									{/* 等宽字体：不然数字跳动时整行会左右抽动 */}
									<span className="taskpanel-speed">
										{t.phase === "running" ? formatSpeed(t.speed ?? 0) : ""}
									</span>
									<span className="taskrow-pct">{Math.round(t.percent)}%</span>
									<button
										type="button"
										className="taskrow-stop"
										aria-label={t.phase === "running" ? "停止" : "移除"}
										title={t.phase === "running" ? "停止" : "移除"}
										onClick={() => {
											if (t.phase === "running") {
												void invoke("cancel_transfer", { taskId: t.id })
												appendLog(`[user] 已请求停止 ${t.label}（断点保留，下次接着传）`)
											} else {
												useTransfersStore.getState().remove(t.id)
											}
										}}
									>
										<Icon name={t.phase === "running" ? "stop" : "close"} />
									</button>
								</div>
							))}
						</div>
					)}

					<div className="taskpanel-actions">
						<button type="button" className="btn" onClick={pick}>
							选择文件夹上传
						</button>
						<button
							type="button"
							className="btn"
							disabled={!busy}
							onClick={() => {
								void invoke("cancel_transfer", { taskId: null })
								appendLog("[user] 已请求停止全部传输")
							}}
						>
							全部停止
						</button>
					</div>
				</div>
			)}

			<button
				type="button"
				className={`statusbar ${phaseClass}`}
				style={{ "--fill": `${Math.max(0, Math.min(100, percent))}%` } as React.CSSProperties}
				aria-expanded={open_}
				onClick={() => setOpen((v) => !v)}
			>
				<Icon name="chevron" className="chev" />
				<span className="statusbar-text">
					{headline}
					{busy && ` · ${summarize(items)}`}
				</span>
				{busy && <span className="statusbar-speed">{formatSpeed(speed)}</span>}
			</button>
		</div>
	)
}
