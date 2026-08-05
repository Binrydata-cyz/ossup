/* 加载中 / 空目录 / 搜索无结果 / 加载失败 / 无权限 —— 规格要求全部实现。 */

import { useRemSize, useSize } from "../lib/hooks.ts"
import { iconFor } from "../lib/icons.ts"
import { Icon } from "./Icon.tsx"

/** 骨架屏：行数按容器高度实测算，不是转圈也不是硬编码。 */
export function Skeleton({ columns }: { columns: number }) {
	const { ref, height } = useSize<HTMLDivElement>()
	const rem = useRemSize()
	const rowPx = 2 * rem /* --row-h */
	const rows = Math.max(3, Math.floor((height || rowPx * 8) / rowPx))

	return (
		<div ref={ref} style={{ height: "100%" }}>
			{Array.from({ length: rows }, (_, i) => (
				<div className="skel-row" key={i}>
					{Array.from({ length: columns }, (_, c) => (
						<div
							className="skel-bar"
							key={c}
							style={{
								/* 每行宽度略有差异，看起来才像内容而不是网格 */
								width: `${(c === 0 ? 55 : 40) + ((i * 7 + c * 13) % 30)}%`,
								animationDelay: `${(i % 6) * 0.08}s`,
							}}
						/>
					))}
				</div>
			))}
		</div>
	)
}

export function EmptyDir({ onNewFolder }: { onNewFolder: () => void }) {
	return (
		<div className="state">
			<img src={iconFor("folder", true)} alt="" />
			<span className="primary">此文件夹为空</span>
			<button type="button" className="btn" onClick={onNewFolder}>
				新建文件夹
			</button>
		</div>
	)
}

export function NoResults({ query, onClear }: { query: string; onClear: () => void }) {
	return (
		<div className="state">
			<Icon name="search" />
			<span className="primary">没有匹配“{query}”的项目</span>
			<button type="button" className="btn" onClick={onClear}>
				清除搜索
			</button>
		</div>
	)
}

export function LoadError({
	message,
	permission,
	onRetry,
}: {
	message: string
	permission: boolean
	onRetry: () => void
}) {
	if (permission) {
		return (
			<div className="state">
				<Icon name="lock" />
				<span className="primary">你没有权限查看此文件夹</span>
				<button type="button" className="btn" onClick={onRetry}>
					重试
				</button>
			</div>
		)
	}
	return (
		<div className="state">
			<Icon name="error" />
			{/* 简明原因，原始报错留在日志面板 */}
			<span className="primary">{message}</span>
			<button type="button" className="btn" onClick={onRetry}>
				重试
			</button>
		</div>
	)
}

export function NoBucket() {
	return (
		<div className="state">
			<img src={iconFor("bucket", true)} alt="" />
			<span className="primary">先从左上角地址栏或面包屑选一个 Bucket</span>
		</div>
	)
}
