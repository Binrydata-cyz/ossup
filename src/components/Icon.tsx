/* 界面用的线性图标。统一 24 视野、currentColor，尺寸交给 CSS。 */

const P = {
	back: "M19 12H5M12 19l-7-7 7-7",
	forward: "M5 12h14M12 5l7 7-7 7",
	up: "M12 19V5M5 12l7-7 7 7",
	refresh: "M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6",
	chevron: "m6 9 6 6 6-6",
	close: "m18 6-12 12M6 6l12 12",
	minimize: "M5 12h14",
	maximize: "",
	search: "m21 21-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z",
	copy: "M9 9h10v10H9zM5 15V5h10",
	paste: "M9 3h6v3H9zM7 5H5v16h14V5h-2",
	rename: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z",
	share: "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 15V3M8 7l4-4 4 4",
	trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
	sort: "M12 20V4M6 10l6-6 6 6",
	view: "M4 6h16M4 12h16M4 18h16",
	more: "M6 12h.01M12 12h.01M18 12h.01",
	plus: "M12 5v14M5 12h14",
	error: "M12 8v5M12 17h.01M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.4h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
	lock: "M6 11h12v9H6zM9 11V7a3 3 0 0 1 6 0v4",
	folder: "M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
	upload: "M12 19V6M5 13l7-7 7 7M4 21h16",
	stop: "M7 7h10v10H7z",
	log: "M8 6h11M8 12h11M8 18h11M3 6h.01M3 12h.01M3 18h.01",
	eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
	eyeOff:
		"M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.2A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.4 4.3M6.7 6.7A17.4 17.4 0 0 0 2 12s3.5 7 10 7a10.3 10.3 0 0 0 2.8-.4",
} as const

export type IconName = keyof typeof P

export function Icon({ name, className }: { name: IconName; className?: string }) {
	if (name === "maximize") {
		return (
			<svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7">
				<rect x="5.5" y="5.5" width="13" height="13" rx="1.5" />
			</svg>
		)
	}
	return (
		<svg
			viewBox="0 0 24 24"
			className={className}
			fill="none"
			stroke="currentColor"
			strokeWidth="1.7"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d={P[name]} />
		</svg>
	)
}
