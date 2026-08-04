import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWebview } from "@tauri-apps/api/webview"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { message, open } from "@tauri-apps/plugin-dialog"

import { endpointOf, nextMarker, pickBuckets } from "./buckets.js"
import { iconFor } from "./fileicon.js"
import {
	formatSize,
	formatTime,
	kindOf,
	nextToken,
	pickObjects,
} from "./objects.js"

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
	gate: $("gate"),
	gateForm: $("gateForm"),
	gateError: $("gateError"),
	btnLogin: $("btnLogin"),
	btnLogout: $("btnLogout"),
	identity: $("identity"),
	identityAk: $("identityAk"),
	identityEndpoint: $("identityEndpoint"),
	bucketList: $("bucketList"),
	btnRefreshBuckets: $("btnRefreshBuckets"),
	addr: $("addr"),
	btnUp: $("btnUp"),
	btnRefreshList: $("btnRefreshList"),
	fileList: $("fileList"),
}

const state = {
	running: false,
	localPath: "",
	startedAt: 0,
	timer: null,
	toastTimer: null,
	connected: false,
	bucket: "",
	prefix: "",
}

/* ------------------------------------------------------------------ */
/* endpoints                                                           */
/* ------------------------------------------------------------------ */

/* 阿里云 OSS 公共云地域。endpoint 一律是 oss-<地域id>.aliyuncs.com，所以只存 id + 中文名。
   只列外网 endpoint：内网 endpoint 只有同地域 ECS 上能连，桌面机上选到就是白等超时。
   ponytail: 不含金融云 / 政务云 / 无地域 Region，它们 endpoint 规则不同，手填即可。 */
const REGIONS = [
	["cn-hangzhou", "华东1 杭州"],
	["cn-shanghai", "华东2 上海"],
	["cn-nanjing", "华东5 南京 · 本地地域"],
	["cn-fuzhou", "华东6 福州 · 本地地域"],
	["cn-wuhan-lr", "华中1 武汉 · 本地地域"],
	["cn-qingdao", "华北1 青岛"],
	["cn-beijing", "华北2 北京"],
	["cn-zhangjiakou", "华北3 张家口"],
	["cn-huhehaote", "华北5 呼和浩特"],
	["cn-wulanchabu", "华北6 乌兰察布"],
	["cn-shenzhen", "华南1 深圳"],
	["cn-heyuan", "华南2 河源"],
	["cn-guangzhou", "华南3 广州"],
	["cn-chengdu", "西南1 成都"],
	["cn-hongkong", "中国香港"],
	["ap-southeast-1", "新加坡"],
	["ap-southeast-2", "澳大利亚 悉尼"],
	["ap-southeast-3", "马来西亚 吉隆坡"],
	["ap-southeast-5", "印尼 雅加达"],
	["ap-southeast-6", "菲律宾 马尼拉"],
	["ap-southeast-7", "泰国 曼谷"],
	["ap-northeast-1", "日本 东京"],
	["ap-northeast-2", "韩国 首尔"],
	["us-west-1", "美国 硅谷"],
	["us-east-1", "美国 弗吉尼亚"],
	["eu-west-1", "英国 伦敦"],
	["eu-central-1", "德国 法兰克福"],
	["me-east-1", "阿联酋 迪拜"],
	["me-central-1", "沙特 利雅得"],
]

function fillEndpoints() {
	$("endpoints").innerHTML = REGIONS.map(
		([id, name]) => `<option value="oss-${id}.aliyuncs.com">${name}</option>`,
	).join("")
}

/* 控制台复制过来常带 https:// 和结尾斜杠，ossutil 不认，统一擦掉 */
function normalizeEndpoint(value) {
	return value.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "")
}

/* 直接粘贴一整条 OSS 路径，拆成 bucket + 目标路径。
   oss://bucket/a/b 和控制台给的 https://bucket.oss-cn-hangzhou.aliyuncs.com/a/b 都认，
   后者顺手把 endpoint 也填上。认不出来就返回 null（当成普通 bucket 名）。 */
function parseOssUri(text) {
	const value = text.trim()
	let m = /^oss:\/\/([^/\s]+)(?:\/(.*))?$/i.exec(value)
	if (m) return { bucket: m[1], prefix: m[2] || "", endpoint: "" }
	m = /^https?:\/\/([^./\s]+)\.(oss-[^/\s]+)(?:\/(.*))?$/i.exec(value)
	if (m) return { bucket: m[1], prefix: m[3] || "", endpoint: m[2] }
	return null
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
		ui.endpoint.value = normalizeEndpoint(cfg.endpoint ?? "")
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
/* 连接 + Bucket                                                        */
/* ------------------------------------------------------------------ */

/* oss_api 只要这四个字段，别把整个 UploadRequest 传过去 */
function auth() {
	return {
		accessKeyId: ui.ak.value.trim(),
		accessKeySecret: ui.sk.value,
		endpoint: normalizeEndpoint(ui.endpoint.value),
		ossutilPath: ui.ossutilPath.value.trim(),
	}
}

const ossApi = (op, args = []) => invoke("oss_api", { auth: auth(), op, args })

/* 名字和地域都是服务端给的，一律走 textContent，不拼 innerHTML */
function renderBuckets(buckets) {
	const datalist = $("buckets")
	datalist.replaceChildren(
		...buckets.map((b) => {
			const option = document.createElement("option")
			option.value = b.name
			return option
		}),
	)

	if (!buckets.length) {
		ui.bucketList.replaceChildren(
			Object.assign(document.createElement("p"), {
				className: "bucket-empty",
				textContent: "这个账号下没有 Bucket",
			}),
		)
		return
	}

	ui.bucketList.replaceChildren(
		...buckets.map((b) => {
			const el = document.createElement("button")
			el.type = "button"
			el.className = "bucket"
			const icon = document.createElement("img")
			icon.src = iconFor("bucket")
			icon.alt = ""
			const text = document.createElement("span")
			text.className = "bucket-text"
			const name = document.createElement("span")
			name.className = "bucket-name"
			name.textContent = b.name
			const meta = document.createElement("span")
			meta.className = "bucket-meta"
			meta.textContent = [b.location, b.storageClass].filter(Boolean).join(" · ")
			text.append(name, meta)
			el.append(icon, text)
			el.addEventListener("click", () => navigate(b.name, "", b))
			return el
		}),
	)
	highlightBucket()
}

function highlightBucket() {
	const current = ui.bucket.value.trim()
	ui.bucketList.querySelectorAll(".bucket").forEach((el) => {
		el.classList.toggle(
			"active",
			el.querySelector(".bucket-name").textContent === current,
		)
	})
}

async function loadBuckets() {
	ui.bucketList.innerHTML = `<p class="bucket-empty">正在读取 Bucket…</p>`
	/* 一次最多 1000 个，Bucket 多的账号必须跟着 NextMarker 翻页，
	   否则只看得到第一页。页数封顶纯粹是防服务端一直说 truncated 死循环。 */
	const buckets = []
	let marker = ""
	let last = null
	for (let page = 0; page < 50; page++) {
		const args = ["--max-keys", "1000"]
		if (marker) args.push("--marker", marker)
		last = await ossApi("list-buckets", args)
		buckets.push(...pickBuckets(last))
		marker = nextMarker(last)
		if (!marker) break
	}

	/* 调用成功却一个都没认出来 = JSON 结构和预期不符，别静默显示"没有 Bucket" */
	if (!buckets.length && last) {
		appendLog(
			`[buckets] 没能从返回里认出 Bucket，原始 JSON:\n${JSON.stringify(last, null, 2)}`,
		)
	}
	renderBuckets(buckets)
	return buckets
}

/* ------------------------------------------------------------------ */
/* 浏览                                                                 */
/* ------------------------------------------------------------------ */

function setFileStatus(text) {
	ui.fileList.replaceChildren(
		Object.assign(document.createElement("p"), {
			className: "file-empty",
			textContent: text,
		}),
	)
}

function renderObjects(items) {
	if (!items.length) {
		setFileStatus("这个目录是空的")
		return
	}
	ui.fileList.replaceChildren(
		...items.map((o) => {
			const row = document.createElement("div")
			row.className = o.folder ? "filerow folder" : "filerow"

			const icon = document.createElement("img")
			icon.src = iconFor(o.folder ? "folder" : kindOf(o.name))
			icon.alt = ""

			const name = document.createElement("span")
			name.className = "file-name"
			name.textContent = o.name

			const size = document.createElement("span")
			size.className = "file-size"
			size.textContent = o.folder ? "" : formatSize(o.size)

			const time = document.createElement("span")
			time.className = "file-time"
			time.textContent = o.folder ? "" : formatTime(o.modified)

			row.append(icon, name, size, time)
			if (o.folder) {
				row.tabIndex = 0
				row.addEventListener("click", () => navigate(state.bucket, o.key))
				row.addEventListener("keydown", (event) => {
					if (event.key === "Enter") navigate(state.bucket, o.key)
				})
			}
			return row
		}),
	)
}

/* 列当前目录这一层：--delimiter / 让 OSS 把下级目录折叠成 CommonPrefixes，
   不然会把整个 bucket 的对象全拉下来。 */
async function listObjects() {
	if (!state.bucket) {
		setFileStatus("先选一个 Bucket")
		return
	}
	setFileStatus("正在读取…")

	const prefix = state.prefix ? `${state.prefix}/` : ""
	const items = []
	let token = ""
	let last = null
	try {
		for (let page = 0; page < 100; page++) {
			const args = [
				"--bucket", state.bucket,
				"--delimiter", "/",
				"--max-keys", "1000",
			]
			if (prefix) args.push("--prefix", prefix)
			if (token) args.push("--continuation-token", token)
			last = await ossApi("list-objects-v2", args)
			items.push(...pickObjects(last, prefix))
			token = nextToken(last)
			if (!token) break
		}
	} catch (err) {
		setFileStatus(String(err))
		appendLog(`[list] ${err}`)
		return
	}

	/* 有返回却一条都没认出来 = JSON 结构和预期不符，别静默显示"空目录" */
	if (!items.length && last && (last.Contents || last.CommonPrefixes)) {
		appendLog(`[list] 没能认出对象，原始 JSON:\n${JSON.stringify(last, null, 2)}`)
	}
	renderObjects(items)
}

/* 导航是唯一改当前位置的地方：写隐藏的 #bucket/#prefix（上传那套读的就是它们）、
   刷新地址栏、重列目录。bucket 带 endpoint 信息时顺便切地域。 */
function navigate(bucket, prefixWithSlash = "", bucketInfo = null) {
	state.bucket = bucket
	state.prefix = cleanPrefix(prefixWithSlash)
	ui.bucket.value = state.bucket
	ui.prefix.value = state.prefix

	if (bucketInfo) {
		const endpoint = endpointOf(bucketInfo)
		if (endpoint && endpoint !== normalizeEndpoint(ui.endpoint.value)) {
			ui.endpoint.value = endpoint
			ui.identityEndpoint.textContent = endpoint
			toast(`已切到 ${bucketInfo.location}`, "success")
		}
	}

	ui.addr.value = state.bucket
		? `oss://${state.bucket}/${state.prefix ? state.prefix + "/" : ""}`
		: ""
	ui.btnUp.disabled = !state.bucket
	highlightBucket()
	updateTargetPreview()
	saveConfig()
	listObjects()
}

/* 上一级：有前缀就退一层，已经在根目录就退回"没选 bucket" */
function goUp() {
	if (state.prefix) {
		const parts = state.prefix.split("/")
		parts.pop()
		navigate(state.bucket, parts.join("/"))
	} else if (state.bucket) {
		navigate("", "")
		setFileStatus("先选一个 Bucket")
	}
}

/* 地址栏支持直接粘 oss:// 或控制台的 https 链接 */
function gotoAddr() {
	const parsed = parseOssUri(ui.addr.value)
	if (!parsed) {
		toast("认不出这条路径，格式是 oss://bucket/路径/", "error")
		return
	}
	if (parsed.endpoint) ui.endpoint.value = normalizeEndpoint(parsed.endpoint)
	navigate(parsed.bucket, parsed.prefix)
}

function setConnected(connected) {
	state.connected = connected
	ui.gate.hidden = connected
	ui.identity.hidden = !connected
	if (connected) {
		const ak = ui.ak.value.trim()
		ui.identityAk.textContent =
			ak.length > 10 ? `${ak.slice(0, 6)}…${ak.slice(-4)}` : ak
		ui.identityEndpoint.textContent = normalizeEndpoint(ui.endpoint.value)
	}
}

/* 形参别叫 message —— 会盖掉 plugin-dialog 那个弹窗函数 */
function gateError(text) {
	ui.gateError.textContent = text
	ui.gateError.hidden = !text
}

/* 连接 = 真跑一次 list-buckets。既验证了凭证，又顺手把列表拿回来了。 */
async function connect() {
	if (!ui.ak.value.trim()) return gateError("请填写 AccessKey ID")
	if (!ui.sk.value) return gateError("请填写 AccessKey Secret")
	if (!normalizeEndpoint(ui.endpoint.value)) return gateError("请选择 Endpoint")

	gateError("")
	ui.btnLogin.disabled = true
	ui.btnLogin.textContent = "连接中…"
	try {
		const buckets = await loadBuckets()
		setConnected(true)
		await saveConfig()
		toast(`已连接 · ${buckets.length} 个 Bucket`, "success")
		/* 上次浏览到哪就回到哪；loadConfig 已经把它放进隐藏字段了 */
		if (ui.bucket.value.trim()) {
			navigate(ui.bucket.value.trim(), cleanPrefix(ui.prefix.value))
		}
	} catch (err) {
		gateError(String(err))
		appendLog(`[connect] ${err}`)
		await message(String(err), { title: "登录失败", kind: "error" })
	} finally {
		ui.btnLogin.disabled = false
		ui.btnLogin.textContent = "连接"
	}
}

function disconnect() {
	setConnected(false)
	ui.bucketList.innerHTML = `<p class="bucket-empty">尚未连接</p>`
	$("buckets").innerHTML = ""
	state.bucket = ""
	state.prefix = ""
	ui.addr.value = ""
	setFileStatus("先选一个 Bucket")
	gateError("")
	/* 没勾"记住凭证"就别把密钥留在输入框里 */
	if (!ui.remember.checked) {
		ui.ak.value = ""
		ui.sk.value = ""
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
	ui.gateForm.addEventListener("submit", (event) => {
		event.preventDefault()
		connect()
	})
	ui.btnLogout.addEventListener("click", disconnect)
	ui.btnRefreshBuckets.addEventListener("click", async () => {
		try {
			await loadBuckets()
		} catch (err) {
			toast(String(err), "error")
			appendLog(`[buckets] ${err}`)
		}
	})

	$("toggleSk").addEventListener("click", () => {
		const shown = ui.sk.type === "text"
		ui.sk.type = shown ? "password" : "text"
		$("toggleSk").textContent = shown ? "显示" : "隐藏"
	})

	ui.endpoint.addEventListener("change", () => {
		ui.endpoint.value = normalizeEndpoint(ui.endpoint.value)
	})

	ui.btnUp.addEventListener("click", goUp)
	ui.btnRefreshList.addEventListener("click", listObjects)
	ui.addr.addEventListener("keydown", (event) => {
		if (event.key === "Enter") gotoAddr()
	})
	ui.addr.addEventListener("change", gotoAddr)
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
	/* 放在最前面：后面任何一个 await 挂了，窗口都还得关得掉 */
	const win = getCurrentWindow()
	$("winMin").addEventListener("click", () => win.minimize())
	$("winMax").addEventListener("click", () => win.toggleMaximize())
	$("winClose").addEventListener("click", () => win.close())

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

fillEndpoints()
wire()
wireNative()

/* 存过凭证就直接连，省掉每次开机点一下"连接" */
loadConfig()
	.then(checkEngine)
	.then(() => {
		if (ui.ak.value.trim() && ui.sk.value && normalizeEndpoint(ui.endpoint.value)) {
			connect()
		}
	})
