/* list-objects-v2 的解析 + 文件分类。和 buckets.ts 一样刻意不 import tauri 和图片，
   好让 node --test 直接跑。种类到具体图标的映射在 icons.ts，展示格式化在 format.ts。 */

export type OssItem = {
	name: string
	key: string
	size: number
	modified: string
	storageClass: string
	folder: boolean
}

const toArray = (v: unknown): any[] => (Array.isArray(v) ? v : v ? [v] : [])

/* 去掉当前目录前缀，只留这一层的名字 */
const strip = (key: string, prefix: string) =>
	key.startsWith(prefix) ? key.slice(prefix.length) : key

/* 目录（CommonPrefixes）排在文件（Contents）前面，和文件管理器一致。
   prefix 用 "" 表示 bucket 根。 */
export function pickObjects(json: any, prefix = ""): OssItem[] {
	const folders: OssItem[] = toArray(json?.CommonPrefixes)
		.map((p: any) => {
			const key = typeof p === "string" ? p : (p?.Prefix ?? "")
			return {
				name: strip(key, prefix).replace(/\/$/, ""),
				key,
				size: 0,
				modified: "",
				storageClass: "",
				folder: true,
			}
		})
		.filter((o) => o.name)

	const files: OssItem[] = toArray(json?.Contents)
		.map((c: any) => ({
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
export function nextToken(json: any): string {
	return String(json?.IsTruncated) === "true"
		? (json?.NextContinuationToken ?? "")
		: ""
}

export type Kind =
	| "bucket"
	| "folder"
	| "image"
	| "doc"
	| "sheet"
	| "archive"
	| "code"
	| "pdf"
	| "video"
	| "file"

/* 顺序即优先级：先查的赢。".ts" 同时是 TypeScript 和视频流封装，
   OSS 上更可能是后者，所以 VIDEO 排在 CODE 前面。 */
const BY_EXT: [Kind, Set<string>][] = [
	["pdf", new Set(["pdf"])],
	[
		"image",
		new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "ico", "tif", "tiff", "avif", "heic"]),
	],
	/* 音频和视频归一类：都是"播放"的东西，共用视频图标 */
	[
		"video",
		new Set([
			"mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v", "mpg", "mpeg", "ts",
			"3gp", "rmvb", "m2ts", "vob",
			"wav", "mp3", "flac", "aac", "m4a", "ogg", "oga", "opus", "wma", "aiff", "amr",
		]),
	],
	/* 表格类只留真正的电子表格；csv/tsv 是纯文本，归代码 */
	["sheet", new Set(["xls", "xlsx", "xlsm", "ods", "numbers"])],
	["doc", new Set(["doc", "docx", "odt", "rtf", "ppt", "pptx", "pages", "key"])],
	["archive", new Set(["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zst", "tgz"])],
	[
		"code",
		new Set([
			"json", "jsonl", "ndjson", "js", "mjs", "cjs", "jsx", "tsx", "py", "rs", "go",
			"java", "c", "h", "cpp", "hpp", "cs", "rb", "php", "swift", "kt", "lua", "r",
			"sh", "bat", "ps1", "yaml", "yml", "xml", "html", "htm", "css", "scss", "less",
			"md", "txt", "text", "log", "csv", "tsv", "sql", "toml", "ini", "cfg", "conf",
			"env", "properties", "srt", "vtt", "ass",
		]),
	],
]

export function kindOf(name: string): Kind {
	if (!name.includes(".")) return "file"
	const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase()
	for (const [kind, set] of BY_EXT) if (set.has(ext)) return kind
	return "file"
}

/* 「类型」列显示的中文名 */
const KIND_LABEL: Record<Kind, string> = {
	bucket: "Bucket",
	folder: "文件夹",
	image: "图片",
	doc: "文档",
	sheet: "表格",
	archive: "压缩包",
	code: "代码",
	pdf: "PDF",
	video: "视频",
	file: "文件",
}

export function typeLabel(item: Pick<OssItem, "name" | "folder">): string {
	if (item.folder) return KIND_LABEL.folder
	const ext = item.name.includes(".")
		? item.name.slice(item.name.lastIndexOf(".") + 1).toUpperCase()
		: ""
	const kind = KIND_LABEL[kindOf(item.name)]
	return ext ? `${ext} ${kind}` : kind
}
