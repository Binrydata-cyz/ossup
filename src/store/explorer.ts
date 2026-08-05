/* 目录浏览状态：路径、历史、当前目录项、选中、搜索、排序、视图。 */

import { create } from "zustand"

import { friendlyError, isPermissionError, ossApi } from "../lib/ossApi.ts"
import { nextToken, pickObjects, type OssItem } from "../lib/objects.ts"
import { useSessionStore } from "./session.ts"

export type SortBy = "name" | "modified" | "type" | "size"
export type SortOrder = "asc" | "desc"
export type ViewMode = "details" | "large" | "list" | "tiles"

/** 路径统一是 `bucket/a/b`（无 oss:// 前缀、无首尾斜杠）；空串表示"还没进 bucket"。 */
export type Path = string

export const splitPath = (path: Path) => {
	const parts = path.split("/").filter(Boolean)
	return { bucket: parts[0] ?? "", prefix: parts.slice(1).join("/") }
}

export const joinPath = (bucket: string, prefix: string) =>
	[bucket, prefix].filter(Boolean).join("/")

/* 地址栏支持粘 oss:// 和控制台的 https 链接 */
export function parsePath(text: string): { path: Path; endpoint: string } | null {
	const value = text.trim()
	let m = /^oss:\/\/([^/\s]+)(?:\/(.*))?$/i.exec(value)
	if (m) return { path: joinPath(m[1], (m[2] ?? "").replace(/\/+$/, "")), endpoint: "" }
	m = /^https?:\/\/([^./\s]+)\.(oss-[^/\s]+?)(?:\/(.*))?$/i.exec(value)
	if (m) return { path: joinPath(m[1], (m[3] ?? "").replace(/\/+$/, "")), endpoint: m[2] }
	if (/^[a-z0-9][a-z0-9-]*(\/.*)?$/i.test(value)) {
		return { path: value.replace(/\/+$/, ""), endpoint: "" }
	}
	return null
}

/**
 * 每次改变当前位置都要过这里。两件事：
 *
 * 1. 换了 bucket 就跟着换 endpoint。Bucket 是跨地域的（同一个账号下可能同时有
 *    张家口和首尔的），拿旧地域的 endpoint 去请求新 bucket 只会得到 403
 *    AccessDenied，界面上看起来就像"没有权限"。必须在 refresh() 之前改完。
 *
 * 侧边栏是手动维护的收藏夹，导航不再往里加东西。
 */
function enterPath(from: Path, to: Path) {
	const before = splitPath(from).bucket
	const after = splitPath(to).bucket

	if (after && after !== before) {
		const session = useSessionStore.getState()
		const bucket = session.buckets.find((b) => b.name === after)
		if (bucket) session.useBucketEndpoint(bucket)
	}
}

/* 请求还没回来时用户已经切走 —— 旧结果必须丢掉，否则会写进错误的目录 */
let requestToken = 0

export const PAGE_SIZES = [100, 500, 1000] as const
export type PageSize = (typeof PAGE_SIZES)[number]

/** 换目录后旧游标全部作废，必须回到第一页 */
const RESET_PAGING = { pageIndex: 0, tokens: [""], hasNext: false }

type ExplorerState = {
	currentPath: Path
	breadcrumbs: string[]
	items: OssItem[]
	loading: boolean
	error: { message: string; permission: boolean } | null

	/* ---- 翻页 ---- */
	pageSize: PageSize
	pageIndex: number
	/** tokens[i] 是取第 i 页要带的 continuation-token，tokens[0] 恒为空串。
	    OSS 只能顺着游标往前走，跳不到任意页，所以走过的都得记着才能回退。 */
	tokens: string[]
	hasNext: boolean
	selectedIds: Set<string>
	focusedId: string | null
	sortBy: SortBy
	sortOrder: SortOrder
	/* viewMode 只住在 usePrefsStore —— 它要持久化，两边各存一份必然对不上 */
	searchQuery: string
	history: Path[]
	historyIndex: number

	navigate: (path: Path) => void
	goBack: () => void
	goForward: () => void
	goUp: () => void
	goToHistory: (index: number) => void
	refresh: () => Promise<void>
	nextPage: () => void
	prevPage: () => void
	setPageSize: (size: PageSize) => void
	select: (id: string, mode?: "replace" | "toggle" | "range") => void
	clearSelection: () => void
	setSearchQuery: (q: string) => void
	setSort: (by: SortBy) => void
	canGoBack: () => boolean
	canGoForward: () => boolean
	canGoUp: () => boolean
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
	currentPath: "",
	breadcrumbs: [],
	items: [],
	loading: false,
	error: null,
	pageSize: 500,
	pageIndex: 0,
	tokens: [""],
	hasNext: false,
	selectedIds: new Set(),
	focusedId: null,
	sortBy: "name",
	sortOrder: "asc",
	searchQuery: "",
	history: [],
	historyIndex: -1,

	navigate: (path) => {
		const clean = path.replace(/^\/+|\/+$/g, "")
		enterPath(get().currentPath, clean)
		/* 前进分支上再导航，要丢掉后面的历史，和浏览器一致 */
		const { history, historyIndex } = get()
		const trimmed = history.slice(0, historyIndex + 1)
		const next =
			trimmed[trimmed.length - 1] === clean ? trimmed : [...trimmed, clean]
		set({
			currentPath: clean,
			breadcrumbs: clean.split("/").filter(Boolean),
			history: next,
			historyIndex: next.length - 1,
			searchQuery: "",
			selectedIds: new Set(),
			focusedId: null,
			...RESET_PAGING,
		})
		void get().refresh()
	},

	goToHistory: (index) => {
		const { history } = get()
		if (index < 0 || index >= history.length) return
		const path = history[index]
		enterPath(get().currentPath, path)
		set({
			historyIndex: index,
			currentPath: path,
			breadcrumbs: path.split("/").filter(Boolean),
			searchQuery: "",
			selectedIds: new Set(),
			focusedId: null,
			...RESET_PAGING,
		})
		void get().refresh()
	},

	goBack: () => get().goToHistory(get().historyIndex - 1),
	goForward: () => get().goToHistory(get().historyIndex + 1),

	/* Bucket 根再往上是 oss://（Bucket 列表），不是死路 */
	goUp: () => {
		const parts = get().currentPath.split("/").filter(Boolean)
		if (!parts.length) return
		parts.pop()
		get().navigate(parts.join("/"))
	},

	canGoBack: () => get().historyIndex > 0,
	canGoForward: () => get().historyIndex < get().history.length - 1,
	canGoUp: () => get().currentPath.split("/").filter(Boolean).length > 0,

	/** 只取当前这一页。以前是一口气把整个目录（可能上百页）串行拉完才渲染。 */
	refresh: async () => {
		const { currentPath, pageIndex, pageSize, tokens } = get()
		const { bucket, prefix } = splitPath(currentPath)
		if (!bucket) {
			set({ items: [], loading: false, error: null, hasNext: false })
			return
		}

		const token = ++requestToken
		const stale = () => token !== requestToken

		const session = useSessionStore.getState()
		set({ loading: true, error: null })

		const dir = prefix ? `${prefix}/` : ""
		const args = ["--bucket", bucket, "--delimiter", "/", "--max-keys", String(pageSize)]
		if (dir) args.push("--prefix", dir)
		if (tokens[pageIndex]) args.push("--continuation-token", tokens[pageIndex])

		let json: any
		try {
			json = await ossApi(session.auth(), "list-objects-v2", args)
		} catch (err) {
			if (stale()) return
			session.appendLog(`[list] ${err}`)
			set({
				loading: false,
				items: [],
				hasNext: false,
				error: { message: friendlyError(err), permission: isPermissionError(err) },
			})
			return
		}
		if (stale()) return

		const items = pickObjects(json, dir)
		const cursor = nextToken(json)

		/* 有返回却一条都没认出来 = JSON 结构和预期不符，别静默显示"空目录" */
		if (!items.length && (json?.Contents || json?.CommonPrefixes)) {
			session.appendLog(`[list] 没能认出对象，原始 JSON:\n${JSON.stringify(json, null, 2)}`)
		}

		/* 记下走到下一页要用的 token，回退时才找得回来 */
		const nextTokens = [...tokens]
		if (cursor) nextTokens[pageIndex + 1] = cursor

		set({
			items,
			tokens: nextTokens,
			hasNext: Boolean(cursor),
			loading: false,
			error: null,
		})
	},

	nextPage: () => {
		const { hasNext, pageIndex, tokens } = get()
		if (!hasNext || !tokens[pageIndex + 1]) return
		set({ pageIndex: pageIndex + 1, selectedIds: new Set(), focusedId: null })
		void get().refresh()
	},

	prevPage: () => {
		const { pageIndex } = get()
		if (pageIndex <= 0) return
		set({ pageIndex: pageIndex - 1, selectedIds: new Set(), focusedId: null })
		void get().refresh()
	},

	/* 换每页条数会让所有游标失效，只能从头来 */
	setPageSize: (pageSize) => {
		set({ pageSize, pageIndex: 0, tokens: [""], selectedIds: new Set(), focusedId: null })
		void get().refresh()
	},

	select: (id, mode = "replace") => {
		const { selectedIds, items, focusedId } = get()
		if (mode === "toggle") {
			const next = new Set(selectedIds)
			next.has(id) ? next.delete(id) : next.add(id)
			set({ selectedIds: next, focusedId: id })
			return
		}
		if (mode === "range" && focusedId) {
			const ids = items.map((o) => o.key)
			const a = ids.indexOf(focusedId)
			const b = ids.indexOf(id)
			if (a >= 0 && b >= 0) {
				const [from, to] = a < b ? [a, b] : [b, a]
				set({ selectedIds: new Set(ids.slice(from, to + 1)) })
				return
			}
		}
		set({ selectedIds: new Set([id]), focusedId: id })
	},

	clearSelection: () => set({ selectedIds: new Set(), focusedId: null }),

	setSearchQuery: (q) => set({ searchQuery: q }),

	/* 点同一列反向，换列则回到升序 */
	setSort: (by) =>
		set((s) => ({
			sortBy: by,
			sortOrder: s.sortBy === by && s.sortOrder === "asc" ? "desc" : "asc",
		})),
}))
