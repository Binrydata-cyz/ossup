/* list-objects-v2 的解析 + 文件分类。和 buckets.js 一样刻意不 import tauri 和图片，
   好让 node --test 直接跑。图标文件的映射在 fileicon.js。 */

const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : [])

/* 去掉当前目录前缀，只留这一层的名字 */
const strip = (key, prefix) => (key.startsWith(prefix) ? key.slice(prefix.length) : key)

/* 目录（CommonPrefixes）排在文件（Contents）前面，和文件管理器一致。
   prefix 用 "" 表示 bucket 根。 */
export function pickObjects(json, prefix = "") {
	const folders = toArray(json?.CommonPrefixes)
		.map((p) => {
			const key = typeof p === "string" ? p : (p?.Prefix ?? "")
			return { name: strip(key, prefix).replace(/\/$/, ""), key, folder: true }
		})
		.filter((o) => o.name)

	const files = toArray(json?.Contents)
		.map((c) => ({
			name: strip(c?.Key ?? "", prefix),
			key: c?.Key ?? "",
			size: Number(c?.Size ?? 0),
			modified: c?.LastModified ?? "",
			storageClass: c?.StorageClass ?? "",
			folder: false,
		}))
		/* 目录占位对象（key 就是 prefix 本身，或以 / 结尾）不该当文件列出来 */
		.filter((o) => o.name && !o.name.endsWith("/"))

	return [...folders, ...files]
}

/* 和 ListBuckets 一样，布尔值是字符串 "true" */
export function nextToken(json) {
	return String(json?.IsTruncated) === "true"
		? (json?.NextContinuationToken ?? "")
		: ""
}

const CODE = new Set([
	"json", "jsonl", "js", "ts", "py", "sh", "yaml", "yml", "xml", "html", "css",
	"csv", "tsv", "md", "txt", "log", "sql", "toml", "ini", "conf",
])
const VIDEO = new Set([
	"mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v", "mpg", "mpeg", "ts",
])

/* 返回图标种类，fileicon.js 再映射到具体 png。
   注意 "ts" 既是 TypeScript 也是视频流封装——OSS 上更可能是视频，归 video。 */
export function kindOf(name) {
	const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase()
	if (!name.includes(".")) return "file"
	if (ext === "pdf") return "pdf"
	if (VIDEO.has(ext)) return "video"
	if (CODE.has(ext)) return "code"
	return "file"
}

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"]

export function formatSize(bytes) {
	if (!Number.isFinite(bytes) || bytes < 0) return ""
	let n = bytes
	let i = 0
	while (n >= 1024 && i < UNITS.length - 1) {
		n /= 1024
		i++
	}
	return `${i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)} ${UNITS[i]}`
}

/* "2024-06-28T06:26:03.000Z" -> "2024-06-28 06:26"，列表里看日期不需要秒 */
export function formatTime(iso) {
	const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(iso ?? ""))
	return m ? `${m[1]} ${m[2]}` : ""
}
