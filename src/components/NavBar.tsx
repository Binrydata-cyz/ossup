/* 后退 / 前进 / 向上 / 刷新 + 面包屑 + 搜索 */

import { useEffect, useState } from "react"

import { useDebounced, useLongPress, type AnchorEvent } from "../lib/hooks.ts"
import { useExplorerStore } from "../store/explorer.ts"
import { Breadcrumb } from "./Breadcrumb.tsx"
import { Icon } from "./Icon.tsx"
import { Menu, type MenuItem } from "./Menu.tsx"

export function NavBar() {
	const {
		history,
		historyIndex,
		goBack,
		goForward,
		goUp,
		goToHistory,
		refresh,
		canGoBack,
		canGoForward,
		canGoUp,
	} = useExplorerStore()

	const [spinning, setSpinning] = useState(false)
	const [histMenu, setHistMenu] = useState<{ x: number; y: number } | null>(null)

	const openHistory = (e: AnchorEvent) => {
		const r = e.currentTarget.getBoundingClientRect()
		setHistMenu({ x: r.left, y: r.bottom + 2 })
	}

	const backPress = useLongPress(openHistory)
	const fwdPress = useLongPress(openHistory)

	const historyItems: MenuItem[] = history.length
		? history
				.map((path, i) => ({
					label: path || "（未选择 Bucket）",
					checked: i === historyIndex,
					checkable: true,
					onSelect: () => goToHistory(i),
				}))
				.reverse()
		: [{ label: "还没有历史", disabled: true }]

	return (
		<div className="navbar">
			<div className="navgroup">
				<button
					type="button"
					className="navbtn"
					aria-label="后退"
					title="后退（长按或右键看历史）"
					disabled={!canGoBack()}
					{...backPress.handlers}
					onClick={() => {
						if (!backPress.consumed()) goBack()
					}}
					onContextMenu={(e) => {
						e.preventDefault()
						openHistory(e)
					}}
				>
					<Icon name="back" />
				</button>

				<button
					type="button"
					className="navbtn"
					aria-label="前进"
					title="前进（长按或右键看历史）"
					disabled={!canGoForward()}
					{...fwdPress.handlers}
					onClick={() => {
						if (!fwdPress.consumed()) goForward()
					}}
					onContextMenu={(e) => {
						e.preventDefault()
						openHistory(e)
					}}
				>
					<Icon name="forward" />
				</button>

				<button
					type="button"
					className="navbtn"
					aria-label="向上一级"
					title="向上一级"
					disabled={!canGoUp()}
					onClick={goUp}
				>
					<Icon name="up" />
				</button>

				<button
					type="button"
					className={`navbtn ${spinning ? "spin" : ""}`}
					aria-label="刷新"
					title="刷新"
					onClick={() => {
						setSpinning(true)
						void refresh()
					}}
					onAnimationEnd={() => setSpinning(false)}
				>
					<Icon name="refresh" />
				</button>
			</div>

			<Breadcrumb />
			<SearchBox />

			{histMenu && (
				<Menu x={histMenu.x} y={histMenu.y} items={historyItems} onClose={() => setHistMenu(null)} />
			)}
		</div>
	)
}

function SearchBox() {
	const breadcrumbs = useExplorerStore((s) => s.breadcrumbs)
	const searchQuery = useExplorerStore((s) => s.searchQuery)
	const setSearchQuery = useExplorerStore((s) => s.setSearchQuery)

	const [text, setText] = useState(searchQuery)
	const debounced = useDebounced(text, 300)

	/* 防抖后才写进 store —— 打字过程中不该每个键都重排整张表 */
	useEffect(() => {
		setSearchQuery(debounced)
	}, [debounced, setSearchQuery])

	/* 切目录时 store 会清空搜索，本地草稿要跟着清 */
	useEffect(() => {
		if (!searchQuery) setText("")
	}, [searchQuery])

	const here = breadcrumbs[breadcrumbs.length - 1] ?? "当前目录"

	return (
		<div className="search">
			<input
				type="text"
				spellCheck={false}
				placeholder={`搜索 ${here}`}
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape") setText("")
				}}
			/>
			{text && (
				<button type="button" className="search-clear" aria-label="清除搜索" onClick={() => setText("")}>
					<Icon name="close" />
				</button>
			)}
		</div>
	)
}
