/* 无边框窗口的自绘标题栏。系统标题栏（连同它的图标）已由
   tauri.conf.json 的 decorations:false 整条去掉。 */

import { getCurrentWindow } from "@tauri-apps/api/window"

import { useSessionStore } from "../store/session.ts"
import { Icon } from "./Icon.tsx"

export function TitleBar() {
	const engine = useSessionStore((s) => s.engine)
	const connected = useSessionStore((s) => s.connected)
	const config = useSessionStore((s) => s.config)
	const disconnect = useSessionStore((s) => s.disconnect)

	const win = getCurrentWindow()
	const ak = config.accessKeyId.trim()
	const shortAk = ak.length > 10 ? `${ak.slice(0, 6)}…${ak.slice(-4)}` : ak

	return (
		/* 登录门是深色的，标题栏跟着换色才不会在顶上留一条突兀的白条 */
		<div className={`titlebar ${connected ? "" : "on-gate"}`}>
			{/* 拖动区只给这块空白，按钮才不会一点就变成拖窗口 */}
			<div className="titlebar-spacer" data-tauri-drag-region />

			{connected && (
				<div className="identity">
					<span className="ak">{shortAk}</span>
					<span className="ep">{config.endpoint}</span>
					<button type="button" className="btn" onClick={disconnect}>
						退出
					</button>
				</div>
			)}

			{/* 正常情况下不显示版本号 —— 一切正常时它只是噪音。
			    只有探测失败才浮出来，因为那时用户必须知道。 */}
			{engine.state === "error" && (
				<div className="engine error">
					<span className="dot" />
					<span>{engine.text}</span>
				</div>
			)}

			<button type="button" className="winbtn" aria-label="最小化" onClick={() => win.minimize()}>
				<Icon name="minimize" />
			</button>
			<button
				type="button"
				className="winbtn"
				aria-label="最大化"
				onClick={() => win.toggleMaximize()}
			>
				<Icon name="maximize" />
			</button>
			<button type="button" className="winbtn close" aria-label="关闭" onClick={() => win.close()}>
				<Icon name="close" />
			</button>
		</div>
	)
}
