/* 窗口底部状态栏。进度不是"栏里放了一根条"，而是整条栏本身从左往右被蓝色浸染，
   浸染长度 = 进度百分比（见 style.css 里 .statusbar 的 --fill）。
   点一下从上方滑出明细面板，只有两行。

   后端复用现成的 start_upload / start_download / cancel_upload 和 upload://event，
   一行 Rust 都没改。 */

import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWebview } from "@tauri-apps/api/webview"
import { open } from "@tauri-apps/plugin-dialog"
import { useEffect, useRef, useState } from "react"

import { formatSpeed, parseSpeed } from "../lib/format.ts"
import { splitPath, useExplorerStore } from "../store/explorer.ts"
import { useSessionStore } from "../store/session.ts"
import { useUiStore } from "../store/ui.ts"
import { Icon } from "./Icon.tsx"

type UploadEvent = {
	kind?: string
	line?: string | null
	percent?: number | null
	speed?: string | null
	okNum?: number | null
	totalNum?: number | null
	code?: number | null
}

type Phase = "idle" | "running" | "done" | "error"

type Task = {
	phase: Phase
	percent: number
	files: number | null
	note: string
}

const IDLE: Task = { phase: "idle", percent: 0, files: null, note: "" }

/** 速度滑动平均的窗口。瞬时值抖得太厉害，看着像网络不稳。 */
const SPEED_WINDOW_MS = 3000

export function TaskBar() {
	const [open_, setOpen] = useState(false)
	const [task, setTask] = useState<Task>(IDLE)
	const [speed, setSpeed] = useState<number | null>(null)

	/* 采样点放 ref 不放 state：它每秒被写好几次，进 state 会白白触发重渲染 */
	const samples = useRef<{ t: number; v: number }[]>([])

	const currentPath = useExplorerStore((s) => s.currentPath)
	const refresh = useExplorerStore((s) => s.refresh)
	const { config, appendLog } = useSessionStore()
	const showToast = useUiStore((s) => s.showToast)
	const transferKind = useUiStore((s) => s.transferKind)
	const setTransferKind = useUiStore((s) => s.setTransferKind)

	useEffect(() => {
		const unlisten = listen<UploadEvent>("upload://event", ({ payload }) => {
			if (payload.line) appendLog(payload.line)

			if (payload.speed) {
				const v = parseSpeed(payload.speed)
				if (v !== null) {
					const now = Date.now()
					samples.current.push({ t: now, v })
					samples.current = samples.current.filter((s) => now - s.t <= SPEED_WINDOW_MS)
					const sum = samples.current.reduce((a, s) => a + s.v, 0)
					setSpeed(sum / samples.current.length)
				}
			}

			setTask((t) => ({
				...t,
				percent: payload.percent ?? t.percent,
				files: payload.totalNum ?? t.files,
			}))

			if (payload.kind === "finished") {
				const ok = payload.code === 0
				samples.current = []
				setSpeed(null)
				setTask((t) => ({
					...t,
					phase: ok ? "done" : "error",
					percent: ok ? 100 : t.percent,
					note: ok ? "已完成" : `已中断（退出码 ${payload.code}）`,
				}))
				if (ok) {
					showToast("传输完成", "success")
					/* 刚动过文件，缓存里的列表已经过期 */
					void refresh()
				} else {
					showToast("传输未完成，再传一次即可续传", "error")
				}
			}

			if (payload.kind === "error") {
				setTask((t) => ({ ...t, phase: "error", note: "出错了" }))
			}
		})
		return () => {
			void unlisten.then((f) => f())
		}
	}, [appendLog, refresh, showToast])

	/* 拖文件夹到窗口 = 传到当前目录 */
	useEffect(() => {
		const unlisten = getCurrentWebview().onDragDropEvent((event) => {
			if (event.payload.type !== "drop") return
			const [first] = event.payload.paths ?? []
			if (first) void startUpload(first)
		})
		return () => {
			void unlisten.then((f) => f())
		}
	})

	const startUpload = async (localPath: string) => {
		const { bucket, prefix } = splitPath(currentPath)
		if (!bucket) {
			showToast("先进入一个 Bucket 再上传", "error")
			return
		}
		samples.current = []
		setSpeed(null)
		setTransferKind("upload")
		setTask({ phase: "running", percent: 0, files: null, note: "" })
		setOpen(true)
		try {
			await invoke("start_upload", {
				req: {
					localPath,
					bucket,
					prefix,
					accessKeyId: config.accessKeyId.trim(),
					accessKeySecret: config.accessKeySecret,
					endpoint: config.endpoint,
					jobs: config.jobs,
					parallel: config.parallel,
					partSizeMb: config.partSizeMb,
					ossutilPath: config.ossutilPath.trim(),
					cliCreds: config.cliCreds,
				},
			})
		} catch (err) {
			setTask({ ...IDLE, phase: "error", note: String(err) })
			appendLog(`[upload] ${err}`)
			showToast(String(err), "error")
		}
	}

	const pick = async () => {
		const selected = await open({ directory: true, multiple: false })
		if (typeof selected === "string") void startUpload(selected)
	}

	const running = task.phase === "running"
	const verb = transferKind === "download" ? "正在下载" : "正在上传"

	/* 百分比前面的"约"不能去：ossutil 报的是字节级进度，
	   和用户感知的"传了几个文件"对不上，写"约"才是诚实的。 */
	const headline =
		task.phase === "running"
			? `进行中（约 ${Math.round(task.percent)}%）`
			: task.phase === "done"
				? "已完成"
				: task.phase === "error"
					? task.note || "已中断"
					: "暂无传输任务"

	const detail = running
		? task.files
			? `${verb} ${task.files} 个文件`
			: `${verb}…`
		: task.note || "把文件夹拖进窗口即可上传到当前目录"

	return (
		<div className="statusbar-wrap">
			{open_ && (
				<div className="taskpanel" role="region" aria-label="传输明细">
					<div className="taskpanel-head">{headline}</div>
					<div className="taskpanel-row">
						<span className="taskpanel-what">{detail}</span>
						{/* 等宽字体：不然数字跳动时整行会左右抽动 */}
						<span className="taskpanel-speed">{running ? formatSpeed(speed ?? 0) : ""}</span>
					</div>
					<div className="taskpanel-actions">
						<button type="button" className="btn" onClick={pick} disabled={running}>
							选择文件夹上传
						</button>
						<button
							type="button"
							className="btn"
							disabled={!running}
							onClick={() => {
								void invoke("cancel_upload")
								appendLog("[user] 已请求停止（断点已保留，下次会接着传）")
							}}
						>
							停止
						</button>
					</div>
				</div>
			)}

			<button
				type="button"
				className={`statusbar ${task.phase}`}
				style={{ "--fill": `${Math.max(0, Math.min(100, task.percent))}%` } as React.CSSProperties}
				aria-expanded={open_}
				onClick={() => setOpen((v) => !v)}
			>
				<Icon name="chevron" className="chev" />
				<span className="statusbar-text">{headline}</span>
				{running && <span className="statusbar-speed">{formatSpeed(speed ?? 0)}</span>}
			</button>
		</div>
	)
}
