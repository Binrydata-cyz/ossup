import { useEffect } from "react"

import { FileTable } from "./components/FileTable.tsx"
import { Gate } from "./components/Gate.tsx"
import { NavBar } from "./components/NavBar.tsx"
import { Confirm, Prompt } from "./components/Prompt.tsx"
import { Pager } from "./components/Pager.tsx"
import { Sidebar } from "./components/Sidebar.tsx"
import { TaskBar } from "./components/TaskBar.tsx"
import { TitleBar } from "./components/TitleBar.tsx"
import { Toolbar } from "./components/Toolbar.tsx"
import { useBreakpoint } from "./lib/hooks.ts"
import { normalizeEndpoint, useSessionStore } from "./store/session.ts"
import { setMaxTasks } from "./store/transfers.ts"
import { useUiStore } from "./store/ui.ts"

export function App() {
	const connected = useSessionStore((s) => s.connected)
	const breakpoint = useBreakpoint()

	/* 启动：读配置 -> 探 ossutil -> 存过凭证就直接连 */
	useEffect(() => {
		const boot = async () => {
			const session = useSessionStore.getState()
			await session.loadConfig()
			/* 队列的并发上限住在模块变量里，配置读回来后要同步过去 */
			setMaxTasks(useSessionStore.getState().config.maxTasks)
			await session.checkEngine()
			const { accessKeyId, accessKeySecret, endpoint } = useSessionStore.getState().config
			if (accessKeyId.trim() && accessKeySecret && normalizeEndpoint(endpoint)) {
				try {
					await session.connect()
				} catch (err) {
					/* 自动连失败就老实停在连接门，别弹窗打扰启动 */
					session.appendLog(`[connect] ${err}`)
				}
			}
		}
		void boot()
	}, [])

	return (
		<div className="app">
			<TitleBar />
			<NavBar />
			<div className="body">
				<Sidebar breakpoint={breakpoint} />
				<div className="main">
					<Toolbar />
					<FileTable />
					<Pager />
				</div>
			</div>

			{/* 状态栏贴窗口底部、跨整幅宽度，不缩在右半边 */}
			<TaskBar />

			{/* 连上后停在 oss://（Bucket 列表），由用户自己挑，不自动跳回上次位置 */}
			{!connected && <Gate onConnected={() => {}} />}

			<Dialogs />
			<LogPanel />
			<Toast />
		</div>
	)
}

/* 弹窗只在这里渲染一处，工具栏和右键菜单往 store 里塞 spec 就行 */
function Dialogs() {
	const { prompt, confirm, closeDialogs } = useUiStore()
	return (
		<>
			{prompt && <Prompt spec={prompt} onClose={closeDialogs} />}
			{confirm && <Confirm spec={confirm} onClose={closeDialogs} />}
		</>
	)
}

function LogPanel() {
	const logOpen = useUiStore((s) => s.logOpen)
	const toggleLog = useUiStore((s) => s.toggleLog)
	const logs = useSessionStore((s) => s.logs)
	const showToast = useUiStore((s) => s.showToast)

	if (!logOpen) return null
	const text = logs.join("\n")

	return (
		<section className="logpanel">
			<header>
				<span>ossutil 输出</span>
				<span style={{ display: "flex", gap: "var(--space-2)" }}>
					<button
						type="button"
						className="btn"
						onClick={() => {
							void navigator.clipboard.writeText(text)
							showToast("日志已复制", "success")
						}}
					>
						复制
					</button>
					<button type="button" className="btn" onClick={toggleLog}>
						关闭
					</button>
				</span>
			</header>
			<pre>{text || "（还没有输出）"}</pre>
		</section>
	)
}

function Toast() {
	const toast = useUiStore((s) => s.toast)
	if (!toast) return null
	return <div className={`toast ${toast.kind}`}>{toast.text}</div>
}
