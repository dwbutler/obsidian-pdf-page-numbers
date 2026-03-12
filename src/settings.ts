import { App, PluginSettingTab, Setting } from "obsidian";
import type PdfPageNumbersPlugin from "./main";

export type PageNumberPosition =
	| "bottom-center"
	| "bottom-left"
	| "bottom-right"
	| "top-center"
	| "top-left"
	| "top-right";
export type PageNumberFormat = "page-only" | "page-of-total" | "custom";

export interface PdfPageNumbersSettings {
	enabled: boolean;
	position: PageNumberPosition;
	format: PageNumberFormat;
	customFormat: string;
	fontSize: number;
	fontFamily: string;
	marginBottom: number;
	marginTop: number;
	marginSide: number;
	skipFirstPage: boolean;
	color: string;
}

export const DEFAULT_SETTINGS: PdfPageNumbersSettings = {
	enabled: true,
	position: "bottom-center",
	format: "page-of-total",
	customFormat: "Page {{page}} of {{total}}",
	fontSize: 10,
	fontFamily: "sans-serif",
	marginBottom: 20,
	marginTop: 20,
	marginSide: 20,
	skipFirstPage: false,
	color: "#666666",
};

export class PdfPageNumbersSettingTab extends PluginSettingTab {
	plugin: PdfPageNumbersPlugin;

	constructor(app: App, plugin: PdfPageNumbersPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Page numbers").setHeading();

		this.displayExportToggle(containerEl);

		new Setting(containerEl)
			.setName("Position")
			.setDesc("Where to place page numbers on the page")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("bottom-center", "Bottom center")
					.addOption("bottom-left", "Bottom left")
					.addOption("bottom-right", "Bottom right")
					.addOption("top-center", "Top center")
					.addOption("top-left", "Top left")
					.addOption("top-right", "Top right")
					.setValue(this.plugin.settings.position)
					.onChange(async (value) => {
						this.plugin.settings.position =
							value as PageNumberPosition;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Format")
			.setDesc("How to display the page number")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("page-only", "1")
					.addOption("page-of-total", "Page 1 of 5")
					.addOption("custom", "Custom format")
					.setValue(this.plugin.settings.format)
					.onChange(async (value) => {
						this.plugin.settings.format =
							value as PageNumberFormat;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (this.plugin.settings.format === "custom") {
			new Setting(containerEl)
				.setName("Custom format")
				.setDesc(
					"Use {{page}} for current page and {{total}} for total pages"
				)
				.addText((text) =>
					text
						.setPlaceholder("Page {{page}} of {{total}}")
						.setValue(this.plugin.settings.customFormat)
						.onChange(async (value) => {
							this.plugin.settings.customFormat = value;
							await this.plugin.saveSettings();
						})
				);
		}

		new Setting(containerEl)
			.setName("Font size")
			.setDesc("Font size in points")
			.addSlider((slider) =>
				slider
					.setLimits(6, 24, 1)
					.setValue(this.plugin.settings.fontSize)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.fontSize = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Font family")
			.setDesc("Font family for page numbers")
			.addText((text) =>
				text
					.setPlaceholder("Sans-serif")
					.setValue(this.plugin.settings.fontFamily)
					.onChange(async (value) => {
						this.plugin.settings.fontFamily =
							value || "sans-serif";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Color")
			.setDesc("Page number text color (hex)")
			.addText((text) =>
				text
					.setPlaceholder("#666666")
					.setValue(this.plugin.settings.color)
					.onChange(async (value) => {
						this.plugin.settings.color = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Skip first page")
			.setDesc("Don't show a page number on the first page")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.skipFirstPage)
					.onChange(async (value) => {
						this.plugin.settings.skipFirstPage = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Bottom margin")
			.setDesc("Distance from the bottom edge of the page")
			.addSlider((slider) =>
				slider
					.setLimits(0, 80, 1)
					.setValue(this.plugin.settings.marginBottom)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.marginBottom = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Top margin")
			.setDesc("Distance from the top edge of the page")
			.addSlider((slider) =>
				slider
					.setLimits(0, 80, 1)
					.setValue(this.plugin.settings.marginTop)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.marginTop = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Side margin")
			.setDesc(
				"Horizontal padding in pixels (for left/right positions)"
			)
			.addSlider((slider) =>
				slider
					.setLimits(0, 60, 1)
					.setValue(this.plugin.settings.marginSide)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.marginSide = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("p", {
			text: "When exporting to PDF, set enough page margins in the export dialog so the page numbers have room to display.",
			cls: "setting-item-description",
		});
	}

	displayExportToggle(containerEl: HTMLElement) {
		new Setting(containerEl)
			.setName("Enable page numbers")
			.setDesc("Add page numbers when exporting to PDF.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enabled)
					.onChange(async (value) => {
						this.plugin.settings.enabled = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
