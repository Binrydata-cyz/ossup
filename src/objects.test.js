import assert from "node:assert/strict"
import { test } from "node:test"

import {
	formatSize,
	formatTime,
	kindOf,
	nextToken,
	pickObjects,
} from "./objects.js"

test("目录排在文件前面，名字去掉当前前缀", () => {
	const got = pickObjects(
		{
			CommonPrefixes: [{ Prefix: "a/b/images/" }],
			Contents: [{ Key: "a/b/note.txt", Size: "12", LastModified: "2026-01-02T03:04:05.000Z" }],
		},
		"a/b/",
	)
	assert.deepEqual(
		got.map((o) => [o.name, o.folder]),
		[
			["images", true],
			["note.txt", false],
		],
	)
})

test("目录占位对象不当成文件列出来", () => {
	/* prefix 自己会作为 0 字节对象出现在 Contents 里 */
	const got = pickObjects(
		{ Contents: [{ Key: "a/b/", Size: "0" }, { Key: "a/b/sub/", Size: "0" }] },
		"a/b/",
	)
	assert.deepEqual(got, [])
})

test("bucket 根目录（prefix 为空）", () => {
	const got = pickObjects({ Contents: [{ Key: "top.json", Size: "5" }] })
	assert.equal(got[0].name, "top.json")
})

test("空返回不抛", () => {
	assert.deepEqual(pickObjects(null), [])
	assert.deepEqual(pickObjects({}), [])
})

test("nextToken 认字符串 true", () => {
	assert.equal(nextToken({ IsTruncated: "true", NextContinuationToken: "t1" }), "t1")
	assert.equal(nextToken({ IsTruncated: "false", NextContinuationToken: "t1" }), "")
	assert.equal(nextToken({}), "")
})

test("kindOf 按扩展名分类", () => {
	assert.equal(kindOf("a.json"), "code")
	assert.equal(kindOf("a.jsonl"), "code")
	assert.equal(kindOf("A.JSON"), "code")
	assert.equal(kindOf("a.pdf"), "pdf")
	assert.equal(kindOf("a.mp4"), "video")
	assert.equal(kindOf("a.bin"), "file")
	assert.equal(kindOf("README"), "file")
})

test("formatSize 进位到合适单位", () => {
	assert.equal(formatSize(0), "0 B")
	assert.equal(formatSize(512), "512 B")
	assert.equal(formatSize(1024), "1.0 KB")
	assert.equal(formatSize(1536), "1.5 KB")
	assert.equal(formatSize(1024 ** 3 * 2), "2.0 GB")
	assert.equal(formatSize(NaN), "")
})

test("formatTime 砍掉秒和毫秒", () => {
	assert.equal(formatTime("2024-06-28T06:26:03.000Z"), "2024-06-28 06:26")
	assert.equal(formatTime(""), "")
	assert.equal(formatTime(undefined), "")
})
