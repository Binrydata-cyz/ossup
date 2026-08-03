import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWebview } from "@tauri-apps/api/webview"
import { open } from "@tauri-apps/plugin-dialog"

const $ = (id) => document.getElementById(id)

const ui = {
	engine: $("engineStatus"),
	engineText: $("engineText"),
	ak: $("ak"),
	sk: $("sk"),
	endpoint: $("endpoint"),
	remember: $("remember"),
	bucket: $("bucket"),
	prefix: $("prefix"),
	targetPreview: $("targetPreview"),
	dropzone: $("dropzone"),
	picked: $("picked"),
	pickedPath: $("pickedPath"),
	jobs: $("jobs"),
	parallel: $("parallel"),
	partSize: $("partSize"),
	ossutilPath: $("ossutilPath"),
	cliCreds: $("cliCreds"),
	phase: $("phase"),
	pct: $("pct"),
	barFill: $("barFill"),
	statFiles: $("statFiles"),
	statSpeed: $("statSpeed"),
	statElapsed: $("statElapsed"),
	btnStart: $("btnStart"),
	btnCancel: $("btnCancel"),
	btnLog: $("btnLog"),
	logpanel: $("logpanel"),
	log: $("log"),
	toast: $("toast"),
}

const state = {
	running: false,
	localPath: "",
	startedAt: 0,
	timer: null,
	toastTimer: null,
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function toast(message, kind = "") {
	ui.toast.textContent = message
	ui.toast.className = `toast ${kind}`.trim()
	ui.toast.hidden = false
	clearTimeout(state.toastTimer)
	state.toastTimer = setTimeout(() => {
		ui.toast.hidden = true
	}, 4000)
}

function appendLog(line) {
	const atBottom =
		ui.log.scrollTop + ui.log.clientHeight >= ui.log.scrollHeight - 24
	ui.log.textContent += line + "\n"
	if (ui.log.textContent.length > 400_000) {
		ui.log.textContent = ui.log.textContent.slice(-300_000)
	}
	if (atBottom) ui.log.scrollTop = ui.log.scrollHeight
}

function setPhase(text, kind = "") {
	ui.phase.textContent = text
	ui.phase.className = `phase ${kind}`.trim()
	ui.barFill.className = `bar-fill ${kind === "running" ? "" : kind}`.trim()
}

function setPercent(value) {
	if (value === null || value === undefined || Number.isNaN(value)) return
	const clamped = Math.max(0, Math.min(100, value))
	ui.barFill.style.width = `${clamped}%`
	ui.pct.textContent = `${clamped.toFixed(clamped % 1 === 0 ? 0 : 1)}%`
}

function startTimer() {
	state.startedAt = Date.now()
	clearInterval(state.timer)
	state.timer = setInterval(() => {
		const s = Math.floor((Date.now() - state.startedAt) / 1000)
		const mm = String(Math.floor(s / 60)).padStart(2, "0")
		const ss = String(s % 60).padStart(2, "0")
		ui.statElapsed.textContent =
			s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${mm}:${ss}`
	}, 1000)
}

function stopTimer() {
	clearInterval(state.timer)
	state.timer = null
}

function setRunning(running) {
	state.running = running
	ui.btnStart.disabled = running
	ui.btnCancel.disabled = !running
	ui.btnStart.textContent = running ? "上传中…" : "开始上传"
}

function cleanPrefix(value) {
	return value.trim().replace(/^\/+/, "").replace(/\/+$/, "")
}

function updateTargetPreview() {
	const bucket = ui.bucket.value.trim()
	const prefix = cleanPrefix(ui.prefix.value)
	if (!bucket) {
		ui.targetPreview.innerHTML = "oss://<em>bucket</em>/<em>路径</em>/"
		ui.targetPreview.classList.remove("ready")
		return
	}
	ui.targetPreview.textContent = `oss://${bucket}/${prefix ? prefix + "/" : ""}`
	ui.targetPreview.classList.add("ready")
}

function setLocalPath(path) {
	state.localPath = path || ""
	if (state.localPath) {
		ui.pickedPath.textContent = state.localPath
		ui.picked.hidden = false
		ui.dropzone.hidden = true
	} else {
		ui.picked.hidden = true
		ui.dropzone.hidden = false
	}
}

/* ------------------------------------------------------------------ */
/* config                                                              */
/* ------------------------------------------------------------------ */

async function loadConfig() {
	try {
		const cfg = await invoke("load_config")
		ui.ak.value = cfg.accessKeyId ?? ""
		ui.sk.value = cfg.accessKeySecret ?? ""
		ui.endpoint.value = cfg.endpoint || "oss-cn-hangzhou.aliyuncs.com"
		ui.bucket.value = cfg.bucket ?? ""
		ui.prefix.value = cfg.prefix ?? ""
		ui.remember.checked = !!cfg.remember
		ui.jobs.value = cfg.jobs ?? 5
		ui.parallel.value = cfg.parallel ?? 8
		ui.partSize.value = cfg.partSizeMb ?? 16
		ui.ossutilPath.value = cfg.ossutilPath ?? ""
		ui.cliCreds.checked = !!cfg.cliCreds
		if (cfg.buckets?.length) {
			$("buckets").innerHTML = cfg.buckets
				.map((b) => `<option value="${b}"></option>`)
				.join("")
		}
	} catch (err) {
		appendLog(`[config] 读取配置失败: ${err}`)
	}
	updateTargetPreview()
}

async function saveConfig() {
	const remember = ui.remember.checked
	try {
		await invoke("save_config", {
			cfg: {
				accessKeyId: remember ? ui.ak.value.trim() : "",
				accessKeySecret: remember ? ui.sk.value : "",
				endpoint: ui.endpoint.value.trim(),
				bucket: ui.bucket.value.trim(),
				prefix: cleanPrefix(ui.prefix.value),
				remember,
				jobs: Number(ui.jobs.value) || 5,
				parallel: Number(ui.parallel.value) || 8,
				partSizeMb: Number(ui.partSize.value) || 16,
				ossutilPath: ui.ossutilPath.value.trim(),
				cliCreds: ui.cliCreds.checked,
			},
		})
	} catch (err) {
		appendLog(`[config] 保存配置失败: ${err}`)
	}
}

async function checkEngine() {
	ui.engine.dataset.state = "checking"
	ui.engineText.textContent = "正在检测 ossutil…"
	try {
		const version = await invoke("check_ossutil", {
			ossutilPath: ui.ossutilPath.value.trim(),
		})
		ui.engine.dataset.state = "ok"
		ui.engineText.textContent = version
	} catch (err) {
		ui.engine.dataset.state = "error"
		ui.engineText.textContent = "未找到 ossutil"
		appendLog(`[engine] ${err}`)
	}
}

/* ------------------------------------------------------------------ */
/* upload                                                              */
/* ------------------------------------------------------------------ */

function validate() {
	if (!ui.ak.value.trim()) return "请填写 AccessKey ID"
	if (!ui.sk.value) return "请填写 AccessKey Secret"
	if (!ui.endpoint.value.trim()) return "请填写 Endpoint"
	if (!ui.bucket.value.trim()) return "请填写 Bucket"
	if (!state.localPath) return "请先选择要上传的文件夹"
	return null
}

async function startUpload() {
	const problem = validate()
	if (problem) {
		toast(problem, "error")
		return
	}

	await saveConfig()

	ui.log.textContent = ""
	setPercent(0)
	ui.statFiles.textContent = "—"
	ui.statSpeed.textContent = "—"
	ui.statElapsed.textContent = "00:00"
	setPhase("正在上传…", "running")
	setRunning(true)
	startTimer()

	try {
		await invoke("start_upload", {
			req: {
				localPath: state.localPath,
				bucket: ui.bucket.value.trim(),
				prefix: cleanPrefix(ui.prefix.value),
				accessKeyId: ui.ak.value.trim(),
				accessKeySecret: ui.sk.value,
				endpoint: ui.endpoint.value.trim(),
				jobs: Number(ui.jobs.value) || 5,
				parallel: Number(ui.parallel.value) || 8,
				partSizeMb: Number(ui.partSize.value) || 16,
				ossutilPath: ui.ossutilPath.value.trim(),
				cliCreds: ui.cliCreds.checked,
			},
		})
	} catch (err) {
		setRunning(false)
		stopTimer()
		setPhase("启动失败", "error")
		appendLog(`[error] ${err}`)
		toast(String(err), "error")
	}
}

async function cancelUpload() {
	try {
		await invoke("cancel_upload")
		appendLog("[user] 已请求停止（断点已保留，下次会接着传）")
	} catch (err) {
		toast(String(err), "error")
	}
}

function onUploadEvent(payload) {
	if (payload.line) appendLog(payload.line)
	if (payload.percent !== null && payload.percent !== undefined) {
		setPercent(payload.percent)
	}
	if (payload.speed) ui.statSpeed.textContent = payload.speed
	if (payload.okNum !== null && payload.okNum !== undefined) {
		const total = payload.totalNum ?? "?"
		ui.statFiles.textContent = `${payload.okNum} / ${total}`
	}

	if (payload.kind === "finished") {
		setRunning(false)
		stopTimer()
		if (payload.code === 0) {
			setPercent(100)
			setPhase("上传完成", "done")
			toast("上传完成，正在校验…", "success")
			runVerify()
		} else {
			setPhase(`上传中断（退出码 ${payload.code}）`, "error")
			toast("上传未完成，再点一次开始上传即可续传", "error")
		}
	}

	if (payload.kind === "error") {
		setRunning(false)
		stopTimer()
		setPhase("出错了", "error")
	}
}

async function runVerify() {
	try {
		const result = await invoke("verify_upload", {
			req: {
				localPath: state.localPath,
				bucket: ui.bucket.value.trim(),
				prefix: cleanPrefix(ui.prefix.value),
				accessKeyId: ui.ak.value.trim(),
				accessKeySecret: ui.sk.value,
				endpoint: ui.endpoint.value.trim(),
				ossutilPath: ui.ossutilPath.value.trim(),
				cliCreds: ui.cliCreds.checked,
			},
		})
		ui.statFiles.textContent = `${result.remoteCount} / ${result.localCount}`
		if (result.remoteCount >= result.localCount) {
			setPhase(
				`✓ 校验通过 · ${result.remoteCount} 个对象 · ${result.localSizeHuman}`,
				"done",
			)
			toast(`校验通过：远端 ${result.remoteCount} 个对象`, "success")
		} else {
			setPhase(
				`⚠ 数量不符 · 本地 ${result.localCount} · 远端 ${result.remoteCount}`,
				"error",
			)
			toast("文件数不一致，建议再跑一次上传", "error")
		}
		appendLog(
			`[verify] 本地 ${result.localCount} 个文件 / ${result.localSizeHuman}，远端 ${result.remoteCount} 个对象`,
		)
	} catch (err) {
		appendLog(`[verify] 校验失败: ${err}`)
	}
}

/* ------------------------------------------------------------------ */
/* wiring                                                              */
/* ------------------------------------------------------------------ */

function wire() {
	$("toggleCred").addEventListener("click", (event) => {
		const body = $("credBody")
		const collapsed = body.hidden
		body.hidden = !collapsed
		event.target.textContent = collapsed ? "收起" : "展开"
		event.target.setAttribute("aria-expanded", String(collapsed))
	})

	$("toggleSk").addEventListener("click", () => {
		const shown = ui.sk.type === "text"
		ui.sk.type = shown ? "password" : "text"
		$("toggleSk").textContent = shown ? "显示" : "隐藏"
	})

	ui.bucket.addEventListener("input", updateTargetPreview)
	ui.prefix.addEventListener("input", updateTargetPreview)
	ui.ossutilPath.addEventListener("change", checkEngine)

	const pick = async () => {
		const selected = await open({ directory: true, multiple: false })
		if (typeof selected === "string") setLocalPath(selected)
	}
	ui.dropzone.addEventListener("click", pick)
	ui.dropzone.addEventListener("keydown", (event) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault()
			pick()
		}
	})
	$("clearPick").addEventListener("click", () => setLocalPath(""))

	ui.btnStart.addEventListener("click", startUpload)
	ui.btnCancel.addEventListener("click", cancelUpload)

	ui.btnLog.addEventListener("click", () => {
		ui.logpanel.hidden = !ui.logpanel.hidden
		if (!ui.logpanel.hidden) ui.log.scrollTop = ui.log.scrollHeight
	})
	$("closeLog").addEventListener("click", () => {
		ui.logpanel.hidden = true
	})
	$("copyLog").addEventListener("click", async () => {
		await navigator.clipboard.writeText(ui.log.textContent)
		toast("日志已复制", "success")
	})

	window.addEventListener("beforeunload", () => saveConfig())
}

async function wireNative() {
	await listen("upload://event", (event) => onUploadEvent(event.payload))

	const webview = getCurrentWebview()
	await webview.onDragDropEvent((event) => {
		if (event.payload.type === "over") {
			ui.dropzone.classList.add("dragover")
		} else if (event.payload.type === "drop") {
			ui.dropzone.classList.remove("dragover")
			const [first] = event.payload.paths ?? []
			if (first) setLocalPath(first)
		} else {
			ui.dropzone.classList.remove("dragover")
		}
	})
}

wire()
wireNative()
loadConfig().then(checkEngine)
