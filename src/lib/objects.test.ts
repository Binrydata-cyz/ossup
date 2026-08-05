import assert from "node:assert/strict"
import { test } from "node:test"

import { kindOf, nextToken, pickObjects, typeLabel } from "./objects.ts"

test("目录排在文件前面，名字去掉当前前缀", () => {
	const got = pickObjects(
		{
			CommonPrefixes: [{ Prefix: "a/b/images/" }],
			Contents: [
				{ Key: "a/b/note.txt", Size: "12", LastModified: "2026-01-02T03:04:05.000Z" },
			],
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

test("kindOf 覆盖各大类", () => {
	assert.equal(kindOf("a.pdf"), "pdf")
	assert.equal(kindOf("a.png"), "image")
	assert.equal(kindOf("a.xlsx"), "sheet")
	assert.equal(kindOf("a.zip"), "archive")
	assert.equal(kindOf("a.docx"), "doc")
	assert.equal(kindOf("a.bin"), "file")
	assert.equal(kindOf("README"), "file")
})

test("音频和视频同归 video，共用视频图标", () => {
	for (const ext of ["mp4", "mov", "mkv", "webm", "wav", "mp3", "flac", "m4a"]) {
		assert.equal(kindOf(`a.${ext}`), "video", ext)
	}
})

test("json / txt / csv 这类纯文本归 code", () => {
	for (const ext of ["json", "jsonl", "txt", "csv", "tsv", "md", "log", "yaml", "xml"]) {
		assert.equal(kindOf(`a.${ext}`), "code", ext)
	}
	assert.equal(kindOf("A.JSON"), "code")
})

test("csv 是纯文本不是电子表格，xlsx 才是", () => {
	assert.equal(kindOf("a.csv"), "code")
	assert.equal(kindOf("a.xlsx"), "sheet")
})

test(".ts 归视频而非 TypeScript —— OSS 上更可能是传输流", () => {
	assert.equal(kindOf("seg-001.ts"), "video")
})

test("typeLabel 带扩展名，文件夹只显示文件夹", () => {
	assert.equal(typeLabel({ name: "a.xlsx", folder: false }), "XLSX 表格")
	assert.equal(typeLabel({ name: "README", folder: false }), "文件")
	assert.equal(typeLabel({ name: "images", folder: true }), "文件夹")
})
