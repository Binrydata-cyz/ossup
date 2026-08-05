/* 纯展示格式化。同样不 import tauri，可被 node --test 直接跑。 */

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"]

export function formatSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return ""
	let n = bytes
	let i = 0
	while (n >= 1024 && i < UNITS.length - 1) {
		n /= 1024
		i++
	}
	return `${i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)} ${UNITS[i]}`
}

/* 规格要的 "2026/8/4 上午 10:21"。locale/timeZone 可注入，
   否则测试会随运行机器的时区飘。 */
export function formatDateTime(
	iso: string,
	locale = "zh-CN",
	timeZone?: string,
): string {
	const d = new Date(iso)
	if (!iso || Number.isNaN(d.getTime())) return ""
	return new Intl.DateTimeFormat(locale, {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		hour12: true,
		timeZone,
	}).format(d)
}

export type Group = "今天" | "昨天" | "本周" | "上周" | "本月" | "更早"

const DAY = 86_400_000

const startOfDay = (d: Date) =>
	new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/* 周一为一周之首（zh-CN 习惯）。getDay() 里周日是 0，换算成 6。 */
const startOfWeek = (d: Date) => {
	const offset = (d.getDay() + 6) % 7
	return startOfDay(d) - offset * DAY
}

export function groupOf(iso: string, now: Date = new Date()): Group {
	const d = new Date(iso)
	if (!iso || Number.isNaN(d.getTime())) return "更早"
	const t = d.getTime()
	const today = startOfDay(now)
	if (t >= today) return "今天"
	if (t >= today - DAY) return "昨天"
	const thisWeek = startOfWeek(now)
	if (t >= thisWeek) return "本周"
	if (t >= thisWeek - 7 * DAY) return "上周"
	if (t >= new Date(now.getFullYear(), now.getMonth(), 1).getTime()) return "本月"
	return "更早"
}

export const GROUP_ORDER: Group[] = ["今天", "昨天", "本周", "上周", "本月", "更早"]

/* ossutil 1.x 写 "1.2 MB/s"，2.x 写 "1.2 MiB/s"。两种都按 1024 进位算 ——
   ossutil 内部就是这么算的，把 MB 当 1000 反而会把速度报低 2.4%。 */
const SPEED_UNITS: Record<string, number> = {
	"": 1,
	k: 1024,
	m: 1024 ** 2,
	g: 1024 ** 3,
	t: 1024 ** 4,
}

/** `"6.6 MB/s"` -> 每秒字节数。认不出返回 null，绝不猜成 0。 */
export function parseSpeed(text: string): number | null {
	const m = /([\d.]+)\s*([kmgt]?)i?b\/s/i.exec(text ?? "")
	if (!m) return null
	const value = Number(m[1])
	if (!Number.isFinite(value)) return null
	return value * SPEED_UNITS[m[2].toLowerCase()]
}

export function formatSpeed(bytesPerSecond: number): string {
	if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "—"
	return `${formatSize(bytesPerSecond)}/s`
}

const UNIT_SECONDS: Record<string, number> = {
	s: 1,
	m: 60,
	h: 3600,
	d: 86_400,
	w: 604_800,
}

/** presign 的 --expires-duration 上限，OSS v4 签名最长就是一周 */
export const MAX_EXPIRES_SECONDS = 604_800

/**
 * 解析 ossutil 的时长写法（`30m` / `1h` / `1h30m` / `7d`）成秒。
 * 认不出返回 null。ms 这个后缀故意不收 —— 签名链接没有毫秒级的用法，
 * 而且它和 `m`（分钟）前缀相同，放进来只会让人写错。
 */
export function parseDuration(text: string): number | null {
	const value = text.trim().toLowerCase()
	if (!/^(\d+[smhdw])+$/.test(value)) return null
	let total = 0
	for (const [, num, unit] of value.matchAll(/(\d+)([smhdw])/g)) {
		total += Number(num) * UNIT_SECONDS[unit]
	}
	return total > 0 ? total : null
}

/* 超长文件名中间截断，保留扩展名：很长的文件名…最终版.xlsx */
export function middleTruncate(name: string, max = 40): string {
	if (name.length <= max) return name
	const dot = name.lastIndexOf(".")
	const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : ""
	const stem = ext ? name.slice(0, dot) : name
	/* 省略号自己占 1 位，两侧各分一半 */
	const keep = max - ext.length - 1
	if (keep < 4) return name.slice(0, Math.max(1, max - 1)) + "…"
	const head = Math.ceil(keep / 2)
	const tail = keep - head
	return `${stem.slice(0, head)}…${stem.slice(stem.length - tail)}${ext}`
}
