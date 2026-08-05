/* kindOf() 的种类 -> 具体图标。

   紧凑视图（详细信息 / 列表）用 icons/ 里的 32x32 PNG；大图标 / 平铺视图把图标
   放到 ~64px，32px 源图会糊，所以那两个视图走内联 SVG。icons/ 里没有的种类
   （图片 / 表格 / 压缩包 / 文档 / 未知）一律用 SVG。

   注意：这些 PNG 被 Vite 内联成 data: URI，必须配合 tauri.conf.json 里的
   `img-src 'self' data:` —— 少了那条 CSP 会把每一个 <img> 都拦掉。 */

import bucketPng from "../../src-tauri/icons/bucket2.png"
import codePng from "../../src-tauri/icons/code2.png"
import folderPng from "../../src-tauri/icons/folder2.png"
import pdfPng from "../../src-tauri/icons/pdf2.png"
/* 这张是 48px，比其他那套 32px 更清楚，大图标视图也能直接用 */
import videoPng from "../../src-tauri/icons/icons8-视频文件-48.png"

import type { Kind } from "./objects.ts"

const svg = (body: string, stroke: string) =>
	"data:image/svg+xml;utf8," +
	encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`,
	)

const PAGE = `<path d="M8 3h11l6 6v20H8z"/><path d="M19 3v6h6"/>`

/* 矢量版，任意尺寸都清楚 */
const SVG: Record<Kind, string> = {
	bucket: svg(
		`<ellipse cx="16" cy="8" rx="11" ry="4"/><path d="M5 8v16c0 2.2 4.9 4 11 4s11-1.8 11-4V8"/>`,
		"#4a7fc1",
	),
	folder: svg(
		`<path d="M3 8a2 2 0 0 1 2-2h7l3 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>`,
		"#e8a33d",
	),
	image: svg(`${PAGE}<circle cx="13" cy="16" r="2"/><path d="m10 25 5-5 4 4 3-3 3 3"/>`, "#3f9e6d"),
	doc: svg(`${PAGE}<path d="M12 17h9M12 21h9M12 25h6"/>`, "#4a7fc1"),
	sheet: svg(`${PAGE}<path d="M11 16h11M11 21h11M11 26h11M16 16v10"/>`, "#2f9e63"),
	archive: svg(
		`<path d="M4 7h24v5H4z"/><path d="M6 12v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V12"/><path d="M14 7v6M18 7v6M14 18h4"/>`,
		"#b98a2e",
	),
	code: svg(`${PAGE}<path d="m14 17-3 4 3 4M20 17l3 4-3 4"/>`, "#7a6bd0"),
	pdf: svg(`${PAGE}<path d="M12 19h4M12 23h8M12 27h6"/>`, "#d05a4e"),
	video: svg(`<rect x="3" y="7" width="18" height="18" rx="2"/><path d="m21 14 8-4v12l-8-4z"/>`, "#4a7fc1"),
	file: svg(PAGE, "#9a99a4"),
}

/* 只有这几种有用户指定的 PNG */
const PNG: Partial<Record<Kind, string>> = {
	bucket: bucketPng,
	folder: folderPng,
	code: codePng,
	pdf: pdfPng,
	video: videoPng,
}

/** `large` 为 true 时（大图标 / 平铺视图）一律走 SVG，避免 32px PNG 放大发糊。 */
export function iconFor(kind: Kind, large = false): string {
	if (large) return SVG[kind] ?? SVG.file
	return PNG[kind] ?? SVG[kind] ?? SVG.file
}
