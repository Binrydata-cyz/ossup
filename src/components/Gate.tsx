/* 连接门：AK / SK / Endpoint 验证通过前，整个界面都进不去。
   「连接」= 真跑一次 list-buckets，既验证凭证又顺手拿回列表。 */

import { message } from "@tauri-apps/plugin-dialog"
import { useState } from "react"

import logo from "../../src-tauri/icons/icons8-128.png"
import { REGIONS } from "../lib/regions.ts"
import { normalizeEndpoint, useSessionStore } from "../store/session.ts"

const KNOWN = new Set(REGIONS.map(([id]) => `oss-${id}.aliyuncs.com`))

export function Gate({ onConnected }: { onConnected: () => void }) {
	const { config, setConfig, connect, connecting, appendLog } = useSessionStore()
	const [error, setError] = useState("")
	const [showSecret, setShowSecret] = useState(false)

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
			<form className="gate-card" onSubmit={submit} autoComplete="off">
				<div className="gate-head">
					<img src={logo} alt="" />
					<h2>连接到 OSS</h2>
					<p>填入 AccessKey 和地域，验证通过后才会列出 Bucket。</p>
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
						<button type="button" onClick={() => setShowSecret((v) => !v)}>
							{showSecret ? "隐藏" : "显示"}
						</button>
					</div>
				</div>

				<div className="field">
					<label htmlFor="endpoint">Endpoint</label>
					<select
						id="endpoint"
						value={config.endpoint}
						onChange={(e) => setConfig({ endpoint: e.target.value })}
					>
						<option value="">请选择地域…</option>
						{/* 存过的 endpoint 若不在内置列表里（自定义域名 / 传输加速），
						    补一个选项，免得打开设置就被静默清空 */}
						{config.endpoint && !KNOWN.has(config.endpoint) && (
							<option value={config.endpoint}>{config.endpoint}</option>
						)}
						{REGIONS.map(([id, name]) => (
							<option key={id} value={`oss-${id}.aliyuncs.com`}>
								{name} · oss-{id}
							</option>
						))}
					</select>
					<p className="hint">
						只列外网 Endpoint —— 内网 Endpoint 只有同地域 ECS 上能连。选哪个都能登录，
						之后进哪个 Bucket 会自动切到它所在的地域。
					</p>
				</div>

				<label className="check">
					<input
						type="checkbox"
						checked={config.remember}
						onChange={(e) => setConfig({ remember: e.target.checked })}
					/>
					<span>记住凭证（保存在本机用户配置目录）</span>
				</label>

				{error && <p className="gate-error">{error}</p>}

				<button type="submit" className="btn primary wide" disabled={connecting}>
					{connecting ? "连接中…" : "连接"}
				</button>
			</form>
		</div>
	)
}
