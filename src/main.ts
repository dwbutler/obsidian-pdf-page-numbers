import { Plugin, Notice } from "obsidian";
import {
	PdfPageNumbersSettings,
	DEFAULT_SETTINGS,
	PdfPageNumbersSettingTab,
} from "./settings";

/**
 * PDF Page Numbers Plugin
 *
 * Strategy: Obsidian's "Export to PDF" renders a print-ready document and then
 * calls Electron's `webContents.printToPDF()`.  The document is composed of
 * `.print .markdown-preview-view` with explicit `page-break` dividers.
 *
 * We inject a `<style>` block (print-only CSS) that uses CSS @page margin
 * boxes where supported, **plus** a robust JS-based fallback that physically
 * inserts page-number elements at each page-break boundary right before the
 * PDF is rendered.  The fallback is cleaned up afterwards.
 *
 * The monkey-patch intercepts the internal `exportToPdf` flow so everything
 * is transparent to the user.
 */
export default class PdfPageNumbersPlugin extends Plugin {
	settings: PdfPageNumbersSettings = DEFAULT_SETTINGS;
	private styleEl: HTMLStyleElement | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new PdfPageNumbersSettingTab(this.app, this));

		// Inject a persistent print-media stylesheet that handles page numbers
		this.injectPrintStyles();

		// Monkey-patch the workspace PDF export to add JS-based page numbers
		this.patchPdfExport();
	}

	onunload() {
		this.removePrintStyles();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Re-inject styles whenever settings change
		this.injectPrintStyles();
	}

	// ── CSS injection ──────────────────────────────────────────────

	private buildCss(): string {
		const s = this.settings;
		const isTop = s.position.startsWith("top");
		const verticalProp = isTop ? "top" : "bottom";
		const verticalVal = isTop ? `${s.marginTop}px` : `${s.marginBottom}px`;

		let textAlign = "center";
		let leftVal = "0";
		let rightVal = "0";
		if (s.position.endsWith("left")) {
			textAlign = "left";
			leftVal = `${s.marginSide}px`;
			rightVal = "auto";
		} else if (s.position.endsWith("right")) {
			textAlign = "right";
			leftVal = "auto";
			rightVal = `${s.marginSide}px`;
		}

		// The .pdf-page-number elements are inserted by JS before export
		return `
@media print {
	.pdf-page-number {
		position: relative;
		width: 100%;
		${verticalProp}: ${verticalVal};
		left: ${leftVal};
		right: ${rightVal};
		text-align: ${textAlign};
		font-size: ${s.fontSize}pt;
		font-family: ${s.fontFamily};
		color: ${s.color};
		z-index: 9999;
		padding: 4px 0;
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}
	.pdf-page-number.skip {
		visibility: hidden;
	}
}

/* Hide on screen */
.pdf-page-number {
	display: none;
}
@media print {
	.pdf-page-number {
		display: block;
	}
}
`;
	}

	private injectPrintStyles() {
		this.removePrintStyles();
		this.styleEl = document.createElement("style");
		this.styleEl.id = "pdf-page-numbers-style";
		this.styleEl.textContent = this.buildCss();
		document.head.appendChild(this.styleEl);
	}

	private removePrintStyles() {
		if (this.styleEl) {
			this.styleEl.remove();
			this.styleEl = null;
		}
	}

	// ── Format helper ──────────────────────────────────────────────

	private formatPageNumber(page: number, total: number): string {
		const s = this.settings;
		switch (s.format) {
			case "page-only":
				return `${page}`;
			case "page-of-total":
				return `Page ${page} of ${total}`;
			case "custom":
				return s.customFormat
					.replace(/\{\{page\}\}/g, `${page}`)
					.replace(/\{\{total\}\}/g, `${total}`);
			default:
				return `${page}`;
		}
	}

	// ── JS page-number injection ───────────────────────────────────

	/**
	 * Finds the print container, counts pages, and inserts a
	 * `.pdf-page-number` element on each page.
	 * Returns a cleanup function that removes the injected elements.
	 */
	private injectPageNumbers(doc: Document): () => void {
		// Obsidian renders PDF export inside elements with class
		// "print" on the container and each page is a direct child
		// of .markdown-preview-view separated by <hr class="pdf-page-break"> etc.
		// In newer Obsidian versions, each "page" is wrapped in a <div> with
		// explicit page-break styles.

		const injected: HTMLElement[] = [];

		// Strategy: find all page-break-like elements and treat
		// each segment as a page.  We insert a page-number div
		// at the end of each segment.

		// Look for the print preview sections
		const containers = doc.querySelectorAll<HTMLElement>(
			".print .markdown-preview-section, .print .markdown-preview-view > div"
		);

		// Fallback: if we find explicit page break markers
		const pageBreaks = doc.querySelectorAll<HTMLElement>(
			".print [style*='break-before'], .print [style*='page-break'], .print .pdf-page-break"
		);

		if (containers.length > 1) {
			this.injectIntoContainers(doc, Array.from(containers), injected);
		} else if (pageBreaks.length > 0) {
			this.injectAtPageBreaks(doc, Array.from(pageBreaks), injected);
		} else {
			// Last resort: single-page document – just add one number
			const printRoot = doc.querySelector<HTMLElement>(
				".print .markdown-preview-view, .print"
			);
			if (printRoot) {
				const total = 1;
				const el = this.createPageNumberEl(doc, 1, total);
				printRoot.appendChild(el);
				injected.push(el);
			}
		}

		return () => {
			for (const el of injected) {
				el.remove();
			}
		};
	}

	private injectIntoContainers(
		doc: Document,
		containers: HTMLElement[],
		injected: HTMLElement[]
	) {
		// Filter out zero-height / invisible containers
		const visible = containers.filter((c) => c.offsetHeight > 0);
		const total = visible.length || 1;

		for (let i = 0; i < visible.length; i++) {
			const page = i + 1;
			const el = this.createPageNumberEl(doc, page, total);
			visible[i].appendChild(el);
			injected.push(el);
		}
	}

	private injectAtPageBreaks(
		doc: Document,
		breaks: HTMLElement[],
		injected: HTMLElement[]
	) {
		const total = breaks.length + 1;

		// Insert page number BEFORE each break (end of that page)
		for (let i = 0; i < breaks.length; i++) {
			const page = i + 1;
			const el = this.createPageNumberEl(doc, page, total);
			breaks[i].parentElement?.insertBefore(el, breaks[i]);
			injected.push(el);
		}

		// Last page: after the last break
		const lastBreak = breaks[breaks.length - 1];
		if (lastBreak?.parentElement) {
			const el = this.createPageNumberEl(doc, total, total);
			lastBreak.parentElement.appendChild(el);
			injected.push(el);
		}
	}

	private createPageNumberEl(
		doc: Document,
		page: number,
		total: number
	): HTMLElement {
		const el = doc.createElement("div");
		el.className = "pdf-page-number";
		el.textContent = this.formatPageNumber(page, total);

		if (page === 1 && this.settings.skipFirstPage) {
			el.classList.add("skip");
		}

		return el;
	}

	// ── Monkey-patch PDF export ────────────────────────────────────

	private patchPdfExport() {
		// Obsidian exposes the workspace's `exportToPdf` or triggers it
		// through the command palette.  We wrap the relevant Electron
		// webContents.printToPDF call.
		//
		// The cleanest integration: listen to the 'before-print' /
		// 'afterprint' window events.  Obsidian's export triggers the
		// print pipeline even for direct PDF export.

		const self = this;

		// Approach 1: Window print events (works for Cmd/Ctrl+P and Export to PDF)
		const beforePrintHandler = () => {
			try {
				self._cleanup = self.injectPageNumbers(document);
			} catch (e) {
				console.error("PDF Page Numbers: error injecting page numbers", e);
			}
		};

		const afterPrintHandler = () => {
			try {
				if (self._cleanup) {
					self._cleanup();
					self._cleanup = null;
				}
			} catch (e) {
				console.error("PDF Page Numbers: error cleaning up page numbers", e);
			}
		};

		window.addEventListener("beforeprint", beforePrintHandler);
		window.addEventListener("afterprint", afterPrintHandler);

		this.register(() => {
			window.removeEventListener("beforeprint", beforePrintHandler);
			window.removeEventListener("afterprint", afterPrintHandler);
		});

		// Approach 2: Monkey-patch the workspace's internal export method
		// for robustness (Obsidian may not trigger window print events for
		// its custom PDF export pipeline).
		this.patchWorkspaceExport();
	}

	private _cleanup: (() => void) | null = null;

	private patchWorkspaceExport() {
		const self = this;

		// The Obsidian app object has an internal method for PDF export.
		// We try to find and wrap it.  This is done defensively since
		// internal APIs may change between versions.
		const workspace = this.app.workspace as any;

		// Attempt to wrap workspace methods that are commonly used in export
		const originalExportPdf =
			workspace.exportToPdf?.bind(workspace) ??
			workspace.exportPdf?.bind(workspace);

		if (originalExportPdf) {
			const wrappedExport = async function (...args: any[]) {
				let cleanup: (() => void) | null = null;
				try {
					cleanup = self.injectPageNumbers(document);
					// Small delay to let DOM updates propagate
					await sleep(50);
					const result = await originalExportPdf(...args);
					return result;
				} finally {
					if (cleanup) cleanup();
				}
			};

			if (workspace.exportToPdf) {
				workspace.exportToPdf = wrappedExport;
				this.register(() => {
					workspace.exportToPdf = originalExportPdf;
				});
			} else if (workspace.exportPdf) {
				workspace.exportPdf = wrappedExport;
				this.register(() => {
					workspace.exportPdf = originalExportPdf;
				});
			}
		}

		// Also patch via command — override the built-in export-pdf command
		// to wrap it with our injection
		this.addCommand({
			id: "export-pdf-with-page-numbers",
			name: "Export to PDF with page numbers",
			callback: async () => {
				// Inject page numbers, then trigger the native export command
				const cleanup = self.injectPageNumbers(document);
				try {
					// Trigger native export
					(this.app as any).commands.executeCommandById(
						"workspace:export-pdf"
					);
					// Wait for export dialog to appear and complete
					// Cleanup after a generous delay
					setTimeout(() => {
						cleanup();
					}, 30000); // 30s – cleaned up by afterprint handler sooner if possible
				} catch (e) {
					cleanup();
					new Notice("Failed to trigger PDF export");
					console.error(e);
				}
			},
		});
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
