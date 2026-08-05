/* 无边框窗口的自绘标题栏。系统标题栏（连同它的图标）已由
   tauri.conf.json 的 decorations:false 整条去掉。

   左侧：账号按钮（切换 / 保存 / 退出账号）
   右侧：设置（并发与分片参数）+ 窗口按钮 */

import { getCurrentWindow } from "@tauri-apps/api/window"
import { useState } from "react"

import { useSessionStore, type Account } from "../store/session.ts"
import { useUiStore } from "../store/ui.ts"
import { Icon } from "./Icon.tsx"
import { useMenu } from "./Menu.tsx"
import { Settings } from "./Settings.tsx"

/** LTAI5tEJgXxm1AzFVdh2pUqo -> LTAI5t…pUqo */
const shortAk = (ak: string) =>
	ak.length > 10 ? `${ak.slice(0, 6)}…${ak.slice(-4)}` : ak

export function TitleBar() {
	const engine = useSessionStore((s) => s.engine)
	const connected = useSessionStore((s) => s.connected)
	const config = useSessionStore((s) => s.config)
	const disconnect = useSessionStore((s) => s.disconnect)
	const switchAccount = useSessionStore((s) => s.switchAccount)
	const saveCurrentAsAccount = useSessionStore((s) => s.saveCurrentAsAccount)
	const removeAccount = useSessionStore((s) => s.removeAccount)
	const { showPrompt, showToast } = useUiStore()

	const [settingsOpen, setSettingsOpen] = useState(false)
	const accountMenu = useMenu()
	const win = getCurrentWindow()

	const ak = config.accessKeyId.trim()
	const current = config.accounts.find((a) => a.accessKeyId === ak)
	const label = current?.name || shortAk(ak) || "未登录"
	const saved = Boolean(current)

	const pick = (account: Account) => {
		if (account.accessKeyId === ak) return
		void switchAccount(account).catch((err) => showToast(String(err), "error"))
	}

	const accountItems = [
		...config.accounts.map((a) => ({
			label: `${a.name}（${shortAk(a.accessKeyId)}）`,
			checkable: true,
			checked: a.accessKeyId === ak,
			onSelect: () => pick(a),
		})),
		...(config.accounts.length ? [{ separator: true, label: "s1" }] : []),
		{
			/* 已保存的显示"改名"，避免看起来能存出两条一样的 */
			label: saved ? "重命名当前账号…" : "保存当前账号…",
			onSelect: () =>
				showPrompt({
					title: saved ? "重命名账号" : "保存当前账号",
					label: "账号名称",
					value: current?.name || shortAk(ak),
					hint: "密钥存在本机配置文件里，只做 Base64 编码，不是加密",
					confirmText: "保存",
					onConfirm: (name) => {
						void saveCurrentAsAccount(name)
						showToast(`已保存账号「${name}」`, "success")
					},
				}),
		},
		...(saved
			? [
					{
						label: "从列表移除当前账号",
						onSelect: () => {
							void removeAccount(ak)
							showToast("已从列表移除", "success")
						},
					},
				]
			: []),
		{ separator: true, label: "s2" },
		{ label: "退出账号", onSelect: disconnect },
	]

	return (
		/* 登录门是深色的，标题栏跟着换色才不会在顶上留一条突兀的白条 */
		<div className={`titlebar ${connected ? "" : "on-gate"}`}>
			{connected && (
				<button type="button" className="acctbtn" onClick={accountMenu.openUnder}>
					<Icon name="user" />
					<span>{label}</span>
					<Icon name="chevron" className="caret" />
				</button>
			)}

			{/* 拖动区只给这块空白，按钮才不会一点就变成拖窗口 */}
			<div className="titlebar-spacer" data-tauri-drag-region />

			{/* 正常情况下不显示版本号 —— 一切正常时它只是噪音。
			    只有探测失败才浮出来，因为那时用户必须知道。 */}
			{engine.state === "error" && (
				<div className="engine error">
					<span className="dot" />
					<span>{engine.text}</span>
				</div>
			)}

			{connected && (
				<button type="button" className="btn" onClick={() => setSettingsOpen(true)}>
					设置
				</button>
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

			{accountMenu.render(accountItems)}
			{settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
		</div>
	)
}
