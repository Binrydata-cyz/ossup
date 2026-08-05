import assert from "node:assert/strict"
import { test } from "node:test"

import { endpointOf, nextMarker, pickBuckets } from "./buckets.ts"

const one = { Name: "a", Location: "oss-cn-hangzhou", StorageClass: "Standard" }

test("XML 转过来的 Buckets.Bucket 包一层", () => {
	const got = pickBuckets({ Buckets: { Bucket: [one] } })
	assert.deepEqual(got, [
		{
			name: "a",
			location: "oss-cn-hangzhou",
			storageClass: "Standard",
			extranetEndpoint: "",
		},
	])
})

test("单个 Bucket 退化成对象而非数组", () => {
	assert.equal(pickBuckets({ Buckets: { Bucket: one } }).length, 1)
})

test("裸数组 / 小写键也认", () => {
	assert.equal(pickBuckets({ Buckets: [one] }).length, 1)
	assert.equal(pickBuckets({ buckets: [{ name: "b" }] })[0].name, "b")
})

test("认不出来时返回空数组，不抛", () => {
	assert.deepEqual(pickBuckets(null), [])
	assert.deepEqual(pickBuckets({}), [])
	assert.deepEqual(pickBuckets({ Buckets: { Bucket: [{ Foo: 1 }] } }), [])
})

/* endpointOf 吃的是 pickBuckets 的输出（小写键），不是原始 JSON */
test("endpointOf 优先用返回里的 ExtranetEndpoint", () => {
	const [parsed] = pickBuckets({
		Buckets: { Bucket: [{ ...one, ExtranetEndpoint: "oss-cn-shanghai.aliyuncs.com" }] },
	})
	assert.equal(endpointOf(parsed), "oss-cn-shanghai.aliyuncs.com")
})

test("没有 ExtranetEndpoint 时才从 location 拼", () => {
	const [parsed] = pickBuckets({ Buckets: { Bucket: [one] } })
	assert.equal(endpointOf(parsed), "oss-cn-hangzhou.aliyuncs.com")
	assert.equal(endpointOf({ location: "" }), "")
	assert.equal(endpointOf({}), "")
})

test("nextMarker 认字符串 true，不是布尔", () => {
	assert.equal(nextMarker({ IsTruncated: "true", NextMarker: "projectengcdn" }), "projectengcdn")
	assert.equal(nextMarker({ IsTruncated: "false", NextMarker: "x" }), "")
	assert.equal(nextMarker({ IsTruncated: "true" }), "")
	assert.equal(nextMarker({}), "")
})
