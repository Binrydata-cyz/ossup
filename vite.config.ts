import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Tauri expects a fixed port and no clearScreen so Rust logs stay visible.
export default defineConfig({
	plugins: [react()],
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
		watch: { ignored: ["**/src-tauri/**"] },
	},
	build: {
		target: "es2021",
		minify: "esbuild",
		sourcemap: false,
	},
})
