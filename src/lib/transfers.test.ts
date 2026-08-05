import assert from "node:assert/strict"
import { test } from "node:test"

/* 派生逻辑从 store/transfers.ts 复制过来测：那个文件 import 了 zustand，
   node --test 加载不了。两边改动要一起改。
   ponytail: 只有这三个纯函数值得测，为它们单开一个模块不划算。 */
type T = { kind: "upload" | "download"; phase: "running" | "done" | "error"; percent: number; speed: number | null }

const running = (items: T[]) => items.filter((t) => t.phase === "running")

function overallPercent(items: T[]): number {
	const live = running(items)
	if (!live.length) return items.length ? 100 : 0
	return live.reduce((a, t) => a + t.percent, 0) / live.length
}

function totalSpeed(items: T[]): number {
	return running(items).reduce((a, t) => a + (t.speed ?? 0), 0)
}

function summarize(items: T[]): string {
	const live = running(items)
	if (!live.length) return ""
	const up = live.filter((t) => t.kind === "upload").length
	const down = live.length - up
	return [up && `正在上传 ${up} 个任务`, down && `正在下载 ${down} 个任务`]
		.filter(Boolean)
		.join(" · ")
}

const up = (percent: number, speed: number | null = null): T => ({
	kind: "upload",
	phase: "running",
	percent,
	speed,
})
const down = (percent: number, speed: number | null = null): T => ({
	kind: "download",
	phase: "running",
	percent,
	speed,
})

test("总体进度取运行中任务的平均", () => {
	assert.equal(overallPercent([up(20), up(80)]), 50)
	assert.equal(overallPercent([up(30)]), 30)
})

test("已完成的任务不该把总体进度拖低", () => {
	const items: T[] = [{ ...up(100), phase: "done" }, up(40)]
	assert.equal(overallPercent(items), 40)
})

test("全部结束时是 100%，一个任务都没有时是 0%", () => {
	assert.equal(overallPercent([{ ...up(100), phase: "done" }]), 100)
	assert.equal(overallPercent([]), 0)
})

test("总速度是各任务求和 —— 它们各占一份带宽", () => {
	assert.equal(totalSpeed([up(10, 1024), down(20, 2048)]), 3072)
	/* 还没拿到速度样本的按 0 算，不能让整行变 NaN */
	assert.equal(totalSpeed([up(10, null), up(20, 512)]), 512)
	assert.equal(totalSpeed([{ ...up(50, 9999), phase: "done" }]), 0)
})

test("摘要按方向分别计数", () => {
	assert.equal(summarize([up(1), up(2), down(3)]), "正在上传 2 个任务 · 正在下载 1 个任务")
	assert.equal(summarize([down(3)]), "正在下载 1 个任务")
	assert.equal(summarize([]), "")
	assert.equal(summarize([{ ...up(100), phase: "done" }]), "")
})
