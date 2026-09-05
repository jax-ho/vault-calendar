import { Modal, Notice, Setting, setIcon } from 'obsidian';
import {
	copyCalendarConfig,
	copyCalendarPropertyDefinition,
} from '../domain/calendar-copy';
import {
	addCalendarProperty,
	clearInvalidBoardGroupReferences,
	updateCalendarProperty,
	validatePropertyName,
} from '../domain/property-schema';
import { isWritableBoardGroupProperty } from '../domain/saved-views';
import type CalendarViewPlugin from '../main';
import type {
	CalendarPropertyMutation,
	CalendarSharedConfigField,
} from '../services/calendar-document';
import type { CalendarConfig, CalendarPropertyDefinition } from '../types';
import { PropertyEditorModal } from './property-editor-modal';
import { renderPropertyManager } from './property-manager';
import { applyUiLocale } from './ui-locale';

export type CalendarSettingsSectionId =
	| 'calendar'
	| 'fields'
	| 'properties'
	| 'view';

interface SettingsSectionDefinition {
	id: CalendarSettingsSectionId;
	label: string;
	icon: string;
	description: string;
	render: (container: HTMLElement) => void;
}

export class CalendarSettingsModal extends Modal {
	private draft: CalendarConfig;
	private saveTimer?: number;
	private saveQueue: Promise<void> = Promise.resolve();
	private errorEl?: HTMLElement;
	private propertyManagerEl?: HTMLElement;
	private activeSection: CalendarSettingsSectionId;
	private readonly dirtyFields = new Set<CalendarSharedConfigField>();
	private readonly propertyMutations: CalendarPropertyMutation[] = [];
	private readonly revalidateBoardGroups = new Set<string>();

	constructor(
		private readonly plugin: CalendarViewPlugin,
		config: CalendarConfig,
		private readonly onApplied: (config: CalendarConfig) => Promise<void>,
		initialSection: CalendarSettingsSectionId = 'calendar',
	) {
		super(plugin.app);
		this.draft = copyCalendarConfig(config);
		this.activeSection = initialSection;
	}

	onOpen(): void {
		applyUiLocale(this.modalEl);
		this.setTitle('Calendar settings');
		this.modalEl.addClass('cv-settings-modal');
		this.contentEl.addClass('cv-settings-content');
		this.errorEl = this.contentEl.createDiv({ cls: 'cv-form-error' });
		const dateProperties = this.plugin.documents.discoverDateProperties(this.draft);
		const layout = this.contentEl.createDiv({ cls: 'cv-settings-layout' });
		const navigation = layout.createDiv({ cls: 'cv-settings-nav' });
		navigation.setAttribute('role', 'tablist');
		navigation.setAttribute('aria-label', 'Calendar settings sections');
		const pane = layout.createDiv({ cls: 'cv-settings-pane' });
		const sections: SettingsSectionDefinition[] = [
			{
				id: 'calendar',
				label: 'Calendar',
				icon: 'calendar-days',
				description: 'Choose the calendar name and which notes are included.',
				render: (container) => {
					this.renderCalendarSettings(container);
					this.renderExcludedPathsSetting(container);
				},
			},
			{
				id: 'fields',
				label: 'Event fields',
				icon: 'calendar-range',
				description: 'Map Markdown properties to the fields the calendar uses.',
				render: (container) => this.renderFieldSettings(container, dateProperties),
			},
			{
				id: 'properties',
				label: 'Properties',
				icon: 'list-tree',
				description: 'Create reusable fields and control what appears on event cards.',
				render: (container) => this.renderPropertySettings(container),
			},
			{
				id: 'view',
				label: 'View',
				icon: 'layout-grid',
				description: 'Choose how event notes open from any saved view.',
				render: (container) => this.renderViewSettings(container),
			},
		];

		for (const definition of sections) {
			this.createNavigationButton(navigation, layout, definition);
			const group = this.createSettingsSection(pane, definition);
			definition.render(group);
		}
		this.activateSection(layout, this.activeSection);
	}

	private createSettingsSection(
		parent: HTMLElement,
		definition: SettingsSectionDefinition,
	): HTMLElement {
		const section = parent.createDiv({ cls: 'cv-settings-section' });
		section.dataset.section = definition.id;
		section.id = `cv-settings-section-${definition.id}`;
		section.setAttribute('role', 'tabpanel');
		const header = section.createDiv({ cls: 'cv-settings-section-header' });
		const heading = header.createEl('h3', { text: definition.label });
		heading.id = `cv-settings-heading-${definition.id}`;
		section.setAttribute('aria-labelledby', heading.id);
		header.createEl('p', { text: definition.description });
		return section.createDiv({
			cls: ['cv-settings-group', definition.id === 'properties' ? 'cv-property-manager' : '']
				.filter(Boolean)
				.join(' '),
		});
	}

	private createNavigationButton(
		parent: HTMLElement,
		layout: HTMLElement,
		definition: SettingsSectionDefinition,
	): void {
		const button = parent.createEl('button', {
			cls: 'cv-settings-nav-item',
			attr: {
				type: 'button',
				role: 'tab',
				'aria-controls': `cv-settings-section-${definition.id}`,
			},
		});
		button.dataset.section = definition.id;
		const icon = button.createSpan({ cls: 'cv-settings-nav-icon' });
		setIcon(icon, definition.icon);
		button.createSpan({ text: definition.label });
		button.addEventListener('click', () => {
			this.activeSection = definition.id;
			this.activateSection(layout, definition.id);
		});
		button.addEventListener('keydown', (event) => {
			if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
			event.preventDefault();
			const buttons = Array.from(parent.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
			const current = buttons.indexOf(button);
			let next = current;
			if (event.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length;
			if (event.key === 'ArrowDown') next = (current + 1) % buttons.length;
			if (event.key === 'Home') next = 0;
			if (event.key === 'End') next = buttons.length - 1;
			buttons[next]?.click();
			buttons[next]?.focus();
		});
	}

	private activateSection(
		layout: HTMLElement,
		active: CalendarSettingsSectionId,
	): void {
		for (const button of layout.querySelectorAll<HTMLElement>('.cv-settings-nav-item')) {
			const selected = button.dataset.section === active;
			button.toggleClass('is-active', selected);
			button.setAttribute('aria-selected', String(selected));
			button.tabIndex = selected ? 0 : -1;
		}
		for (const section of layout.querySelectorAll<HTMLElement>('.cv-settings-section')) {
			section.hidden = section.dataset.section !== active;
		}
		layout.querySelector<HTMLElement>('.cv-settings-pane')?.scrollTo({ top: 0 });
	}

	private renderCalendarSettings(container: HTMLElement): void {
		new Setting(container).setName('Name').addText((text) => {
			text.setValue(this.draft.name).onChange((value) => {
				this.draft.name = value.trim() || this.draft.name;
				this.queueSave('name');
			});
		});
		new Setting(container)
			.setName('Include subfolders')
			.setDesc('Index Markdown notes in nested folders.')
			.addToggle((toggle) => {
				toggle.setValue(this.draft.recursive).onChange((value) => {
					this.draft.recursive = value;
					this.queueSave('recursive');
				});
			});
	}

	private renderFieldSettings(container: HTMLElement, dateProperties: string[]): void {
		new Setting(container)
			.setName('Show calendar by')
			.setDesc(
				dateProperties.length > 0
					? `Detected date properties: ${dateProperties.join(', ')}`
					: 'Enter the frontmatter property containing the start date.',
			)
			.addText((text) => {
				text.setValue(this.draft.startDateProperty).onChange((value) => {
					const property = value.trim();
					const next = { ...this.draft, startDateProperty: property };
					this.setDraft(
						isWritableBoardGroupProperty(this.draft, property)
							? clearInvalidBoardGroupReferences(next, [property])
							: next,
					);
					if (property) this.revalidateBoardGroups.add(property);
					this.queueSave('startDateProperty');
				});
			});
		new Setting(container)
			.setName('End date property')
			.setDesc('Leave empty to disable range resizing.')
			.addText((text) => {
				text.setValue(this.draft.endDateProperty ?? '').onChange((value) => {
					const trimmed = value.trim();
					const shouldClear = isWritableBoardGroupProperty(this.draft, trimmed);
					const next = { ...this.draft };
					if (trimmed) next.endDateProperty = trimmed;
					else delete next.endDateProperty;
					this.setDraft(
						shouldClear
							? clearInvalidBoardGroupReferences(next, [trimmed])
							: next,
					);
					if (trimmed) this.revalidateBoardGroups.add(trimmed);
					this.queueSave('endDateProperty');
				});
			});
	}

	private renderPropertySettings(container: HTMLElement): void {
		this.propertyManagerEl = container;
		this.renderProperties();
	}

	private renderViewSettings(container: HTMLElement): void {
		new Setting(container).setName('Open behavior').addDropdown((dropdown) => {
			dropdown
				.addOption('same-leaf', 'Same leaf')
				.addOption('new-tab', 'New tab')
				.setValue(this.draft.openBehavior)
				.onChange((value) => {
					this.draft.openBehavior = value as CalendarConfig['openBehavior'];
					this.queueSave('openBehavior');
				});
		});
	}

	private renderExcludedPathsSetting(container: HTMLElement): void {
		new Setting(container)
			.setClass('cv-settings-textarea-row')
			.setName('Excluded paths')
			.setDesc('Comma-separated files or folders inside the vault.')
			.addTextArea((text) => {
				text.setValue(this.draft.excludePaths.join(', ')).onChange((value) => {
					this.draft.excludePaths = value
						.split(/[\n,]/u)
						.map((path) => path.trim())
						.filter(Boolean);
					this.queueSave('excludePaths');
				});
			});
	}

	private renderProperties(): void {
		if (!this.propertyManagerEl) return;
		renderPropertyManager(this.propertyManagerEl, this.draft, {
			onAdd: () => this.openPropertyEditor(),
			onEdit: (property) => this.openPropertyEditor(property),
			onChange: (config, mutation) => {
				this.setDraft(config);
				this.queuePropertyMutation(mutation);
				this.renderProperties();
			},
		});
	}

	private openPropertyEditor(property?: string): void {
		new PropertyEditorModal(
			this.app,
			this.draft.propertyDefinitions,
			property,
			(name, definition) => this.applyPropertyEdit(property, name, definition),
		).open();
	}

	private async applyPropertyEdit(
		currentName: string | undefined,
		name: string,
		definition: CalendarPropertyDefinition,
	): Promise<void> {
		if (currentName && currentName !== name) {
			if (this.saveTimer !== undefined) {
				window.clearTimeout(this.saveTimer);
				this.saveTimer = undefined;
			}
			await this.commit();
			if (this.hasPendingChanges()) return;
			const nextConfig = await this.plugin.propertyMigration.rename(
				this.draft,
				currentName,
				name,
				definition,
			);
			this.draft = copyCalendarConfig(nextConfig);
			this.renderProperties();
			try {
				await this.onApplied(nextConfig);
				this.errorEl?.empty();
			} catch (error) {
				this.reportError(error, 'Property was renamed, but the calendar could not refresh.');
			}
			return;
		}

		let next: CalendarConfig;
		let mutation: CalendarPropertyMutation;
		if (currentName) {
			const expectedDefinition = this.draft.propertyDefinitions[currentName];
			if (!expectedDefinition) throw new Error(`Property not found: ${currentName}`);
			next = updateCalendarProperty(this.draft, currentName, definition);
			mutation = {
				kind: 'update',
				property: currentName,
				expectedDefinition: copyCalendarPropertyDefinition(expectedDefinition),
				definition: copyCalendarPropertyDefinition(definition),
			};
		} else {
			const property = validatePropertyName(this.draft.propertyDefinitions, name);
			next = addCalendarProperty(this.draft, property, definition);
			mutation = {
				kind: 'add',
				property,
				definition: copyCalendarPropertyDefinition(definition),
			};
		}
		this.setDraft(next);
		this.queuePropertyMutation(mutation);
		this.renderProperties();
	}

	onClose(): void {
		if (this.saveTimer !== undefined) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = undefined;
		}
		// Queue one final drain behind any in-flight save. If that save fails, its
		// dirty fields are restored before this drain takes its snapshot.
		void this.commit();
		this.contentEl.empty();
	}

	private queueSave(...fields: CalendarSharedConfigField[]): void {
		for (const field of fields) this.dirtyFields.add(field);
		this.scheduleSave();
	}

	private queuePropertyMutation(mutation: CalendarPropertyMutation): void {
		this.propertyMutations.push(mutation);
		this.scheduleSave();
	}

	private scheduleSave(): void {
		if (this.saveTimer !== undefined) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = undefined;
			void this.commit();
		}, 350);
	}

	private setDraft(next: CalendarConfig): void {
		this.draft = copyCalendarConfig(next);
	}

	private hasPendingChanges(): boolean {
		return (
			this.dirtyFields.size > 0 ||
			this.propertyMutations.length > 0 ||
			this.revalidateBoardGroups.size > 0
		);
	}

	private async commit(): Promise<void> {
		this.saveQueue = this.saveQueue.then(async () => {
			if (!this.hasPendingChanges()) return;
			const snapshot = copyCalendarConfig(this.draft);
			const changedFields = [...this.dirtyFields];
			this.dirtyFields.clear();
			const propertyMutations = this.propertyMutations.splice(0);
			const revalidateBoardGroups = [...this.revalidateBoardGroups];
			this.revalidateBoardGroups.clear();
			try {
				if (!snapshot.startDateProperty) throw new Error('Start date property cannot be empty.');
				const committed = await this.plugin.documents.save(snapshot, {
					changedFields,
					propertyMutations,
					revalidateBoardGroups,
				});
				await this.onApplied(committed);
				this.errorEl?.empty();
			} catch (error) {
				for (const field of changedFields) this.dirtyFields.add(field);
				this.propertyMutations.unshift(...propertyMutations);
				for (const property of revalidateBoardGroups) {
					this.revalidateBoardGroups.add(property);
				}
				this.reportError(error, 'Unable to save settings.');
			}
		});
		await this.saveQueue;
	}

	private reportError(error: unknown, fallback: string): void {
		const message = error instanceof Error ? error.message : fallback;
		this.errorEl?.setText(message);
		new Notice(message);
	}
}
