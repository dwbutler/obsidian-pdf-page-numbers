/**
 * Minimal type declarations for Electron APIs used by this plugin.
 * The `electron` module is external (resolved at runtime by Obsidian).
 */
declare module "electron" {
	interface PrintToPDFOptions {
		displayHeaderFooter?: boolean;
		headerTemplate?: string;
		footerTemplate?: string;
		landscape?: boolean;
		printBackground?: boolean;
		scale?: number;
		pageRanges?: string;
		pageSize?: string | { width: number; height: number };
		margins?: {
			top?: number;
			bottom?: number;
			left?: number;
			right?: number;
		};
		preferCSSPageSize?: boolean;
	}

	interface WebContents {
		printToPDF(options: PrintToPDFOptions): Promise<Uint8Array>;
	}

	interface Remote {
		getCurrentWebContents(): WebContents | null;
	}

	export const remote: Remote | undefined;
}
