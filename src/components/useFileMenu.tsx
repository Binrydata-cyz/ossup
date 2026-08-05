/* 文件行 / 空白处的右键菜单。动作全部来自 useOssActions，和工具栏共用同一份。 */

import { useState, type ReactNode } from "react"

import type { OssItem } from "../lib/objects.ts"
import { useOssActions } from "../lib/useOssActions.ts"
import { useExplorerStore } from "../store/explorer.ts"
import { useUiStore } from "../store/ui.ts"
import { Menu, type MenuItem } from "./Menu.tsx"

export function useFileMenu() {
	const [at, setAt] = useState<{ x: number; y: number; item: OssItem | null } | null>(null)

	const items = useExplorerStore((s) => s.items)
	const select = useExplorerStore((s) => s.select)
	const selectedIds = useExplorerStore((s) => s.selectedIds)
	const refresh = useExplorerStore((s) => s.refresh)
	const showToast = useUiStore((s) => s.showToast)

	const a = useOssActions()

	const itemMenu = (item: OssItem): MenuItem[] => [
		{ label: "打开", onSelect: () => a.openItem(item) },
		{ label: "下载", onSelect: () => a.downloadItem(item) },
		{ separator: true, label: "s1" },
		{ label: "复制", onSelect: a.copySelection },
		{
			label: a.clipboardCount ? `粘贴（${a.clipboardCount} 项）` : "粘贴",
			disabled: !a.canPaste,
			onSelect: a.paste,
		},
		{ separator: true, label: "s2" },
		{ label: "重命名", onSelect: () => a.renameItem(item) },
		{ label: "复制到", onSelect: () => a.copyItemTo(item) },
		{ label: "移动到", onSelect: () => a.moveItemTo(item) },
		{ separator: true, label: "s3" },
		{
			label: selectedIds.size > 1 ? `删除选中的 ${selectedIds.size} 项` : "删除",
			onSelect: () => a.deleteItems(selectedIds.size > 1 ? a.selected : [item]),
		},
		{ separator: true, label: "s4" },
		{
			/* presign 只签单个对象；对目录用 -r 会一次吐出成百上千条 URL，
			   塞进剪贴板没有意义，所以目录这项置灰。 */
			label: item.folder ? "生成链接（目录不支持）" : "生成链接…",
			disabled: item.folder,
			onSelect: () => a.shareItem(item),
		},
	]

	const blankMenu = (): MenuItem[] => [
		{ label: "刷新", onSelect: () => void refresh() },
		{ label: "新建文件夹", disabled: !a.bucket, onSelect: a.newFolder },
		{
			label: a.clipboardCount ? `粘贴（${a.clipboardCount} 项）` : "粘贴",
			disabled: !a.canPaste,
			onSelect: a.paste,
		},
		{ separator: true, label: "s1" },
		{
			label: "全选",
			disabled: !items.length,
			onSelect: () => {
				/* 没有 selectAll 动作，就用 range 从头选到尾 */
				select(items[0].key)
				select(items[items.length - 1].key, "range")
			},
		},
	]

	return {
		/** 挂到文件行上传 item，挂到空白区域传 null */
		onContextMenu: (item: OssItem | null) => (e: React.MouseEvent) => {
			e.preventDefault()
			e.stopPropagation()
			/* 右键一个没选中的行先把它选上；已在多选里的保持多选 */
			if (item && !selectedIds.has(item.key)) select(item.key)
			setAt({ x: e.clientX, y: e.clientY, item })
		},
		newFolder: a.newFolder,
		showToast,
		render: (): ReactNode =>
			at ? (
				<Menu
					x={at.x}
					y={at.y}
					items={at.item ? itemMenu(at.item) : blankMenu()}
					onClose={() => setAt(null)}
				/>
			) : null,
	}
}
