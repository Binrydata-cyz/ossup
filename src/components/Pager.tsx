/* 翻页条。OSS 的 ListObjectsV2 是游标翻页，跳不到任意页，
   所以只有上一页 / 下一页，没有页码直达。 */

import { PAGE_SIZES, useExplorerStore, type PageSize } from "../store/explorer.ts"
import { Icon } from "./Icon.tsx"

export function Pager() {
	const {
		currentPath,
		items,
		loading,
		pageIndex,
		pageSize,
		hasNext,
		nextPage,
		prevPage,
		setPageSize,
	} = useExplorerStore()

	/* oss:// 根显示的是 Bucket 列表，不走对象翻页 */
	if (!currentPath) return null

	const from = pageIndex * pageSize + 1
	const to = pageIndex * pageSize + items.length

	return (
		<div className="pager">
			<button
				type="button"
				className="btn"
				disabled={pageIndex === 0 || loading}
				onClick={prevPage}
			>
				<Icon name="back" />
				上一页
			</button>

			<span className="pager-info">
				第 {pageIndex + 1} 页
				{items.length > 0 && (
					<span className="muted">
						{" · "}
						{from.toLocaleString()}–{to.toLocaleString()} 项
					</span>
				)}
			</span>

			<button type="button" className="btn" disabled={!hasNext || loading} onClick={nextPage}>
				下一页
				<Icon name="forward" />
			</button>

			<span className="pager-spacer" />

			{/* OSS 只按对象名字典序返回，服务端没有按大小/日期排序这回事 */}
			{(hasNext || pageIndex > 0) && (
				<span className="pager-note" title="OSS 只支持按对象名顺序返回，跨页排序需要先把整个目录拉下来">
					排序 / 搜索仅作用于当前页
				</span>
			)}

			<label className="pager-size">
				每页
				<select
					value={pageSize}
					disabled={loading}
					onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
				>
					{PAGE_SIZES.map((n) => (
						<option key={n} value={n}>
							{n} 条
						</option>
					))}
				</select>
			</label>
		</div>
	)
}
