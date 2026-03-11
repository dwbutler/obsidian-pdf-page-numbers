import { Plugin } from "obsidian";
import {
	PdfPageNumbersSettings,
	DEFAULT_SETTINGS,
	PdfPageNumbersSettingTab,
} from "./settings";

const ORIGINAL_PRINT_TO_PDF = Symbol("pdf-page-numbers-original");
const WEBVIEW_READY_HANDLER = Symbol("pdf-page-numbers-webview-ready");

type PrintToPdfTarget = {
	id?: number;
	printToPDF?: (options?: any) => Promise<unknown>;
	addEventListener?: (
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions
	) => void;
	removeEventListener?: (
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | EventListenerOptions
	) => void;
	[ORIGINAL_PRINT_TO_PDF]?: (...args: any[]) => unknown;
	[WEBVIEW_READY_HANDLER]?: EventListener;
};

type PopupWindow = Window & {
	electron?: {
		ipcRenderer?: {
			send?: (...args: any[]) => void;
		};
	};
};

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
	private patchedTargets = new Set<PrintToPdfTarget>();
	private activePrintRoots = new Map<HTMLElement, () => void>();
	private popupMonitors = new Map<PopupWindow, number>();
	private styleEl: HTMLStyleElement | null = null;
	private originalWindowOpen: typeof window.open | null = null;
	private originalWindowPrint: (() => void) | null = null;
	private printObserver: MutationObserver | null = null;
	private webviewObserver: MutationObserver | null = null;
	private exportDialogObserver: MutationObserver | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new PdfPageNumbersSettingTab(this.app, this));
		this.injectPrintStyles();
		this.patchWindowOpen();
		this.patchWindowPrint();
		this.observePrintRoots();
		this.patchPrintSurfaces();
		this.observeWebviews();
		this.observeExportDialogs();
	}

	onunload() {
		this.clearActivePrintRoots();
		this.restoreWindowOpen();
		this.restoreWindowPrint();
		this.removePrintStyles();
		this.restorePrintToPDF();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.injectPrintStyles();
		this.refreshActivePrintRoots();
	}

	private buildCss(): string {
		return `
.pdf-page-number {
	display: block;
	pointer-events: none;
	-webkit-print-color-adjust: exact;
	print-color-adjust: exact;
}

.pdf-page-number.skip {
	visibility: hidden;
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
		if (!this.styleEl) return;
		this.styleEl.remove();
		this.styleEl = null;
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

		return `<div style="width: 100%; font-size: ${s.fontSize}px; font-family: ${fontFamily}; color: ${s.color}; text-align: ${textAlign}; padding: ${padding}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">${content}</div>`;
	}

	private patchWindowPrint() {
		if (this.originalWindowPrint) return;

		this.originalWindowPrint = window.print.bind(window);
		const beforePrintHandler = () => {
			this.preparePrintRoots();
		};
		const afterPrintHandler = () => {
			window.setTimeout(() => this.cleanupDetachedPrintRoots(), 250);
		};

		window.addEventListener("beforeprint", beforePrintHandler);
		window.addEventListener("afterprint", afterPrintHandler);
		window.print = () => {
			this.preparePrintRoots();
			this.originalWindowPrint?.();
		};

		this.register(() => {
			window.removeEventListener("beforeprint", beforePrintHandler);
			window.removeEventListener("afterprint", afterPrintHandler);
		});
	}

	private patchWindowOpen() {
		if (this.originalWindowOpen) return;

		this.originalWindowOpen = window.open.bind(window);
		window.open = ((...args: Parameters<typeof window.open>) => {
			const popup = this.originalWindowOpen!(...args) as PopupWindow | null;
			if (popup) {
				this.monitorPopupWindow(popup);
			}
			return popup;
		}) as typeof window.open;
	}

	private restoreWindowOpen() {
		if (!this.originalWindowOpen) return;
		window.open = this.originalWindowOpen;
		this.originalWindowOpen = null;

		for (const intervalId of Array.from(this.popupMonitors.values())) {
			window.clearInterval(intervalId);
		}
		this.popupMonitors.clear();
	}

	private monitorPopupWindow(popup: PopupWindow) {
		if (this.popupMonitors.has(popup)) return;

		const intervalId = window.setInterval(() => {
			if (popup.closed) {
				window.clearInterval(intervalId);
				this.popupMonitors.delete(popup);
				return;
			}

			try {
				this.patchPopupPrintIpc(popup);
			} catch {
				// The popup may still be initializing; try again on the next tick.
			}
		}, 100);

		this.popupMonitors.set(popup, intervalId);
	}

	private patchPopupPrintIpc(popup: PopupWindow) {
		const ipcRenderer = popup.electron?.ipcRenderer;
		if (!ipcRenderer || typeof ipcRenderer.send !== "function") return;

		const sendTarget = ipcRenderer as PrintToPdfTarget & {
			send: (...args: any[]) => void;
		};
		if (sendTarget[ORIGINAL_PRINT_TO_PDF]) return;

		sendTarget[ORIGINAL_PRINT_TO_PDF] = sendTarget.send.bind(sendTarget);
		sendTarget.send = (channel: string, ...args: any[]) => {
			if (channel === "print-to-pdf" && args.length > 0) {
				args[0] = this.applyPageNumberOptions(args[0]);
			}
			return sendTarget[ORIGINAL_PRINT_TO_PDF]!(channel, ...args);
		};

		this.patchedTargets.add(sendTarget);

		const intervalId = this.popupMonitors.get(popup);
		if (intervalId !== undefined) {
			window.clearInterval(intervalId);
			this.popupMonitors.delete(popup);
		}
	}

	private restoreWindowPrint() {
		if (!this.originalWindowPrint) return;
		window.print = this.originalWindowPrint;
		this.originalWindowPrint = null;
	}

	private observePrintRoots() {
		const body = document.body;
		if (!body) return;

		this.preparePrintRoots(body);
		this.printObserver = new MutationObserver((mutations) => {
			for (const mutation of Array.from(mutations)) {
				if (mutation.target instanceof HTMLElement) {
					const activePrintRoot = mutation.target.closest(".print");
					if (activePrintRoot instanceof HTMLElement) {
						this.attachPageNumbers(activePrintRoot);
					}
				}

				for (const node of Array.from(mutation.addedNodes)) {
					if (node instanceof HTMLElement) {
						this.preparePrintRoots(node);
					}
				}
				for (const node of Array.from(mutation.removedNodes)) {
					if (node instanceof HTMLElement) {
						this.cleanupDetachedPrintRoots(node);
					}
				}
			}
		});

		this.printObserver.observe(body, {
			childList: true,
			subtree: true,
		});

		this.register(() => {
			this.printObserver?.disconnect();
			this.printObserver = null;
		});
	}

	private preparePrintRoots(root: ParentNode = document.body) {
		for (const printRoot of this.findPrintRoots(root)) {
			this.attachPageNumbers(printRoot);
		}
	}

	private findPrintRoots(root: ParentNode) {
		const roots = new Set<HTMLElement>();
		if (root instanceof HTMLElement && this.isPrintRoot(root)) {
			roots.add(root);
		}

		const printNodes = root.querySelectorAll?.(".print") ?? [];
		for (const node of Array.from(printNodes)) {
			if (node instanceof HTMLElement) {
				roots.add(node);
			}
		}

		return roots;
	}

	private isPrintRoot(el: HTMLElement) {
		return el.classList.contains("print") || el.classList.contains("print-preview");
	}

	private attachPageNumbers(printRoot: HTMLElement) {
		const existingCleanup = this.activePrintRoots.get(printRoot);
		if (existingCleanup) {
			existingCleanup();
			this.activePrintRoots.delete(printRoot);
		}

		if (!this.settings.enabled) return;

		const cleanup = this.injectPageNumbers(printRoot);
		this.activePrintRoots.set(printRoot, cleanup);
	}

	private refreshActivePrintRoots() {
		for (const printRoot of Array.from(this.activePrintRoots.keys())) {
			const cleanup = this.activePrintRoots.get(printRoot);
			cleanup?.();
			this.activePrintRoots.delete(printRoot);

			if (printRoot.isConnected) {
				this.attachPageNumbers(printRoot);
			}
		}
	}

	private cleanupDetachedPrintRoots(root?: HTMLElement) {
		for (const [printRoot, cleanup] of Array.from(this.activePrintRoots.entries())) {
			if (!printRoot.isConnected || (root && root.contains(printRoot))) {
				cleanup();
				this.activePrintRoots.delete(printRoot);
			}
		}
	}

	private clearActivePrintRoots() {
		for (const cleanup of Array.from(this.activePrintRoots.values())) {
			cleanup();
		}
		this.activePrintRoots.clear();
	}

	private injectPageNumbers(printRoot: HTMLElement) {
		const doc = printRoot.ownerDocument;
		const injected: HTMLElement[] = [];
		const cleanupTasks: Array<() => void> = [];
		const previewRoot =
			(printRoot.querySelector(".markdown-preview-view") as HTMLElement | null) ??
			printRoot;
		const pageContainers = this.findPageContainers(previewRoot);
		const pageBreaks = this.findPageBreaks(previewRoot);

		if (pageContainers.length > 1) {
			const total = pageContainers.length;
			pageContainers.forEach((container, index) => {
				const cleanup = this.preparePageContainer(container);
				if (cleanup) cleanupTasks.push(cleanup);

				const pageNumberEl = this.createPageNumberEl(
					doc,
					index + 1,
					total,
					true
				);
				container.appendChild(pageNumberEl);
				injected.push(pageNumberEl);
			});
		} else if (pageBreaks.length > 0) {
			const total = pageBreaks.length + 1;
			pageBreaks.forEach((pageBreak, index) => {
				const pageNumberEl = this.createPageNumberEl(
					doc,
					index + 1,
					total,
					false
				);
				pageBreak.parentElement?.insertBefore(pageNumberEl, pageBreak);
				injected.push(pageNumberEl);
			});

			const lastBreak = pageBreaks[pageBreaks.length - 1];
			if (lastBreak?.parentElement) {
				const pageNumberEl = this.createPageNumberEl(
					doc,
					total,
					total,
					false
				);
				lastBreak.parentElement.appendChild(pageNumberEl);
				injected.push(pageNumberEl);
			}
		} else {
			const pageNumberEl = this.createPageNumberEl(doc, 1, 1, false);
			previewRoot.appendChild(pageNumberEl);
			injected.push(pageNumberEl);
		}

		return () => {
			for (const injectedNode of injected) {
				injectedNode.remove();
			}
			for (const cleanup of cleanupTasks) {
				cleanup();
			}
		};
	}

	private findPageContainers(previewRoot: HTMLElement) {
		const directChildren = Array.from(previewRoot.children).filter(
			(child): child is HTMLElement => child instanceof HTMLElement
		);
		const visibleChildren = directChildren.filter((child) =>
			this.isVisibleElement(child)
		);
		const pageLikeChildren = visibleChildren.filter((child) =>
			this.looksLikePageContainer(child)
		);

		if (pageLikeChildren.length > 1) {
			return pageLikeChildren;
		}

		const explicitPages = Array.from(
			previewRoot.querySelectorAll<HTMLElement>(
				".print-page, .page[data-page-number], [data-pdf-page]"
			)
		).filter((child) => this.isVisibleElement(child));

		return explicitPages;
	}

	private findPageBreaks(previewRoot: HTMLElement) {
		return Array.from(
			previewRoot.querySelectorAll<HTMLElement>(
				".pdf-page-break, hr.page-break, [style*='page-break'], [style*='break-before'], [style*='break-after']"
			)
		).filter((pageBreak) => this.isVisibleElement(pageBreak));
	}

	private looksLikePageContainer(el: HTMLElement) {
		const computed = window.getComputedStyle(el);
		return (
			el.classList.contains("page") ||
			el.classList.contains("print-page") ||
			computed.breakAfter !== "auto" ||
			computed.breakBefore !== "auto" ||
			computed.pageBreakAfter !== "auto" ||
			computed.pageBreakBefore !== "auto"
		);
	}

	private isVisibleElement(el: HTMLElement) {
		const computed = window.getComputedStyle(el);
		return (
			computed.display !== "none" &&
			computed.visibility !== "hidden" &&
			el.offsetHeight > 0
		);
	}

	private preparePageContainer(container: HTMLElement) {
		const existingPosition = container.style.position;
		if (window.getComputedStyle(container).position !== "static") {
			return null;
		}

		container.style.position = "relative";
		return () => {
			container.style.position = existingPosition;
		};
	}

	private createPageNumberEl(
		doc: Document,
		page: number,
		total: number,
		overlay: boolean
	) {
		const pageNumberEl = doc.createElement("div");
		pageNumberEl.className = "pdf-page-number";
		pageNumberEl.textContent = this.formatPageNumber(page, total);

		if (page === 1 && this.settings.skipFirstPage) {
			pageNumberEl.classList.add("skip");
		}

		this.applyPageNumberStyle(pageNumberEl, overlay);
		return pageNumberEl;
	}

	private formatPageNumber(page: number, total: number) {
		switch (this.settings.format) {
			case "page-only":
				return `${page}`;
			case "page-of-total":
				return `Page ${page} of ${total}`;
			case "custom":
				return this.settings.customFormat
					.replace(/\{\{page\}\}/g, `${page}`)
					.replace(/\{\{total\}\}/g, `${total}`);
			default:
				return `${page}`;
		}
	}

	private applyPageNumberStyle(pageNumberEl: HTMLElement, overlay: boolean) {
		const isTop = this.settings.position.startsWith("top");
		const style = pageNumberEl.style;
		style.fontSize = `${this.settings.fontSize}pt`;
		style.fontFamily = this.settings.fontFamily;
		style.color = this.settings.color;
		style.width = "100%";
		style.left = "0";
		style.right = "0";
		style.textAlign = this.settings.position.endsWith("left")
			? "left"
			: this.settings.position.endsWith("right")
				? "right"
				: "center";
		style.paddingLeft = this.settings.position.endsWith("left")
			? `${this.settings.marginSide}px`
			: "0";
		style.paddingRight = this.settings.position.endsWith("right")
			? `${this.settings.marginSide}px`
			: "0";
		style.boxSizing = "border-box";
		style.zIndex = "999";

		if (overlay) {
			style.position = "absolute";
			style.top = isTop ? `${this.settings.marginTop}px` : "";
			style.bottom = isTop ? "" : `${this.settings.marginBottom}px`;
		} else {
			style.position = "relative";
			style.marginTop = isTop ? `${this.settings.marginTop}px` : "12px";
			style.marginBottom = isTop ? "12px" : `${this.settings.marginBottom}px`;
		}
	}

	private patchPrintSurfaces() {
		this.patchElectronPrintTargets();
		this.patchWebviewsIn(document.body);

		const remote = getElectronRemote();
		const onBrowserWindowCreated = (_event: unknown, window: any) => {
			this.patchPrintTarget(window?.webContents);
		};
		remote?.app?.on?.("browser-window-created", onBrowserWindowCreated);

		this.register(() => {
			remote?.app?.removeListener?.(
				"browser-window-created",
				onBrowserWindowCreated
			);
		});

		this.registerInterval(
			window.setInterval(() => {
				this.patchElectronPrintTargets();
				this.patchWebviewsIn(document.body);
			}, 2000)
		);
	}

	private patchElectronPrintTargets() {
		try {
			const remote = getElectronRemote();
			if (!remote) return;

			this.patchPrintTarget(remote.getCurrentWebContents?.());

			const windows = remote.BrowserWindow?.getAllWindows?.() ?? [];
			for (const window of windows) {
				this.patchPrintTarget(window?.webContents);
			}

			const webContentsTargets =
				remote.webContents?.getAllWebContents?.() ?? [];
			for (const webContents of webContentsTargets) {
				this.patchPrintTarget(webContents);
			}
		} catch (e) {
			console.error(
				"PDF Page Numbers: failed while scanning print targets",
				e
			);
		}
	}

	private patchPrintTarget(target: PrintToPdfTarget | null | undefined) {
		if (!target || typeof target.printToPDF !== "function") return;
		if (target[ORIGINAL_PRINT_TO_PDF]) return;

		target[ORIGINAL_PRINT_TO_PDF] = target.printToPDF.bind(target);
		target.printToPDF = async (options: any = {}) => {
			return target[ORIGINAL_PRINT_TO_PDF]!(
				this.applyPageNumberOptions(options)
			);
		};

		this.patchedTargets.add(target);
	}

	private applyPageNumberOptions(options: any = {}) {
		if (!this.settings.enabled) return options;

		const isTop = this.settings.position.startsWith("top");
		const template = this.buildTemplate();
		const emptyTemplate = "<span></span>";

		return {
			...options,
			displayHeaderFooter: true,
			headerTemplate: isTop
				? template
				: options.headerTemplate ?? emptyTemplate,
			footerTemplate: isTop
				? options.footerTemplate ?? emptyTemplate
				: template,
			margins: this.ensureMarginSpace(
				options.margins,
				isTop ? "top" : "bottom"
			),
		};
	}

	private ensureMarginSpace(
		margins: any,
		requiredEdge: "top" | "bottom"
	) {
		if (!margins) return margins;

		const marginType = margins.marginType;
		const hasNoMargins =
			marginType === "none" || marginType === 0 || marginType === "0";
		const isCustomMargin =
			marginType === "custom" ||
			marginType === 2 ||
			marginType === 3 ||
			marginType === "2" ||
			marginType === "3";

		if (hasNoMargins) {
			return {
				marginType: "custom",
				top: requiredEdge === "top" ? 0.3 : 0.1,
				bottom: requiredEdge === "bottom" ? 0.3 : 0.1,
				left: 0.1,
				right: 0.1,
			};
		}

		if (!isCustomMargin) return margins;

		const nextMargins = { ...margins };
		nextMargins[requiredEdge] = Math.max(
			Number(nextMargins[requiredEdge] ?? 0),
			0.3
		);
		return nextMargins;
	}

	private patchWebviewsIn(root: ParentNode | null) {
		if (!root) return;

		if (root instanceof HTMLElement && root.tagName === "WEBVIEW") {
			this.patchWebview(root as unknown as PrintToPdfTarget);
		}

		const webviews = root.querySelectorAll?.("webview") ?? [];
		for (const webview of Array.from(webviews)) {
			this.patchWebview(webview as unknown as PrintToPdfTarget);
		}
	}

	private patchWebview(webview: PrintToPdfTarget | null | undefined) {
		if (!webview) return;
		if (typeof webview.printToPDF === "function") {
			this.patchPrintTarget(webview);
			return;
		}

		if (webview[WEBVIEW_READY_HANDLER]) return;

		const handleReady = () => {
			if (typeof webview.printToPDF !== "function") return;
			this.patchPrintTarget(webview);
			webview.removeEventListener?.("dom-ready", handleReady);
			delete webview[WEBVIEW_READY_HANDLER];
		};

		webview[WEBVIEW_READY_HANDLER] = handleReady;
		webview.addEventListener?.("dom-ready", handleReady, {
			once: true,
		});
		window.setTimeout(handleReady, 0);
	}

	private observeWebviews() {
		const body = document.body;
		if (!body) return;

		this.webviewObserver = new MutationObserver((mutations) => {
			for (const mutation of Array.from(mutations)) {
				for (const node of Array.from(mutation.addedNodes)) {
					if (node instanceof HTMLElement) {
						this.patchWebviewsIn(node);
					}
				}
			}
		});

		this.webviewObserver.observe(body, {
			childList: true,
			subtree: true,
		});

		this.register(() => {
			this.webviewObserver?.disconnect();
			this.webviewObserver = null;
		});
	}

	private observeExportDialogs() {
		const body = document.body;
		if (!body) return;

		this.injectExportDialogToggle(body);
		this.exportDialogObserver = new MutationObserver((mutations) => {
			for (const mutation of Array.from(mutations)) {
				for (const node of Array.from(mutation.addedNodes)) {
					if (node instanceof HTMLElement) {
						this.injectExportDialogToggle(node);
					}
				}
			}
		});

		this.exportDialogObserver.observe(body, {
			childList: true,
			subtree: true,
		});

		this.register(() => {
			this.exportDialogObserver?.disconnect();
			this.exportDialogObserver = null;
		});
	}

	private injectExportDialogToggle(root: ParentNode) {
		const modals = new Set<HTMLElement>();
		if (root instanceof HTMLElement && root.matches(".modal, .modal-container")) {
			modals.add(root);
		}
		const modalNodes =
			root.querySelectorAll?.(".modal, .modal-container") ?? [];
		for (const modal of Array.from(modalNodes)) {
			if (modal instanceof HTMLElement) {
				modals.add(modal);
			}
		}

		for (const modal of modals) {
			if (!this.isPdfExportDialog(modal)) continue;
			if (modal.querySelector(".pdf-page-numbers-export-setting")) continue;

			const contentEl =
				modal.querySelector(".modal-content") ??
				modal.querySelector(".modal") ??
				modal;
			const settingHost = document.createElement("div");
			settingHost.className = "pdf-page-numbers-export-setting";

			const footerEl = contentEl.querySelector(
				".modal-button-container, .modal-footer"
			);
			contentEl.insertBefore(settingHost, footerEl ?? null);

			new PdfPageNumbersSettingTab(this.app, this).displayExportToggle(
				settingHost
			);
		}
	}

	private isPdfExportDialog(modal: HTMLElement) {
		const title =
			modal.querySelector(".modal-title")?.textContent?.toLowerCase() ?? "";
		const text = modal.textContent?.toLowerCase() ?? "";

		if (title.includes("export to pdf")) return true;

		const exportButton = Array.from(
			modal.querySelectorAll("button")
		).some((button) =>
			/export|save/i.test(button.textContent ?? "")
		);
		const markers = [
			"page size",
			"margins",
			"landscape",
			"scale",
			"page numbers",
		].filter((marker) => text.includes(marker)).length;

		return text.includes("pdf") && exportButton && markers >= 2;
	}

	private restorePrintToPDF() {
		for (const target of this.patchedTargets) {
			if (target[ORIGINAL_PRINT_TO_PDF]) {
				if (typeof target.printToPDF === "function") {
					target.printToPDF =
						target[ORIGINAL_PRINT_TO_PDF] as typeof target.printToPDF;
				} else if ("send" in target) {
					(target as any).send = target[ORIGINAL_PRINT_TO_PDF];
				}
				delete target[ORIGINAL_PRINT_TO_PDF];
			}

			if (target[WEBVIEW_READY_HANDLER]) {
				target.removeEventListener?.(
					"dom-ready",
					target[WEBVIEW_READY_HANDLER]!
				);
				delete target[WEBVIEW_READY_HANDLER];
			}
		}

		this.patchedTargets.clear();
	}
}

/**
 * Try to get Electron's remote module via multiple access patterns.
 * Obsidian re-enables the remote module for plugin compatibility.
 */
function getElectronRemote(): any {
	try {
		// Primary: electron.remote (Electron < 14 or with remote enabled)
		const electron = require("electron");
		if (electron.remote) return electron.remote;
	} catch {
		// ignore
	}

	try {
		// Fallback: @electron/remote (Electron 14+)
		return require("@electron/remote");
	} catch {
		// ignore
	}

	return null;
}
