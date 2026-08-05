/* ListBuckets 返回的纯解析逻辑。刻意不 import tauri，好让 node --test 直接跑。 */

export type Bucket = {
	name: string
	location: string
	storageClass: string
	extranetEndpoint: string
}

/* ossutil 没在文档里写死 JSON 的外层结构（XML 转过来可能带 Buckets.Bucket 包一层，
   也可能是裸数组），几种都接一下。单个 Bucket 时 XML→JSON 常退化成对象而非数组。 */
export function pickBuckets(json: any): Bucket[] {
	const raw = json?.Buckets?.Bucket ?? json?.Buckets ?? json?.buckets ?? []
	const list = (Array.isArray(raw) ? raw : [raw]).filter(Boolean)
	return list
		.map(
			(b: any): Bucket =>
				typeof b === "string"
					? { name: b, location: "", storageClass: "", extranetEndpoint: "" }
					: {
							name: b.Name ?? b.name ?? "",
							location: b.Location ?? b.location ?? "",
							storageClass: b.StorageClass ?? b.storageClass ?? "",
							extranetEndpoint: b.ExtranetEndpoint ?? b.extranetEndpoint ?? "",
						},
		)
		.filter((b: Bucket) => b.name)
}

/* 跨地域的 Bucket 不换 endpoint 就连不上。ListBuckets 直接给了 ExtranetEndpoint，
   优先用它；没有才从 Location（形如 "oss-cn-shanghai"）拼。 */
export function endpointOf(bucket: Partial<Bucket>): string {
	if (bucket.extranetEndpoint) return bucket.extranetEndpoint
	return bucket.location?.startsWith("oss-") ? `${bucket.location}.aliyuncs.com` : ""
}

/* ListBuckets 一次最多 1000 个，超了要跟着 NextMarker 翻页。
   注意这份 JSON 里布尔值是字符串 "true"，不能直接当真值用。 */
export function nextMarker(json: any): string {
	return String(json?.IsTruncated) === "true" ? (json?.NextMarker ?? "") : ""
}
