/* 并发传输任务表。后端按 task_id 分派事件，这里按同一个 id 归拢。

   放 store 而不是 TaskBar 的 useState：下载从右键菜单发起、上传从状态栏发起，
   两边都要往同一张表里加任务。 */

import { create } from "zustand"

import { parseSpeed } from "../lib/format.ts"

export type TransferKind = "upload" | "download"
export type TransferPhase = "queued" | "running" | "done" | "error"

export type Transfer = {
	id: string
	kind: TransferKind
	/** 展示用的短名字，比如文件夹名或对象名 */
	label: string
	phase: TransferPhase
	percent: number
	files: number | null
	/** 3 秒滑动平均后的速度，字节/秒；没有样本时为 null */
	speed: number | null
	note: string
	startedAt: number
}

/** 速度滑动平均窗口。瞬时值抖得太厉害，看着像网络不稳。 */
const SPEED_WINDOW_MS = 3000

/** 完成/失败的任务在列表里留多久，让用户看得见结果 */
const KEEP_FINISHED_MS = 8000

/* 采样点不进 store：每秒要写好几次，进了会白白触发重渲染 */
const samples = new Map<string, { t: number; v: number }[]>()

/* 排队中任务的启动器。每个任务对应一个 ossutil 进程，不排队的话
   拖十个文件夹就是十个进程一起抢带宽，反而都慢。 */
const launchers = new Map<string, () => Promise<void>>()

let maxTasks = 3
export const setMaxTasks = (n: number) => {
	maxTasks = Math.max(1, Math.floor(n) || 1)
}

type State = {
	items: Transfer[]
	/** 入队。名额够就立刻 launch()，否则挂起等前面的跑完 */
	enqueue: (t: Pick<Transfer, "id" | "kind" | "label">, launch: () => Promise<void>) => void
	progress: (
		id: string,
		patch: { percent?: number | null; files?: number | null; speed?: string | null },
	) => void
	pump: () => void
	finish: (id: string, code: number | null) => void
	fail: (id: string, note: string) => void
	remove: (id: string) => void
	clearFinished: () => void
}

export const useTransfersStore = create<State>((set, get) => ({
	items: [],

	enqueue: ({ id, kind, label }, launch) => {
		samples.delete(id)
		launchers.set(id, launch)
		set((s) => ({
			items: [
				...s.items.filter((t) => t.id !== id),
				{
					id,
					kind,
					label,
					phase: "queued",
					percent: 0,
					files: null,
					speed: null,
					note: "",
					startedAt: Date.now(),
				},
			],
		}))
		get().pump()
	},

	/** 有空位就把排队中的任务依次放行 */
	pump: () => {
		const items = get().items
		let free = maxTasks - items.filter((t) => t.phase === "running").length
		if (free <= 0) return
		for (const t of items) {
			if (free <= 0) break
			if (t.phase !== "queued") continue
			const launch = launchers.get(t.id)
			if (!launch) continue
			launchers.delete(t.id)
			free--
			set((s) => ({
				items: s.items.map((x) =>
					x.id === t.id ? { ...x, phase: "running", startedAt: Date.now() } : x,
				),
			}))
			void launch().catch((err) => get().fail(t.id, String(err)))
		}
	},

	progress: (id, patch) => {
		let speed: number | null | undefined
		if (patch.speed) {
			const v = parseSpeed(patch.speed)
			if (v !== null) {
				const now = Date.now()
				const list = (samples.get(id) ?? []).filter((s) => now - s.t <= SPEED_WINDOW_MS)
				list.push({ t: now, v })
				samples.set(id, list)
				speed = list.reduce((a, s) => a + s.v, 0) / list.length
			}
		}
		set((s) => ({
			items: s.items.map((t) =>
				t.id === id
					? {
							...t,
							percent: patch.percent ?? t.percent,
							files: patch.files ?? t.files,
							speed: speed ?? t.speed,
						}
					: t,
			),
		}))
	},

	finish: (id, code) => {
		samples.delete(id)
		const ok = code === 0
		set((s) => ({
			items: s.items.map((t) =>
				t.id === id
					? {
							...t,
							phase: ok ? "done" : "error",
							percent: ok ? 100 : t.percent,
							speed: null,
							note: ok ? "已完成" : `已中断（退出码 ${code}）`,
						}
					: t,
			),
		}))
		get().pump()
		/* 结果停留一会儿再消失，不然任务一结束整行就凭空没了 */
		setTimeout(() => {
			if (get().items.find((t) => t.id === id)?.phase !== "running") get().remove(id)
		}, KEEP_FINISHED_MS)
	},

	fail: (id, note) => {
		samples.delete(id)
		launchers.delete(id)
		set((s) => ({
			items: s.items.map((t) => (t.id === id ? { ...t, phase: "error", note } : t)),
		}))
		get().pump()
	},

	remove: (id) => {
		samples.delete(id)
		launchers.delete(id)
		set((s) => ({ items: s.items.filter((t) => t.id !== id) }))
		get().pump()
	},

	clearFinished: () =>
		set((s) => ({ items: s.items.filter((t) => t.phase === "running") })),
}))

/* ---------- 派生（纯函数，好测） ---------- */

export const running = (items: Transfer[]) => items.filter((t) => t.phase === "running")

/** 总体进度 = 各任务进度的平均。字节权重拿不到，只能这么估，所以文案里写"约"。 */
export function overallPercent(items: Transfer[]): number {
	const live = running(items)
	if (!live.length) return items.length ? 100 : 0
	return live.reduce((a, t) => a + t.percent, 0) / live.length
}

/** 总速度 = 各任务速度求和 —— 它们各自占一份带宽 */
export function totalSpeed(items: Transfer[]): number {
	return running(items).reduce((a, t) => a + (t.speed ?? 0), 0)
}

/** "正在上传 2 个任务 · 正在下载 1 个任务" */
export function summarize(items: Transfer[]): string {
	const live = running(items)
	if (!live.length) return ""
	const up = live.filter((t) => t.kind === "upload").length
	const down = live.length - up
	const queued = items.filter((t) => t.phase === "queued").length
	return [
		up && `正在上传 ${up} 个任务`,
		down && `正在下载 ${down} 个任务`,
		queued && `${queued} 个排队中`,
	]
		.filter(Boolean)
		.join(" · ")
}
