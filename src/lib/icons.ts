/* kindOf() 的种类 -> 具体图标。用 32x32 那套（bucket2/code2/…），
   列表里按 20px 渲染，HiDPI 下才不糊。Vite 会把它们打包进产物。 */

import bucketIcon from "../src-tauri/icons/bucket2.png"
import codeIcon from "../src-tauri/icons/code2.png"
import folderIcon from "../src-tauri/icons/folder2.png"
import pdfIcon from "../src-tauri/icons/pdf2.png"
import videoIcon from "../src-tauri/icons/video2.png"

/* icons 目录里没有"普通文件"这一张，用一个内联 SVG 兜底 */
const fileIcon =
	"data:image/svg+xml;utf8," +
	encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"
		   stroke="#9a99a4" stroke-width="2" stroke-linejoin="round">
		  <path d="M8 3h11l6 6v20H8z"/><path d="M19 3v6h6"/>
		</svg>`,
	)

const ICONS = {
	bucket: bucketIcon,
	folder: folderIcon,
	code: codeIcon,
	pdf: pdfIcon,
	video: videoIcon,
	file: fileIcon,
}

export const iconFor = (kind) => ICONS[kind] ?? fileIcon
