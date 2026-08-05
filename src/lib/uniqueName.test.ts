import assert from "node:assert/strict"
import { test } from "node:test"

/* useOssActions.ts 会 import tauri 插件，node --test 加载不了，
   所以这里复制一份同样的实现来测。两边改动要一起改。
   ponytail: 只有这一个纯函数值得测，为它单开一个模块不划算。 */
function uniqueName(name: string, taken: Set<string>): string {
	if (!taken.has(name)) return name
	const dot = name.lastIndexOf(".")
	const hasExt = dot > 0 && name.length - dot <= 8
	const stem = hasExt ? name.slice(0, dot) : name
	const ext = hasExt ? name.slice(dot) : ""
	for (let i = 2; i < 1000; i++) {
		const candidate = `${stem} (${i})${ext}`
		if (!taken.has(candidate)) return candidate
	}
	return `${stem} (${Date.now()})${ext}`
}

test("不冲突就原样返回", () => {
	assert.equal(uniqueName("a.json", new Set()), "a.json")
})

test("冲突时补 (2)，扩展名留在最后", () => {
	assert.equal(uniqueName("a.json", new Set(["a.json"])), "a (2).json")
})

test("连续冲突继续往后找", () => {
	const taken = new Set(["a.json", "a (2).json", "a (3).json"])
	assert.equal(uniqueName("a.json", taken), "a (4).json")
})

test("没有扩展名的直接加后缀", () => {
	assert.equal(uniqueName("报告", new Set(["报告"])), "报告 (2)")
	assert.equal(uniqueName("新建文件夹", new Set(["新建文件夹"])), "新建文件夹 (2)")
})

test("点号靠前的不当扩展名，别把整个名字劈开", () => {
	/* 长尾巴不是扩展名：a.verylongsuffix 里的 .verylongsuffix 超过 8 字符 */
	assert.equal(
		uniqueName("a.verylongsuffix", new Set(["a.verylongsuffix"])),
		"a.verylongsuffix (2)",
	)
	/* 开头就是点的隐藏文件不该被劈 */
	assert.equal(uniqueName(".gitignore", new Set([".gitignore"])), ".gitignore (2)")
})
