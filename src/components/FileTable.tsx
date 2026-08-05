/* 主内容区：表头 + 文件行 + 分组 + 四种视图 + 虚拟滚动 + 边界状态。 */

import { useCallback, useMemo, useRef, useState } from "react"

import {
	GROUP_ORDER,
	formatDateTime,
	formatSize,
	groupOf,
	middleTruncate,
	type Group,
} from "../lib/format.ts"
import { useBreakpoint, useDrag, useRemSize, useSize } from "../lib/hooks.ts"
import { iconFor } from "../lib/icons.ts"
import { kindOf, typeLabel, type OssItem } from "../lib/objects.ts"
import { joinPath, splitPath, useExplorerStore } from "../store/explorer.ts"
import { useSessionStore } from "../store/session.ts"
import { usePrefsStore } from "../store/prefs.ts"
import { useFileMenu } from "./useFileMenu.tsx"
import { Icon } from "./Icon.tsx"
import { EmptyDir, LoadError, NoBucket, NoResults, Skeleton } from "./States.tsx"

/** 超过这个数量才开虚拟滚动 —— 小目录直接全渲染，省掉一层复杂度。 */
const VIRTUAL_THRESHOLD = 500

type Column = { id: "name" | "modified" | "type" | "size"; label: string }

const COLUMNS: Column[] = [
	{ id: "name", label: "名称" },
	{ id: "modified", label: "修改日期" },
	{ id: "type", label: "类型" },
	{ id: "size", label: "大小" },
]

export function FileTable() {
	const {
		items,
		loading,
		error,
		currentPath,
		searchQuery,
		sortBy,
		sortOrder,
		selectedIds,
		focusedId,
		navigate,
		refresh,
		select,
		clearSelection,
		setSearchQuery,
		setSort,
	} = useExplorerStore()

	const viewMode = usePrefsStore((s) => s.viewMode)
	const columnWidthsRem = usePrefsStore((s) => s.columnWidthsRem)
	const setColumnWidth = usePrefsStore((s) => s.setColumnWidth)
	const fileMenu = useFileMenu()

	const breakpoint = useBreakpoint()
	const rem = useRemSize()
	const paneRef = useRef<HTMLDivElement>(null)
	const { ref: sizeRef, height: paneHeight } = useSize<HTMLDivElement>()
	const [scrollTop, setScrollTop] = useState(0)
	const [collapsedGroups, setCollapsedGroups] = useState<Set<Group>>(new Set())

	/* 窄屏按 类型 → 修改日期 的顺序砍列 */
	const visible = useMemo<Column[]>(() => {
		if (breakpoint === "narrow") return COLUMNS.filter((c) => c.id === "name" || c.id === "size")
		if (breakpoint === "medium") return COLUMNS.filter((c) => c.id !== "type")
		return COLUMNS
	}, [breakpoint])

	/* 表头和文件行共用这一个 --cols，所以永远对齐 */
	const cols = useMemo(
		() =>
			visible
				.map((c) => `${columnWidthsRem[COLUMNS.findIndex((x) => x.id === c.id)]}rem`)
				.join(" "),
		[visible, columnWidthsRem],
	)

	const filtered = useMemo(() => {
		const q = searchQuery.trim().toLowerCase()
		return q ? items.filter((o) => o.name.toLowerCase().includes(q)) : items
	}, [items, searchQuery])

	const sorted = useMemo(() => {
		const dir = sortOrder === "asc" ? 1 : -1
		const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" })
		return [...filtered].sort((a, b) => {
			/* 目录永远排在文件前面，和资源管理器一致 */
			if (a.folder !== b.folder) return a.folder ? -1 : 1
			switch (sortBy) {
				case "size":
					return (a.size - b.size) * dir
				case "modified":
					return (Date.parse(a.modified || "0") - Date.parse(b.modified || "0")) * dir
				case "type":
					return collator.compare(typeLabel(a), typeLabel(b)) * dir
				default:
					return collator.compare(a.name, b.name) * dir
			}
		})
	}, [filtered, sortBy, sortOrder])

	/* 只有按修改日期排序时才分组；换列自动关掉改平铺 */
	const grouped = sortBy === "modified" && viewMode === "details"

	/* 导航本身就会往侧边栏加标签（见 explorer.ts 的 enterPath），这里只管进目录 */
	const open = useCallback(
		(item: OssItem) => {
			if (!item.folder) return
			const { bucket } = splitPath(currentPath)
			navigate(joinPath(bucket, item.key.replace(/\/$/, "")))
		},
		[currentPath, navigate],
	)

	const onRowMouse = (item: OssItem, e: React.MouseEvent) => {
		select(item.key, e.shiftKey ? "range" : e.ctrlKey || e.metaKey ? "toggle" : "replace")
	}

	/* 菜单和输入框弹窗要跟着每一种状态一起渲染，空目录里也得能右键"新建文件夹" */
	const withMenu = (node: React.ReactNode) => (
		<>
			{node}
			{fileMenu.render()}
		</>
	)

	/* 空白区域的右键：命中行时行自己会 stopPropagation，不会走到这里 */
	const blankPane = {
		onContextMenu: fileMenu.onContextMenu(null),
	}

	/* ---------- oss:// 根：像资源管理器的"此电脑"那样列 Bucket ---------- */

	if (!splitPath(currentPath).bucket) {
		return (
			<>
				<div className="thead" style={{ "--cols": cols } as React.CSSProperties}>
					<button type="button" className="th">
						<span>Bucket</span>
					</button>
					<button type="button" className="th">
						<span>地域</span>
					</button>
					<button type="button" className="th">
						<span>存储类型</span>
					</button>
				</div>
				<div className="filepane" style={{ "--cols": cols } as React.CSSProperties}>
					<BucketList />
				</div>
			</>
		)
	}

	const header = (
		<div className="thead" style={{ "--cols": cols } as React.CSSProperties}>
			{visible.map((col) => {
				const realIndex = COLUMNS.findIndex((c) => c.id === col.id)
				return (
					<HeaderCell
						key={col.id}
						label={col.label}
						active={sortBy === col.id}
						order={sortOrder}
						onSort={() => setSort(col.id)}
						onResize={(dx, base) =>
							setColumnWidth(realIndex, Math.max(4, base + dx / rem))
						}
						baseWidth={() => usePrefsStore.getState().columnWidthsRem[realIndex]}
					/>
				)
			})}
		</div>
	)

	if (loading) {
		return withMenu(
			<>
				{header}
				<div className="filepane" {...blankPane}>
					<Skeleton columns={visible.length} />
				</div>
			</>,
		)
	}

	if (error) {
		return withMenu(
			<>
				{header}
				<div className="filepane" {...blankPane}>
					<LoadError
						message={error.message}
						permission={error.permission}
						onRetry={() => void refresh()}
					/>
				</div>
			</>,
		)
	}

	if (!items.length) {
		return withMenu(
			<>
				{header}
				<div className="filepane" {...blankPane}>
					<EmptyDir onNewFolder={fileMenu.newFolder} />
				</div>
			</>,
		)
	}

	if (!sorted.length) {
		return withMenu(
			<>
				{header}
				<div className="filepane" {...blankPane}>
					<NoResults query={searchQuery} onClear={() => setSearchQuery("")} />
				</div>
			</>,
		)
	}

	/* ---------- 视图 ---------- */

	const rowProps = (item: OssItem) => ({
		className: [
			"row",
			selectedIds.has(item.key) ? "selected" : "",
			focusedId === item.key ? "focused" : "",
		]
			.filter(Boolean)
			.join(" "),
		onMouseDown: (e: React.MouseEvent) => onRowMouse(item, e),
		onDoubleClick: () => open(item),
		onContextMenu: fileMenu.onContextMenu(item),
		onKeyDown: (e: React.KeyboardEvent) => {
			if (e.key === "Enter") open(item)
		},
		tabIndex: 0,
		title: item.name,
	})

	const renderRow = (item: OssItem) => (
		<div key={item.key} {...rowProps(item)}>
			<span className="cell">
				<img src={iconFor(item.folder ? "folder" : kindOf(item.name))} alt="" />
				{middleTruncate(item.name, 60)}
			</span>
			{visible.some((c) => c.id === "modified") && (
				<span className="cell muted">{item.folder ? "" : formatDateTime(item.modified)}</span>
			)}
			{visible.some((c) => c.id === "type") && (
				<span className="cell muted">{typeLabel(item)}</span>
			)}
			{visible.some((c) => c.id === "size") && (
				<span className="cell num">{item.folder ? "" : formatSize(item.size)}</span>
			)}
		</div>
	)

	let body: React.ReactNode

	if (viewMode === "large" || viewMode === "tiles") {
		body = (
			<div className={viewMode === "large" ? "grid-large" : "grid-tiles"}>
				{sorted.map((item) => (
					<div
						key={item.key}
						className={`cellbox ${selectedIds.has(item.key) ? "selected" : ""}`}
						onMouseDown={(e) => onRowMouse(item, e)}
						onDoubleClick={() => open(item)}
						onContextMenu={fileMenu.onContextMenu(item)}
						title={item.name}
					>
						<img
							src={iconFor(item.folder ? "folder" : kindOf(item.name), true)}
							alt=""
						/>
						<div style={{ minWidth: 0 }}>
							<div className="label">{middleTruncate(item.name, 28)}</div>
							{viewMode === "tiles" && (
								<div className="sub">
									{typeLabel(item)}
									{item.folder ? "" : ` · ${formatSize(item.size)}`}
								</div>
							)}
						</div>
					</div>
				))}
			</div>
		)
	} else if (viewMode === "list") {
		body = (
			<div className="list-columns">
				{sorted.map((item) => (
					<div
						key={item.key}
						className={`listitem ${selectedIds.has(item.key) ? "selected" : ""}`}
						onMouseDown={(e) => onRowMouse(item, e)}
						onDoubleClick={() => open(item)}
						onContextMenu={fileMenu.onContextMenu(item)}
						title={item.name}
					>
						<img src={iconFor(item.folder ? "folder" : kindOf(item.name))} alt="" />
						<span>{item.name}</span>
					</div>
				))}
			</div>
		)
	} else if (grouped) {
		const now = new Date()
		const buckets = new Map<Group, OssItem[]>()
		for (const item of sorted) {
			const g = item.folder ? "更早" : groupOf(item.modified, now)
			const list = buckets.get(g) ?? []
			list.push(item)
			buckets.set(g, list)
		}
		body = (
			<>
				{GROUP_ORDER.filter((g) => buckets.has(g)).map((g) => {
					const open = !collapsedGroups.has(g)
					return (
						<div key={g}>
							<button
								type="button"
								className="group-head"
								aria-expanded={open}
								onClick={() =>
									setCollapsedGroups((prev) => {
										const next = new Set(prev)
										next.has(g) ? next.delete(g) : next.add(g)
										return next
									})
								}
							>
								<Icon name="chevron" />
								{g}（{buckets.get(g)!.length}）
							</button>
							{open && buckets.get(g)!.map(renderRow)}
						</div>
					)
				})}
			</>
		)
	} else if (sorted.length > VIRTUAL_THRESHOLD) {
		/* 虚拟滚动：行高从 --row-h 实测换算，不硬编码 */
		const rowPx = 2 * rem
		const overscan = 8
		const first = Math.max(0, Math.floor(scrollTop / rowPx) - overscan)
		const count = Math.ceil((paneHeight || rowPx * 20) / rowPx) + overscan * 2
		const slice = sorted.slice(first, first + count)
		body = (
			<div style={{ height: sorted.length * rowPx, position: "relative" }}>
				<div style={{ transform: `translateY(${first * rowPx}px)` }}>
					{slice.map(renderRow)}
				</div>
			</div>
		)
	} else {
		body = <>{sorted.map(renderRow)}</>
	}

	return (
		<>
			{header}
			<div
				className="filepane"
				ref={(el) => {
					paneRef.current = el
					sizeRef.current = el
				}}
				style={{ "--cols": cols } as React.CSSProperties}
				onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
				onMouseDown={(e) => {
					/* 点空白处取消选中 */
					if (e.target === e.currentTarget) clearSelection()
				}}
				/* 空白处右键：事件从行上冒泡过来的已经被行处理掉了 */
				onContextMenu={fileMenu.onContextMenu(null)}
			>
				{body}
			</div>
			{fileMenu.render()}
		</>
	)
}

/* oss:// 根目录的内容。搜索框在这里也生效，Bucket 多的账号靠它找。 */
function BucketList() {
	const buckets = useSessionStore((s) => s.buckets)
	const searchQuery = useExplorerStore((s) => s.searchQuery)
	const setSearchQuery = useExplorerStore((s) => s.setSearchQuery)
	const navigate = useExplorerStore((s) => s.navigate)

	const q = searchQuery.trim().toLowerCase()
	const shown = q ? buckets.filter((b) => b.name.toLowerCase().includes(q)) : buckets

	if (!buckets.length) return <NoBucket />
	if (!shown.length) return <NoResults query={searchQuery} onClear={() => setSearchQuery("")} />

	return (
		<>
			{shown.map((b) => (
				<div
					key={b.name}
					className="row"
					tabIndex={0}
					title={b.name}
					onDoubleClick={() => navigate(b.name)}
					onKeyDown={(e) => {
						if (e.key === "Enter") navigate(b.name)
					}}
				>
					<span className="cell">
						<img src={iconFor("bucket")} alt="" />
						{b.name}
					</span>
					<span className="cell muted">{b.location}</span>
					<span className="cell muted">{b.storageClass}</span>
				</div>
			))}
		</>
	)
}

function HeaderCell({
	label,
	active,
	order,
	onSort,
	onResize,
	baseWidth,
}: {
	label: string
	active: boolean
	order: "asc" | "desc"
	onSort: () => void
	onResize: (dx: number, base: number) => void
	baseWidth: () => number
}) {
	const { dragging, handlers } = useDrag((dx, _dy, base) => onResize(dx, base), baseWidth)
	return (
		<button type="button" className="th" onClick={onSort}>
			<span>{label}</span>
			{active && <span>{order === "asc" ? "▲" : "▼"}</span>}
			<span
				className={`th-grip ${dragging ? "dragging" : ""}`}
				role="separator"
				aria-label={`调整${label}列宽`}
				onClick={(e) => e.stopPropagation()}
				{...handlers}
			/>
		</button>
	)
}
