/* 左组：复制 / 粘贴 / 重命名 / 共享 / 删除 —— 和右键菜单调同一份动作。
   右组：排序 / 查看 / 更多，图标+文字下拉。
   容器不够宽时按优先级把左组收进 ⋯ 溢出菜单。 */

import { useSize } from "../lib/hooks.ts"
import { useOssActions } from "../lib/useOssActions.ts"
import { useExplorerStore, type SortBy, type ViewMode } from "../store/explorer.ts"
import { usePrefsStore } from "../store/prefs.ts"
import { useUiStore } from "../store/ui.ts"
import { Icon, type IconName } from "./Icon.tsx"
import { useMenu, type MenuItem } from "./Menu.tsx"

const SORTS: { id: SortBy; label: string }[] = [
	{ id: "name", label: "名称" },
	{ id: "modified", label: "修改日期" },
	{ id: "type", label: "类型" },
	{ id: "size", label: "大小" },
]

const VIEWS: { id: ViewMode; label: string }[] = [
	{ id: "details", label: "详细信息" },
	{ id: "large", label: "大图标" },
	{ id: "list", label: "列表" },
	{ id: "tiles", label: "平铺" },
]

/* 一个左组按钮约 3rem，右组三个约 18rem */
const ACTION_REM = 3.5
const RIGHT_REM = 18

export function Toolbar() {
	const { ref, width } = useSize<HTMLDivElement>()
	const sortBy = useExplorerStore((s) => s.sortBy)
	const sortOrder = useExplorerStore((s) => s.sortOrder)
	const setSort = useExplorerStore((s) => s.setSort)
	const viewMode = usePrefsStore((s) => s.viewMode)
	const setViewMode = usePrefsStore((s) => s.setViewMode)
	const toggleLog = useUiStore((s) => s.toggleLog)

	const a = useOssActions()
	const sortMenu = useMenu()
	const viewMenu = useMenu()
	const moreMenu = useMenu()

	/* 顺序即保留优先级：越靠后越先被收进 ⋯ */
	const actions: { id: string; label: string; icon: IconName; disabled: boolean; run: () => void }[] =
		[
			{
				id: "copy",
				label: "复制",
				icon: "copy",
				disabled: a.busy || !a.selected.length,
				run: a.copySelection,
			},
			{
				id: "paste",
				label: a.clipboardCount ? `粘贴（${a.clipboardCount} 项）` : "粘贴",
				icon: "paste",
				disabled: a.busy || !a.canPaste,
				run: a.paste,
			},
			{
				id: "rename",
				label: "重命名",
				icon: "rename",
				/* 重命名一次只能改一个 */
				disabled: a.busy || !a.one,
				run: () => a.one && a.renameItem(a.one),
			},
			{
				id: "share",
				label: "共享",
				icon: "share",
				/* presign 签不了目录 */
				disabled: a.busy || !a.one || a.one.folder,
				run: () => a.one && a.shareItem(a.one),
			},
			{
				id: "delete",
				label: "删除",
				icon: "trash",
				disabled: a.busy || !a.selected.length,
				run: () => a.deleteItems(a.selected),
			},
		]

	const rem = 16
	const room = Math.max(0, (width || 9999) / rem - RIGHT_REM)
	const visibleCount = Math.max(0, Math.min(actions.length, Math.floor(room / ACTION_REM)))
	const shown = actions.slice(0, visibleCount)
	const overflowed = actions.slice(visibleCount)

	const asMenuItems = (list: typeof actions): MenuItem[] =>
		list.map((x) => ({ label: x.label, disabled: x.disabled, onSelect: x.run }))

	return (
		<div className="toolbar" ref={ref}>
			{shown.map((x, i) => (
				<span key={x.id} style={{ display: "contents" }}>
					{i > 0 && <span className="tbtn-sep" />}
					<button
						type="button"
						className="tbtn"
						title={x.label}
						aria-label={x.label}
						disabled={x.disabled}
						onClick={x.run}
					>
						<Icon name={x.icon} />
					</button>
				</span>
			))}

			<span className="toolbar-spacer" />

			<button type="button" className="tbtn" onClick={sortMenu.openUnder}>
				<Icon name="sort" />
				排序
			</button>
			<button type="button" className="tbtn" onClick={viewMenu.openUnder}>
				<Icon name="view" />
				查看
			</button>
			<button type="button" className="tbtn" onClick={moreMenu.openUnder}>
				<Icon name="more" />
				更多
			</button>

			{sortMenu.render(
				SORTS.map((s) => ({
					label: `${s.label}${sortBy === s.id ? (sortOrder === "asc" ? " ▲" : " ▼") : ""}`,
					checkable: true,
					checked: sortBy === s.id,
					onSelect: () => setSort(s.id),
				})),
			)}

			{viewMenu.render(
				VIEWS.map((v) => ({
					label: v.label,
					checkable: true,
					checked: viewMode === v.id,
					onSelect: () => setViewMode(v.id),
				})),
			)}

			{moreMenu.render([
				...asMenuItems(overflowed),
				...(overflowed.length ? [{ separator: true, label: "sep" }] : []),
				{ label: "新建文件夹", disabled: !a.bucket || a.busy, onSelect: a.newFolder },
				{ label: "ossutil 日志", onSelect: toggleLog },
			])}
		</div>
	)
}
