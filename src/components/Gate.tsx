/* 连接门：AK / SK / Endpoint 验证通过前，整个界面都进不去。
   「连接」= 真跑一次 list-buckets，既验证凭证又顺手拿回列表。 */

import { appConfigDir } from "@tauri-apps/api/path"
import { message } from "@tauri-apps/plugin-dialog"
import { useEffect, useMemo, useRef, useState } from "react"

/* 直接用应用图标本身，省得品牌图标和任务栏图标是两套 */
import logo from "../../src-tauri/icons/icon.ico"
import { REGIONS } from "../lib/regions.ts"
import { normalizeEndpoint, useSessionStore } from "../store/session.ts"
import { Icon } from "./Icon.tsx"

const KNOWN = new Set(REGIONS.map(([id]) => `oss-${id}.aliyuncs.com`))

/**
 * 「记住凭证」旁边的问号说明。
 *
 * 气泡用 position: fixed 而不是 absolute —— 它的祖先 .gate-form 是
 * overflow-y: auto 的滚动容器，绝对定位的后代一定会被裁掉，这在 CSS 层面
 * 绕不过去。所以按下时实测问号的位置，把气泡钉在视口坐标上，顺带夹住左右
 * 边界免得贴边溢出。
 */
function HintMark({ configPath }: { configPath: string }) {
	const ref = useRef<HTMLSpanElement>(null)
	const [at, setAt] = useState<{ left: number; top: number } | null>(null)

	const show = () => {
		const r = ref.current?.getBoundingClientRect()
		if (!r) return
		const half = 176 /* max-width 22rem 的一半，用来夹边界 */
		setAt({
			left: Math.max(half + 8, Math.min(r.left + r.width / 2, window.innerWidth - half - 8)),
			top: r.top - 8,
		})
	}

	return (
		<span
			ref={ref}
			className="hintmark"
			/* tabIndex 让键盘也能唤出说明，不是只有鼠标 hover */
			tabIndex={0}
			role="note"
			aria-label="凭证存放位置"
			onMouseEnter={show}
			onFocus={show}
			onMouseLeave={() => setAt(null)}
			onBlur={() => setAt(null)}
		>
			?
			{at && (
				<span className="tip" style={{ left: at.left, top: at.top }}>
					存放位置：<code>{configPath || "读取中…"}</code>
				</span>
			)}
		</span>
	)
}

/* Endpoint 下拉：原生 <select> 的弹层在 WebView2 里不受 CSS 控制
   （圆角、悬停色都改不了），所以用自定义弹层，样式完全可控。 */
function EndpointSelect({
	value,
	onChange,
}: {
	value: string
	onChange: (v: string) => void
}) {
	const [open, setOpen] = useState(false)
	const ref = useRef<HTMLDivElement>(null)

	/* 点击弹层外 / Esc 关闭 */
	useEffect(() => {
		if (!open) return
		const onDown = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false)
		}
		window.addEventListener("mousedown", onDown)
		window.addEventListener("keydown", onKey)
		return () => {
			window.removeEventListener("mousedown", onDown)
			window.removeEventListener("keydown", onKey)
		}
	}, [open])

	/* 存过的 endpoint 若不在内置列表里（自定义域名 / 传输加速），
	   补一个选项，免得打开设置就被静默清空 */
	const options = useMemo(() => {
		const list: [string, string][] = REGIONS.map(([id, name]) => [
			`oss-${id}.aliyuncs.com`,
			`${name} · oss-${id}`,
		])
		if (value && !KNOWN.has(value)) list.unshift([value, value])
		return list
	}, [value])

	const current = options.find(([v]) => v === value)

	const pick = (v: string) => {
		onChange(v)
		setOpen(false)
	}

	return (
		<div className="eselect" ref={ref}>
			<button
				type="button"
				className={`eselect-btn ${open ? "open" : ""}`}
				aria-haspopup="listbox"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
			>
				<span className={current ? "" : "placeholder"}>
					{current ? current[1] : "请选择地域…"}
				</span>
				<Icon name="chevron" />
			</button>

			{open && (
				<div className="eselect-pop" role="listbox">
					<button
						type="button"
						role="option"
						aria-selected={!value}
						className={`eselect-opt ${!value ? "sel" : ""}`}
						onClick={() => pick("")}
					>
						请选择地域…
					</button>
					{options.map(([v, label]) => (
						<button
							type="button"
							role="option"
							key={v}
							aria-selected={v === value}
							className={`eselect-opt ${v === value ? "sel" : ""}`}
							onClick={() => pick(v)}
						>
							{label}
						</button>
					))}
				</div>
			)}
		</div>
	)
}

export function Gate({ onConnected }: { onConnected: () => void }) {
	const { config, setConfig, connect, connecting, appendLog } = useSessionStore()
	const [error, setError] = useState("")
	const [showSecret, setShowSecret] = useState(false)
	const [configPath, setConfigPath] = useState("")

	/* 真去问一次系统路径，别按平台硬猜 —— 后端存配置用的就是 app_config_dir */
	useEffect(() => {
		appConfigDir()
			.then((dir) => {
				const sep = dir.includes("\\") ? "\\" : "/"
				setConfigPath(`${dir.replace(/[\/]$/, "")}${sep}config.json`)
			})
			.catch(() => setConfigPath("本机用户配置目录"))
	}, [])

	const submit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!config.accessKeyId.trim()) return setError("请填写 AccessKey ID")
		if (!config.accessKeySecret) return setError("请填写 AccessKey Secret")
		if (!normalizeEndpoint(config.endpoint)) return setError("请选择 Endpoint")

		setError("")
		try {
			await connect()
			onConnected()
		} catch (err) {
			setError(String(err))
			appendLog(`[connect] ${err}`)
			await message(String(err), { title: "登录失败", kind: "error" })
		}
	}

	return (
		<div className="gate">
			<section className="gate-form">
				<form className="gate-card" onSubmit={submit} autoComplete="off">
					<div className="gate-head">
						<div className="gate-brand">
							<img src={logo} alt="" />
							<span>OSSUP</span>
						</div>
					</div>

					<div className="field">
						<label htmlFor="ak">AccessKey ID</label>
						<input
							id="ak"
							type="text"
							spellCheck={false}
							autoComplete="off"
							placeholder="LTAI5t…"
							value={config.accessKeyId}
							onChange={(e) => setConfig({ accessKeyId: e.target.value })}
						/>
					</div>

					<div className="field">
						<label htmlFor="sk">AccessKey Secret</label>
						<div className="affix">
							<input
								id="sk"
								type={showSecret ? "text" : "password"}
								spellCheck={false}
								autoComplete="off"
								placeholder="••••••••••••••••"
								value={config.accessKeySecret}
								onChange={(e) => setConfig({ accessKeySecret: e.target.value })}
							/>
							<button
								type="button"
								className="affix-icon"
								aria-label={showSecret ? "隐藏密钥" : "显示密钥"}
								title={showSecret ? "隐藏" : "显示"}
								aria-pressed={showSecret}
								onClick={() => setShowSecret((v) => !v)}
							>
								<Icon name={showSecret ? "eyeOff" : "eye"} />
							</button>
						</div>
					</div>

					<div className="field">
						<label htmlFor="endpoint">Endpoint</label>
						<EndpointSelect value={config.endpoint} onChange={(v) => setConfig({ endpoint: v })} />
					</div>

					<div className="check-row">
						<label className="check">
							<input
								type="checkbox"
								checked={config.remember}
								onChange={(e) => setConfig({ remember: e.target.checked })}
							/>
							<span>记住凭证</span>
						</label>
						<HintMark configPath={configPath} />
					</div>

					{error && <p className="gate-error">{error}</p>}

					<button type="submit" className="btn primary wide" disabled={connecting}>
						{connecting ? "登录中…" : "登录"}
					</button>
				</form>
			</section>

			{/* 右栏视觉。窗口窄到放不下时整栏隐藏，表单占满 */}
			<aside className="gate-visual" aria-hidden="true">
				<div className="vis-bg" />
				<div className="vis-glow g1" />
				<div className="vis-glow g2" />
				<div className="vis-glow g3" />
				<div className="vis-vignette" />

				{/* 大云轮廓：右侧出画，把文字兜在云肚子里 */}
				<div className="vis-cloud">
					<svg viewBox="0 0 24 24" fill="none">
						<defs>
							<linearGradient id="visCloudLine" x1="0" y1="0" x2=".8" y2="1">
								<stop offset="0" stopColor="#A8D4FF" stopOpacity=".50" />
								<stop offset=".5" stopColor="#5AA9FF" stopOpacity=".24" />
								<stop offset="1" stopColor="#5AA9FF" stopOpacity=".05" />
							</linearGradient>
							<radialGradient id="visCloudFill" cx=".42" cy=".45" r=".62">
								<stop offset="0" stopColor="#5AA9FF" stopOpacity=".10" />
								<stop offset="1" stopColor="#5AA9FF" stopOpacity="0" />
							</radialGradient>
						</defs>
						<path
							d="M6.5 19a8 8 0 1 1 8.5-12h3a6.1 6.1 0 1 1 0 12Z"
							fill="url(#visCloudFill)"
						/>
						<path
							d="M6.5 19a8 8 0 1 1 8.5-12h3a6.1 6.1 0 1 1 0 12Z"
							stroke="url(#visCloudLine)"
							strokeWidth=".075"
							strokeLinejoin="round"
						/>
					</svg>

					{/* 外层再套一层更大的云：同款渐变但更细更淡，做出云的层次 */}
					<svg className="vis-cloud-outer" viewBox="0 0 24 24" fill="none">
						<path
							d="M6.5 19a8 8 0 1 1 8.5-12h3a6.1 6.1 0 1 1 0 12Z"
							stroke="url(#visCloudLine)"
							strokeWidth=".045"
							strokeLinejoin="round"
						/>
					</svg>
				</div>

				<div className="vis-grain" />

				<div className="vis-wrap">
					<div className="vis-word">OSSUP</div>
					<div className="vis-rule" />
					<div className="vis-tag">对象存储 · 稳定传输</div>
				</div>
				<div className="vis-foot">POWERED BY OSSUTIL</div>
			</aside>
		</div>
	)
}
