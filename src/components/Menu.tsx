/* 下拉 / 右键菜单。定位在视口坐标上，超出边界自动回收。 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"

export type MenuItem = {
	label: string
	onSelect?: () => void
	disabled?: boolean
	checked?: boolean
	checkable?: boolean
	separator?: boolean
}

export function Menu({
	x,
	y,
	items,
	onClose,
}: {
	x: number
	y: number
	items: MenuItem[]
	onClose: () => void
}) {
	const ref = useRef<HTMLDivElement>(null)
	const [pos, setPos] = useState({ x, y })

	/* 先渲染再量，量完再挪进视口 —— 菜单宽高取决于内容，没法预先算 */
	useLayoutEffect(() => {
		const el = ref.current
		if (!el) return
		const r = el.getBoundingClientRect()
		setPos({
			x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
			y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
		})
	}, [x, y])

	useEffect(() => {
		const onDown = (e: MouseEvent) => {
			if (!ref.current?.contains(e.target as Node)) onClose()
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose()
		}
		/* capture 阶段，抢在按钮自己的 onClick 之前关掉 */
		document.addEventListener("mousedown", onDown, true)
		document.addEventListener("keydown", onKey)
		window.addEventListener("resize", onClose)
		return () => {
			document.removeEventListener("mousedown", onDown, true)
			document.removeEventListener("keydown", onKey)
			window.removeEventListener("resize", onClose)
		}
	}, [onClose])

	return (
		<div className="menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
			{items.map((item, i) =>
				item.separator ? (
					<div className="menu-sep" key={`sep-${i}`} />
				) : (
					<button
						type="button"
						role="menuitem"
						key={item.label}
						className={[
							"menu-item",
							item.checkable ? "checkable" : "",
							item.checked ? "checked" : "",
						]
							.filter(Boolean)
							.join(" ")}
						disabled={item.disabled}
						onClick={() => {
							item.onSelect?.()
							onClose()
						}}
					>
						{item.label}
					</button>
				),
			)}
		</div>
	)
}

/** 管理一个菜单的开关和坐标。 */
export function useMenu() {
	const [at, setAt] = useState<{ x: number; y: number } | null>(null)
	return {
		at,
		close: () => setAt(null),
		openAt: (x: number, y: number) => setAt({ x, y }),
		/** 挂在按钮上：菜单贴着按钮左下角弹出 */
		openUnder: (e: { currentTarget: HTMLElement }) => {
			const r = e.currentTarget.getBoundingClientRect()
			setAt({ x: r.left, y: r.bottom + 2 })
		},
		render: (items: MenuItem[]): ReactNode =>
			at ? <Menu x={at.x} y={at.y} items={items} onClose={() => setAt(null)} /> : null,
	}
}
