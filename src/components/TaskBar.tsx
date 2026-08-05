/* 底部可折叠任务栏。复用后端已有的 start_upload / cancel_upload / verify_upload
   和 upload://event 事件流，一行 Rust 都没改。 */

import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWebview } from "@tauri-apps/api/webview"
import { open } from "@tauri-apps/plugin-dialog"
import { useEffect, useState } from "react"

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

type Task = {
	running: boolean
	phase: string
	tone: "" | "done" | "error"
	percent: number
	speed: string
	files: string
	localPath: string
	startedAt: number
}

const IDLE: Task = {
	running: false,
	phase: "进度",
	tone: "",
	percent: 0,
	speed: "—",
	files: "—",
	localPath: "",
	startedAt: 0,
}

export function TaskBar() {
	const [open_, setOpen] = useState(true)
	const [task, setTask] = useState<Task>(IDLE)
	const [elapsed, setElapsed] = useState(0)

	const currentPath = useExplorerStore((s) => s.currentPath)
	const refresh = useExplorerStore((s) => s.refresh)
	const { config, appendLog } = useSessionStore()
	const showToast = useUiStore((s) => s.showToast)

	useEffect(() => {
		if (!task.running) return
		const t = setInterval(() => setElapsed(Math.floor((Date.now() - task.startedAt) / 1000)), 1000)
		return () => clearInterval(t)
	}, [task.running, task.startedAt])

	useEffect(() => {
		const unlisten = listen<UploadEvent>("upload://event", ({ payload }) => {
			if (payload.line) appendLog(payload.line)
			setTask((t) => ({
				...t,
				percent: payload.percent ?? t.percent,
				speed: payload.speed ?? t.speed,
				files:
					payload.okNum != null ? `${payload.okNum} / ${payload.totalNum ?? "?"}` : t.files,
			}))

			if (payload.kind === "finished") {
				const ok = payload.code === 0
				setTask((t) => ({
					...t,
					running: false,
					percent: ok ? 100 : t.percent,
					phase: ok ? "上传完成" : `上传中断（退出码 ${payload.code}）`,
					tone: ok ? "done" : "error",
				}))
				if (ok) {
					showToast("上传完成", "success")
					/* 刚传完东西，缓存里的列表已经过期 */
					void refresh()
				} else {
					showToast("上传未完成，再传一次即可续传", "error")
				}
			}
			if (payload.kind === "error") {
				setTask((t) => ({ ...t, running: false, phase: "出错了", tone: "error" }))
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
		setOpen(true)
		setTask({
			...IDLE,
			running: true,
			phase: `正在上传到 oss://${currentPath}/`,
			localPath,
			startedAt: Date.now(),
		})
		setElapsed(0)
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
			setTask((t) => ({ ...t, running: false, phase: "启动失败", tone: "error" }))
			appendLog(`[upload] ${err}`)
			showToast(String(err), "error")
		}
	}

	const pick = async () => {
		const selected = await open({ directory: true, multiple: false })
		if (typeof selected === "string") void startUpload(selected)
	}

	const mm = String(Math.floor(elapsed / 60)).padStart(2, "0")
	const ss = String(elapsed % 60).padStart(2, "0")

	return (
		<div className="taskbar">
			<button
				type="button"
				className="taskbar-head"
				aria-expanded={open_}
				onClick={() => setOpen((v) => !v)}
			>
				<Icon name="chevron" className="chev" />
				<span style={{ flex: 1, minWidth: 0 }}>{task.phase}</span>
				{/* 折叠着也能看到进度，不用展开 */}
				<span className="taskbar-brief">
					{task.running && task.speed !== "—" && <span>{task.speed}</span>}
					{(task.running || task.percent > 0) && <span>{task.percent.toFixed(0)}%</span>}
				</span>
			</button>

			{open_ && (
				<div className="taskbar-body">
					<div className="bar">
						<div
							className={`bar-fill ${task.tone}`}
							style={{ width: `${Math.max(0, Math.min(100, task.percent))}%` }}
						/>
					</div>
					<div className="taskstats">
						<span>{task.files} 文件</span>
						<span>{task.speed} 速度</span>
						<span>
							{mm}:{ss} 用时
						</span>
						{task.localPath && <span title={task.localPath}>源 {task.localPath}</span>}
					</div>
					<div className="taskbar-actions">
						<button type="button" className="btn" onClick={pick} disabled={task.running}>
							选择文件夹上传
						</button>
						<button
							type="button"
							className="btn"
							disabled={!task.running}
							onClick={() => {
								void invoke("cancel_upload")
								appendLog("[user] 已请求停止（断点已保留，下次会接着传）")
							}}
						>
							停止
						</button>
						<span className="hint" style={{ alignSelf: "center" }}>
							也可以直接把文件夹拖进窗口，传到当前目录
						</span>
					</div>
				</div>
			)}
		</div>
	)
}
