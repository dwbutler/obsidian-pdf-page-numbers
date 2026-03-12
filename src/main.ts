import { Plugin } from "obsidian";
import { remote } from "electron";
import {
	PdfPageNumbersSettings,
	DEFAULT_SETTINGS,
	PdfPageNumbersSettingTab,
} from "./settings";

import type { PrintToPDFOptions, WebContents } from "electron";

/**
 * PDF Page Numbers Plugin
 *
 * Intercepts Electron's webContents.printToPDF() to inject native
 * header/footer templates with page numbers. This is the only reliable
 * approach because:
 *   - CSS @page margin boxes (counter(page)) are not supported in Chromium
 *   - DOM-based page counting is unreliable (the print engine handles pagination)
 *   - Electron's printToPDF natively supports displayHeaderFooter with
 *     automatic pageNumber/totalPages substitution
 */
export default class PdfPageNumbersPlugin extends Plugin {
	settings: PdfPageNumbersSettings = DEFAULT_SETTINGS;
	private originalPrintToPDF:
		| ((options: PrintToPDFOptions) => Promise<Uint8Array>)
		| null = null;
	private patchedWebContents: WebContents | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new PdfPageNumbersSettingTab(this.app, this));
		this.patchPrintToPDF();
	}

	onunload(): void {
		this.restorePrintToPDF();
	}

	async loadSettings(): Promise<void> {
		const loaded: unknown = await this.loadData();
		const data = (loaded ?? {}) as Partial<PdfPageNumbersSettings>;
		this.settings = { ...DEFAULT_SETTINGS, ...data };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// ── Template builder ───────────────────────────────────────────

	/**
	 * Build the HTML template for Electron's header/footer.
	 *
	 * Electron replaces special CSS class names with actual values:
	 *   <span class="pageNumber"></span>  → current page number
	 *   <span class="totalPages"></span>  → total page count
	 *
	 * IMPORTANT: The default template font-size is 0, so we must
	 * explicitly set font-size on all elements.
	 */
	private buildTemplate(): string {
		const s = this.settings;

		let textAlign = "center";
		let padding = "0";
		if (s.position.endsWith("left")) {
			textAlign = "left";
			padding = `0 0 0 ${s.marginSide}px`;
		} else if (s.position.endsWith("right")) {
			textAlign = "right";
			padding = `0 ${s.marginSide}px 0 0`;
		}

		let content: string;
		switch (s.format) {
			case "page-only":
				content = '<span class="pageNumber"></span>';
				break;
			case "page-of-total":
				content =
					'Page <span class="pageNumber"></span> of <span class="totalPages"></span>';
				break;
			case "custom":
				content = s.customFormat
					.replace(
						/\{\{page\}\}/g,
						'<span class="pageNumber"></span>'
					)
					.replace(
						/\{\{total\}\}/g,
						'<span class="totalPages"></span>'
					);
				break;
			default:
				content = '<span class="pageNumber"></span>';
		}

		const fontFamily =
			s.fontFamily === "inherit" ? "sans-serif" : s.fontFamily;

		return (
			`<div style="width: 100%; font-size: ${s.fontSize}px;` +
			` font-family: ${fontFamily}; color: ${s.color};` +
			` text-align: ${textAlign}; padding: ${padding};` +
			` -webkit-print-color-adjust: exact;` +
			` print-color-adjust: exact;">` +
			`${content}</div>`
		);
	}

	// ── Electron printToPDF patch ──────────────────────────────────

	/**
	 * Patch webContents.printToPDF to inject displayHeaderFooter
	 * with our page number template.
	 */
	private patchPrintToPDF(): void {
		if (!remote) {
			console.warn(
				"PDF Page Numbers: Electron remote module not available"
			);
			return;
		}

		const webContents = remote.getCurrentWebContents();
		if (!webContents?.printToPDF) {
			console.warn(
				"PDF Page Numbers: webContents.printToPDF not available"
			);
			return;
		}

		this.patchedWebContents = webContents;

		// Capture the original method before we replace it.
		const origFn = webContents.printToPDF.bind(webContents) as (
			options: PrintToPDFOptions
		) => Promise<Uint8Array>;

		this.originalPrintToPDF = origFn;

		// Use an arrow function to capture `this` without aliasing
		const getEnabled = (): boolean => this.settings.enabled;
		const getPosition = (): string => this.settings.position;
		const buildTmpl = (): string => this.buildTemplate();

		webContents.printToPDF = (
			options: PrintToPDFOptions
		): Promise<Uint8Array> => {
			if (getEnabled()) {
				const isTop = getPosition().startsWith("top");
				const template = buildTmpl();
				const emptyTemplate = "<span></span>";

				return origFn({
					...options,
					displayHeaderFooter: true,
					headerTemplate: isTop ? template : emptyTemplate,
					footerTemplate: isTop ? emptyTemplate : template,
				});
			}

			return origFn(options);
		};

		// Auto-restore on plugin unload via Obsidian's register()
		this.register(() => {
			this.restorePrintToPDF();
		});

		console.debug(
			"PDF Page Numbers: patched printToPDF successfully"
		);
	}

	private restorePrintToPDF(): void {
		if (this.patchedWebContents && this.originalPrintToPDF) {
			this.patchedWebContents.printToPDF = this.originalPrintToPDF;
			this.originalPrintToPDF = null;
			this.patchedWebContents = null;
		}
	}
}
