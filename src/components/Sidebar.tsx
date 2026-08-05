/* 收藏夹：手动维护的常用路径清单，不随浏览自动增删。 */

import { useState } from "react"

import { useDrag, useRemSize, type Breakpoint } from "../lib/hooks.ts"
import { iconFor } from "../lib/icons.ts"
import { useExplorerStore } from "../store/explorer.ts"
import { usePrefsStore } from "../store/prefs.ts"
import { useUiStore } from "../store/ui.ts"
import { Icon } from "./Icon.tsx"
import { Menu, type MenuItem } from "./Menu.tsx"

const MIN_REM = 10
const MAX_REM = 24

export function Sidebar({ breakpoint }: { breakpoint: Breakpoint }) {
	const {
		favorites,
		sidebarWidthRem,
		sidebarCollapsed,
		addFavorite,
		removeFavorite,
		removeOthers,
		renameFavorite,
		reorderFavorites,
		setSidebarWidth,
		toggleSidebar,
	} = usePrefsStore()

	const navigate = useExplorerStore((s) => s.navigate)
	const currentPath = useExplorerStore((s) => s.currentPath)
	const showToast = useUiStore((s) => s.showToast)
	const rem = useRemSize()

	const [rail, setRail] = useState(breakpoint === "narrow")
	const [floating, setFloating] = useState(false)
	const [dragIndex, setDragIndex] = useState<number | null>(null)
	const [dropAt, setDropAt] = useState<{ index: number; after: boolean } | null>(null)
	const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
	const [editing, setEditing] = useState<string | null>(null)

	/* 断点变化时重置成该断点的默认形态，但用户手动展开的浮层不被覆盖 */
	const isNarrow = breakpoint === "narrow"
	if (isNarrow !== rail && !floating) setRail(isNarrow)

	const { dragging, handlers } = useDrag(
		(dx, _dy, base) =>
			setSidebarWidth(Math.max(MIN_REM, Math.min(MAX_REM, base + dx / rem))),
		() => usePrefsStore.getState().sidebarWidthRem,
	)

	const go = (path: string) => {
		if (path !== currentPath) navigate(path)
		if (floating) setFloating(false)
	}

	const alreadySaved = favorites.some((f) => f.path === currentPath)

	const menuItems = (id: string): MenuItem[] => [
		{ label: "在此打开", onSelect: () => go(id) },
		{ label: "重命名", onSelect: () => setEditing(id) },
		{ separator: true, label: "sep" },
		{ label: "取消收藏", onSelect: () => removeFavorite(id) },
		{
			label: "只保留这一个",
			onSelect: () => removeOthers(id),
			disabled: favorites.length <= 1,
		},
		{ separator: true, label: "sep2" },
		{
			label: "复制路径",
			onSelect: () => {
				void navigator.clipboard.writeText(`oss://${id}/`)
				showToast("路径已复制", "success")
			},
		},
	]

	const width = rail && !floating ? undefined : `${sidebarWidthRem}rem`

	return (
		<>
			{floating && (
				<button
					type="button"
					className="sidebar-scrim"
					aria-label="收起侧边栏"
					onClick={() => setFloating(false)}
				/>
			)}

			<aside
				className={`sidebar ${rail && !floating ? "rail" : ""} ${floating ? "floating" : ""}`}
				style={{ width }}
			>
				<button
					type="button"
					className="sidebar-head"
					aria-expanded={!sidebarCollapsed}
					onClick={() => {
						if (rail && !floating) setFloating(true)
						else toggleSidebar()
					}}
				>
					<Icon name="chevron" />
					<span className="label">收藏夹（{favorites.length}）</span>
				</button>

				{!sidebarCollapsed &&
					(favorites.length === 0 ? (
						<div className="sidebar-empty">
							<img src={iconFor("folder", true)} alt="" />
							<span className="label">进到常用目录后，点下面的按钮收藏</span>
						</div>
					) : (
						<div className="tablist">
							{favorites.map((fav, index) => (
								<div
									key={fav.id}
									draggable={editing !== fav.id}
									onDragStart={() => setDragIndex(index)}
									onDragEnd={() => {
										setDragIndex(null)
										setDropAt(null)
									}}
									onDragOver={(e) => {
										e.preventDefault()
										if (dragIndex === null) return
										const r = e.currentTarget.getBoundingClientRect()
										setDropAt({ index, after: e.clientY > r.top + r.height / 2 })
									}}
									onDrop={(e) => {
										e.preventDefault()
										if (dragIndex === null || !dropAt) return
										/* 往后挪时目标索引要减 1，因为源已经先被摘掉了 */
										let to = dropAt.index + (dropAt.after ? 1 : 0)
										if (dragIndex < to) to -= 1
										reorderFavorites(dragIndex, to)
										setDragIndex(null)
										setDropAt(null)
									}}
									className={[
										"tab",
										fav.path === currentPath ? "active" : "",
										dropAt?.index === index && !dropAt.after ? "drop-before" : "",
										dropAt?.index === index && dropAt.after ? "drop-after" : "",
									]
										.filter(Boolean)
										.join(" ")}
									role="button"
									tabIndex={0}
									title={`oss://${fav.path}/`}
									onClick={() => go(fav.path)}
									onDoubleClick={() => setEditing(fav.id)}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault()
											go(fav.path)
										}
									}}
									onAuxClick={(e) => {
										/* 中键取消收藏 */
										if (e.button === 1) {
											e.preventDefault()
											removeFavorite(fav.id)
										}
									}}
									onContextMenu={(e) => {
										e.preventDefault()
										setMenu({ x: e.clientX, y: e.clientY, id: fav.id })
									}}
								>
									<img src={iconFor("folder")} alt="" />
									{editing === fav.id ? (
										<input
											className="tab-rename"
											defaultValue={fav.name}
											autoFocus
											onClick={(e) => e.stopPropagation()}
											onBlur={(e) => {
												renameFavorite(fav.id, e.target.value)
												setEditing(null)
											}}
											onKeyDown={(e) => {
												if (e.key === "Enter") e.currentTarget.blur()
												if (e.key === "Escape") setEditing(null)
											}}
										/>
									) : (
										<span className="tab-name">{fav.name}</span>
									)}
									<button
										type="button"
										className="tab-close"
										aria-label={`取消收藏 ${fav.name}`}
										onClick={(e) => {
											e.stopPropagation()
											removeFavorite(fav.id)
										}}
									>
										<Icon name="close" />
									</button>
								</div>
							))}
						</div>
					))}

				{sidebarCollapsed && <div />}

				<div className="sidebar-foot">
					<button
						type="button"
						className="btn wide"
						disabled={!currentPath || alreadySaved}
						title={
							!currentPath
								? "先进入一个目录"
								: alreadySaved
									? "这个目录已经在收藏夹里"
									: `收藏 oss://${currentPath}/`
						}
						onClick={() => {
							addFavorite(currentPath)
							showToast(`已收藏 ${currentPath}`, "success")
						}}
					>
						<span className="label">
							{alreadySaved ? "✓ 已收藏" : "★ 收藏当前目录"}
						</span>
						{rail && !floating && <Icon name="plus" />}
					</button>
				</div>

				{!(rail && !floating) && (
					<div
						className={`sidebar-resize ${dragging ? "dragging" : ""}`}
						role="separator"
						aria-label="调整侧边栏宽度"
						{...handlers}
					/>
				)}
			</aside>

			{menu && (
				<Menu x={menu.x} y={menu.y} items={menuItems(menu.id)} onClose={() => setMenu(null)} />
			)}
		</>
	)
}
