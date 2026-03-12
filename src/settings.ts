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

		new Setting(containerEl)
			.setName("PDF page numbers")
			.setHeading();

		new Setting(containerEl)
			.setName("Enable page numbers")
			.setDesc(
				"Add page numbers when exporting to PDF. Ensure your PDF export margins are large enough for the numbers to be visible."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enabled)
					.onChange(async (value) => {
						this.plugin.settings.enabled = value;
						await this.plugin.saveSettings();
					})
			);

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

		new Setting(containerEl).setName("Appearance").setHeading();

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
			.setDesc("CSS font family for page numbers")
			.addText((text) =>
				text
					.setPlaceholder("sans-serif")
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
			.setName("Side margin")
			.setDesc(
				"Horizontal padding in pixels for left or right positions"
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

		new Setting(containerEl).setDesc(
			"When exporting to PDF, set sufficient page margins in the export dialog so the page numbers have room to display."
		);
	}
}
