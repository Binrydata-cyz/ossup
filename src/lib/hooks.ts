import { useEffect, useRef, useState } from "react"

/** 媒体查询，断点用 em 所以不受用户缩放影响。 */
export function useMediaQuery(query: string): boolean {
	const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
	useEffect(() => {
		const mq = window.matchMedia(query)
		const onChange = () => setMatches(mq.matches)
		onChange()
		mq.addEventListener("change", onChange)
		return () => mq.removeEventListener("change", onChange)
	}, [query])
	return matches
}

export type Breakpoint = "wide" | "medium" | "narrow"

export function useBreakpoint(): Breakpoint {
	const narrow = useMediaQuery("(max-width: 48em)")
	const medium = useMediaQuery("(max-width: 75em)")
	return narrow ? "narrow" : medium ? "medium" : "wide"
}

/** 值防抖。搜索框要求 300ms。 */
export function useDebounced<T>(value: T, ms: number): T {
	const [debounced, setDebounced] = useState(value)
	useEffect(() => {
		const t = setTimeout(() => setDebounced(value), ms)
		return () => clearTimeout(t)
	}, [value, ms])
	return debounced
}

/** 实测元素尺寸。面包屑折叠和骨架屏行数都靠它，不按字符数硬猜。 */
export function useSize<T extends HTMLElement>() {
	const ref = useRef<T>(null)
	const [size, setSize] = useState({ width: 0, height: 0 })
	useEffect(() => {
		const el = ref.current
		if (!el) return
		const ro = new ResizeObserver(([entry]) => {
			const r = entry.contentRect
			setSize({ width: r.width, height: r.height })
		})
		ro.observe(el)
		return () => ro.disconnect()
	}, [])
	return { ref, ...size }
}

/** 把 rem 换算成 px —— 行高、列宽都存 rem，实际计算要 px。 */
export function useRemSize(): number {
	const [rem, setRem] = useState(16)
	useEffect(() => {
		const read = () =>
			setRem(parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)
		read()
		window.addEventListener("resize", read)
		return () => window.removeEventListener("resize", read)
	}, [])
	return rem
}

/**
 * 指针拖拽。按下后接管指针，回调收到相对起点的位移（px）和按下瞬间的基线值。
 *
 * 基线必须由 onStart 在按下时取一次并锁住：拖动过程中每次 setState 都会重渲染、
 * 重建 onMove 闭包，若闭包直接读当前宽度，而 dx 又始终从按下点算起，位移会被
 * 重复累加。列宽和侧边栏宽度共用这套。
 */
export function useDrag(
	onMove: (dx: number, dy: number, base: number) => void,
	onStart: () => number = () => 0,
) {
	const [dragging, setDragging] = useState(false)
	const start = useRef({ x: 0, y: 0 })
	const base = useRef(0)

	const onPointerDown = (e: React.PointerEvent) => {
		e.preventDefault()
		e.stopPropagation()
		start.current = { x: e.clientX, y: e.clientY }
		base.current = onStart()
		setDragging(true)
		const el = e.currentTarget as HTMLElement
		el.setPointerCapture(e.pointerId)
	}

	const onPointerMove = (e: React.PointerEvent) => {
		if (!dragging) return
		onMove(e.clientX - start.current.x, e.clientY - start.current.y, base.current)
	}

	const stop = (e: React.PointerEvent) => {
		if (!dragging) return
		setDragging(false)
		;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
	}

	return {
		dragging,
		handlers: {
			onPointerDown,
			onPointerMove,
			onPointerUp: stop,
			onPointerCancel: stop,
		},
	}
}

/** 只需要知道从哪个元素弹出来，不需要完整的 React 事件。 */
export type AnchorEvent = { currentTarget: HTMLElement }

/** 长按（历史下拉用 500ms）。 */
export function useLongPress(onLongPress: (e: AnchorEvent) => void, ms = 500) {
	const timer = useRef<number | undefined>(undefined)
	const fired = useRef(false)

	const clear = () => {
		if (timer.current !== undefined) clearTimeout(timer.current)
		timer.current = undefined
	}

	return {
		/** 长按已触发时应吞掉随后的 click */
		consumed: () => {
			const was = fired.current
			fired.current = false
			return was
		},
		handlers: {
			onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
				fired.current = false
				/* React 会回收合成事件，异步用之前必须先把元素捞出来 */
				const anchor: AnchorEvent = { currentTarget: e.currentTarget }
				timer.current = window.setTimeout(() => {
					fired.current = true
					onLongPress(anchor)
				}, ms)
			},
			onPointerUp: clear,
			onPointerLeave: clear,
			onPointerCancel: clear,
		},
	}
}
