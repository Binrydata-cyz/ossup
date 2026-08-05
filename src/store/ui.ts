/* 只在会话内活着的零碎界面状态：toast、日志面板、弹窗、剪贴板。
   需要持久化的（收藏夹、侧边栏宽、列宽、视图模式）在 prefs.ts。

   弹窗和剪贴板放在 store 里，是因为工具栏和右键菜单要共用同一份 —— 各自
   持有一份 useState 的话，工具栏点"粘贴"看不到右键菜单复制进去的东西。 */

import { create } from "zustand"

import type { ConfirmSpec, PromptSpec } from "../components/Prompt.tsx"

type Toast = { id: number; text: string; kind: "" | "error" | "success" }

export type ClipItem = { key: string; name: string; folder: boolean }

export type Clipboard = {
	bucket: string
	/** Bucket 所在地域。ossutil cp 不支持跨地域，粘贴前要拦一下 */
	location: string
	items: ClipItem[]
}

type UiState = {
	toast: Toast | null
	logOpen: boolean
	prompt: PromptSpec | null
	confirm: ConfirmSpec | null
	clipboard: Clipboard | null

	showToast: (text: string, kind?: Toast["kind"]) => void
	toggleLog: () => void
	showPrompt: (spec: PromptSpec) => void
	showConfirm: (spec: ConfirmSpec) => void
	closeDialogs: () => void
	setClipboard: (clip: Clipboard | null) => void
}

let seq = 0

export const useUiStore = create<UiState>((set, get) => ({
	toast: null,
	logOpen: false,
	prompt: null,
	confirm: null,
	clipboard: null,

	showPrompt: (prompt) => set({ prompt, confirm: null }),
	showConfirm: (confirm) => set({ confirm, prompt: null }),
	closeDialogs: () => set({ prompt: null, confirm: null }),
	setClipboard: (clipboard) => set({ clipboard }),

	showToast: (text, kind = "") => {
		const id = ++seq
		set({ toast: { id, text, kind } })
		setTimeout(() => {
			/* 期间又弹了新的就别把新的抹掉 */
			if (get().toast?.id === id) set({ toast: null })
		}, 4000)
	},

	toggleLog: () => set((s) => ({ logOpen: !s.logOpen })),
}))
