import assert from "node:assert/strict"
import { test } from "node:test"

import {
	MAX_EXPIRES_SECONDS,
	formatDateTime,
	formatSize,
	groupOf,
	middleTruncate,
	parseDuration,
	parseSpeed,
	formatSpeed,
} from "./format.ts"

test("parseDuration 认 ossutil 的时长写法", () => {
	assert.equal(parseDuration("30m"), 1800)
	assert.equal(parseDuration("1h"), 3600)
	assert.equal(parseDuration("1h30m"), 5400)
	assert.equal(parseDuration("7d"), MAX_EXPIRES_SECONDS)
	assert.equal(parseDuration("1w"), MAX_EXPIRES_SECONDS)
	assert.equal(parseDuration(" 2H "), 7200)
})

test("parseDuration 认不出就返回 null，不猜", () => {
	assert.equal(parseDuration(""), null)
	assert.equal(parseDuration("1"), null)
	assert.equal(parseDuration("h"), null)
	assert.equal(parseDuration("1小时"), null)
	assert.equal(parseDuration("0s"), null)
	/* ms 故意不收：和分钟的 m 前缀撞，签链接也用不到毫秒 */
	assert.equal(parseDuration("500ms"), null)
})

test("formatSize 进位到合适单位", () => {
	assert.equal(formatSize(0), "0 B")
	assert.equal(formatSize(512), "512 B")
	assert.equal(formatSize(1024), "1.0 KB")
	assert.equal(formatSize(1536), "1.5 KB")
	assert.equal(formatSize(1024 ** 3 * 2), "2.0 GB")
	assert.equal(formatSize(NaN), "")
})

test("formatDateTime 走 Intl，固定时区才不随机器飘", () => {
	const got = formatDateTime("2026-08-04T02:21:00.000Z", "zh-CN", "Asia/Shanghai")
	assert.match(got, /2026\/8\/4/)
	assert.match(got, /10:21/)
	assert.equal(formatDateTime(""), "")
	assert.equal(formatDateTime("不是日期"), "")
})

/* 基准取月中的 2026-08-20（周四），本周从 8/17 周一起算、上周从 8/10 起算、
   本月从 8/1 起算 —— 只有这样六组才都够得着，见下一个测试。 */
const now = new Date(2026, 7, 20, 12, 0, 0)
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 9).toISOString()

test("groupOf 按修改日期分六组", () => {
	assert.equal(groupOf(at(2026, 8, 20), now), "今天")
	assert.equal(groupOf(at(2026, 8, 19), now), "昨天")
	assert.equal(groupOf(at(2026, 8, 18), now), "本周")
	assert.equal(groupOf(at(2026, 8, 12), now), "上周")
	assert.equal(groupOf(at(2026, 8, 5), now), "本月")
	assert.equal(groupOf(at(2026, 5, 1), now), "更早")
	assert.equal(groupOf("", now), "更早")
})

test("月初时「本月」够不着，这是分组定义使然不是 bug", () => {
	/* 8/4 那天，上周边界（7/27）比月初（8/1）还早，中间没有空隙留给"本月" */
	const early = new Date(2026, 7, 4, 12)
	assert.equal(groupOf(at(2026, 8, 1), early), "上周")
})

test("周一当天算本周", () => {
	assert.equal(groupOf(at(2026, 8, 17), now), "本周")
})

test("middleTruncate 中间截断且保留扩展名", () => {
	assert.equal(middleTruncate("short.txt", 40), "short.txt")
	const got = middleTruncate("很长很长很长很长很长很长很长很长的文件名最终版.xlsx", 20)
	assert.ok(got.endsWith(".xlsx"), got)
	assert.ok(got.includes("…"), got)
	assert.ok(got.length <= 20, got)
})

test("middleTruncate：没有扩展名也不炸", () => {
	const got = middleTruncate("A".repeat(100), 10)
	assert.ok(got.length <= 10, got)
	assert.ok(got.includes("…"))
})

test("parseSpeed 认 ossutil 1.x 和 2.x 两种写法", () => {
	assert.equal(parseSpeed("1 B/s"), 1)
	assert.equal(parseSpeed("1 KB/s"), 1024)
	/* 2.x 的 MiB 和 1.x 的 MB 在 ossutil 里是同一个意思，都按 1024 算 */
	assert.equal(parseSpeed("1 MiB/s"), 1024 ** 2)
	assert.equal(parseSpeed("1 MB/s"), 1024 ** 2)
	assert.equal(parseSpeed("6.6 MB/s"), 6.6 * 1024 ** 2)
	assert.equal(parseSpeed("speed: 2 GB/s"), 2 * 1024 ** 3)
})

test("parseSpeed 认不出返回 null，不要猜成 0", () => {
	assert.equal(parseSpeed(""), null)
	assert.equal(parseSpeed("—"), null)
	assert.equal(parseSpeed("MB/s"), null)
})

test("formatSpeed 给不出数就显示破折号", () => {
	assert.equal(formatSpeed(1024), "1.0 KB/s")
	assert.equal(formatSpeed(0), "—")
	assert.equal(formatSpeed(NaN), "—")
})
