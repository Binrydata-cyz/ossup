/* 凭证 / endpoint / 连接态 / Bucket 列表。连接门和所有 oss_api 调用都读它。 */

import { invoke } from "@tauri-apps/api/core"
import { create } from "zustand"

import { endpointOf, nextMarker, pickBuckets, type Bucket } from "../lib/buckets.ts"
import { ossApi, type Auth } from "../lib/ossApi.ts"

export type Config = {
	accessKeyId: string
	accessKeySecret: string
	endpoint: string
	bucket: string
	prefix: string
	remember: boolean
	jobs: number
	parallel: number
	partSizeMb: number
	ossutilPath: string
	cliCreds: boolean
	buckets: string[]
}

const DEFAULTS: Config = {
	accessKeyId: "",
	accessKeySecret: "",
	endpoint: "",
	bucket: "",
	prefix: "",
	remember: false,
	jobs: 5,
	parallel: 8,
	partSizeMb: 16,
	ossutilPath: "",
	cliCreds: false,
	buckets: [],
}

/* 控制台复制来的常带 https:// 和结尾斜杠，ossutil 不认，统一擦掉 */
export const normalizeEndpoint = (v: string) =>
	v.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "")

type SessionState = {
	config: Config
	connected: boolean
	connecting: boolean
	buckets: Bucket[]
	engine: { state: "checking" | "ok" | "error"; text: string }
	logs: string[]

	setConfig: (patch: Partial<Config>) => void
	appendLog: (line: string) => void
	auth: () => Auth
	loadConfig: () => Promise<void>
	saveConfig: () => Promise<void>
	checkEngine: () => Promise<void>
	connect: () => Promise<void>
	disconnect: () => void
	loadBuckets: () => Promise<Bucket[]>
	/** 跨地域的 Bucket 必须换 endpoint，否则连不上 */
	useBucketEndpoint: (bucket: Bucket) => void
}

export const useSessionStore = create<SessionState>((set, get) => ({
	config: DEFAULTS,
	connected: false,
	connecting: false,
	buckets: [],
	engine: { state: "checking", text: "正在检测 ossutil…" },
	logs: [],

	setConfig: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),

	appendLog: (line) =>
		set((s) => ({ logs: [...s.logs, line].slice(-2000) })),

	auth: () => {
		const c = get().config
		return {
			accessKeyId: c.accessKeyId.trim(),
			accessKeySecret: c.accessKeySecret,
			endpoint: normalizeEndpoint(c.endpoint),
			ossutilPath: c.ossutilPath.trim(),
		}
	},

	loadConfig: async () => {
		try {
			const cfg = await invoke<Config>("load_config")
			set({ config: { ...DEFAULTS, ...cfg, endpoint: normalizeEndpoint(cfg.endpoint ?? "") } })
		} catch (err) {
			get().appendLog(`[config] 读取配置失败: ${err}`)
		}
	},

	saveConfig: async () => {
		const c = get().config
		try {
			await invoke("save_config", {
				cfg: {
					...c,
					accessKeyId: c.remember ? c.accessKeyId.trim() : "",
					accessKeySecret: c.remember ? c.accessKeySecret : "",
					endpoint: normalizeEndpoint(c.endpoint),
				},
			})
		} catch (err) {
			get().appendLog(`[config] 保存配置失败: ${err}`)
		}
	},

	checkEngine: async () => {
		set({ engine: { state: "checking", text: "正在检测 ossutil…" } })
		try {
			const version = await invoke<string>("check_ossutil", {
				ossutilPath: get().config.ossutilPath.trim(),
			})
			set({ engine: { state: "ok", text: version } })
		} catch (err) {
			set({ engine: { state: "error", text: "未找到 ossutil" } })
			get().appendLog(`[engine] ${err}`)
		}
	},

	loadBuckets: async () => {
		/* 一次最多 1000 个，Bucket 多的账号必须跟着 NextMarker 翻页。
		   页数封顶纯粹是防服务端一直说 truncated 死循环。 */
		const all: Bucket[] = []
		let marker = ""
		let last: any = null
		for (let page = 0; page < 50; page++) {
			const args = ["--max-keys", "1000"]
			if (marker) args.push("--marker", marker)
			last = await ossApi(get().auth(), "list-buckets", args)
			all.push(...pickBuckets(last))
			marker = nextMarker(last)
			if (!marker) break
		}
		if (!all.length && last) {
			get().appendLog(
				`[buckets] 没能从返回里认出 Bucket，原始 JSON:\n${JSON.stringify(last, null, 2)}`,
			)
		}
		set({ buckets: all })
		return all
	},

	/* 连接 = 真跑一次 list-buckets。既验证了凭证，又顺手把列表拿回来了。 */
	connect: async () => {
		set({ connecting: true })
		try {
			await get().loadBuckets()
			set({ connected: true })
			await get().saveConfig()
		} finally {
			set({ connecting: false })
		}
	},

	disconnect: () => {
		const { remember } = get().config
		set((s) => ({
			connected: false,
			buckets: [],
			/* 没勾"记住凭证"就别把密钥留在内存和输入框里 */
			config: remember
				? s.config
				: { ...s.config, accessKeyId: "", accessKeySecret: "" },
		}))
	},

	useBucketEndpoint: (bucket) => {
		const endpoint = endpointOf(bucket)
		if (endpoint && endpoint !== normalizeEndpoint(get().config.endpoint)) {
			get().setConfig({ endpoint })
		}
	},
}))
