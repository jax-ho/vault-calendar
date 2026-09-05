import { Modal, Notice, Setting } from 'obsidian';
import {
	preferredBoardGroupProperty,
	preferredCalendarWeekStart,
	suggestSavedViewName,
	writableBoardGroupProperties,
} from '../domain/saved-view-form';
import type CalendarViewPlugin from '../main';
import type {
	BoardSavedView,
	CalendarConfig,
	CalendarLayout,
	CalendarSavedView,
	SavedView,
	SavedViewCatalog,
	SavedViewType,
	WeekStartsOn,
} from '../types';
import { applyUiLocale } from './ui-locale';

type CatalogSaved = (
	catalog: SavedViewCatalog,
	viewId: string,
) => Promise<void> | void;

function generatedViewId(ownerWindow: Window | null): string {
	const uuid = ownerWindow?.crypto.randomUUID?.();
	if (!uuid) throw new Error('Unable to generate a saved-view ID.');
	return uuid.toLocaleLowerCase();
}

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

function catalogContainsName(
	catalog: SavedViewCatalog,
	name: string,
	exceptId?: string,
): boolean {
	const candidate = name.trim().toLocaleLowerCase();
	return catalog.entries.some((entry) => {
		const id = entry.kind === 'valid' ? entry.definition.id : entry.id;
		if (id === exceptId) return false;
		const current = entry.kind === 'valid' ? entry.definition.name : entry.name;
		return current?.trim().toLocaleLowerCase() === candidate;
	});
}

export class AddSavedViewModal extends Modal {
	private type: SavedViewType = 'calendar';
	private name: string;
	private nameWasEdited = false;
	private layout: CalendarLayout = 'month';
	private weekStartsOn: WeekStartsOn;
	private groupBy?: string;
	private saving = false;

	constructor(
		private readonly plugin: CalendarViewPlugin,
		private readonly config: CalendarConfig,
		private readonly catalog: SavedViewCatalog,
		activeViewId: string | undefined,
		private readonly onSaved: CatalogSaved,
		private readonly openProperties: () => void,
		private readonly idFactory: (ownerWindow: Window | null) => string = generatedViewId,
	) {
		super(plugin.app);
		this.name = suggestSavedViewName(catalog, this.type);
		this.weekStartsOn = preferredCalendarWeekStart(catalog, activeViewId);
		this.groupBy = preferredBoardGroupProperty(config);
	}

	onOpen(): void {
		applyUiLocale(this.modalEl);
		this.modalEl.addClass('cv-saved-view-modal');
		this.renderForm();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderForm(): void {
		this.setTitle('Add view');
		this.contentEl.empty();

		new Setting(this.contentEl).setName('View type').addDropdown((dropdown) => {
			dropdown
				.addOption('calendar', 'Calendar')
				.addOption('board', 'Board')
				.setValue(this.type)
				.onChange((value) => {
					this.type = value === 'board' ? 'board' : 'calendar';
					if (!this.nameWasEdited) {
						this.name = suggestSavedViewName(this.catalog, this.type);
					}
					this.renderForm();
				});
		});

		new Setting(this.contentEl).setName('Name').addText((text) => {
			text.setValue(this.name).onChange((value) => {
				this.name = value;
				this.nameWasEdited = true;
			});
			text.inputEl.focus();
		});

		if (this.type === 'calendar') this.renderCalendarFields();
		else this.renderBoardFields();

		const errorEl = this.contentEl.createDiv({ cls: 'cv-form-error' });
		const actions = this.contentEl.createDiv({ cls: 'cv-saved-view-actions' });
		const cancel = actions.createEl('button', {
			text: 'Cancel',
			attr: { type: 'button' },
		});
		cancel.addEventListener('click', () => this.close());
		const create = actions.createEl('button', {
			text: 'Create',
			attr: { type: 'button' },
		});
		create.addClass('mod-cta');
		create.disabled = this.type === 'board' && !this.groupBy;
		create.addEventListener('click', () => void this.create(errorEl, create));
	}

	private renderCalendarFields(): void {
		new Setting(this.contentEl).setName('Layout').addDropdown((dropdown) => {
			dropdown
				.addOption('month', 'Month')
				.addOption('week', 'Week')
				.setValue(this.layout)
				.onChange((value) => {
					this.layout = value === 'week' ? 'week' : 'month';
				});
		});
		new Setting(this.contentEl).setName('Week starts on').addDropdown((dropdown) => {
			dropdown
				.addOption('locale', 'Locale default')
				.addOption('monday', 'Monday')
				.addOption('sunday', 'Sunday')
				.setValue(this.weekStartsOn)
				.onChange((value) => {
					this.weekStartsOn = value as WeekStartsOn;
				});
		});
	}

	private renderBoardFields(): void {
		const properties = writableBoardGroupProperties(this.config);
		if (properties.length === 0) {
			const setting = new Setting(this.contentEl)
				.setName('Group by')
				.setDesc('Add a select property first.');
			setting.addButton((button) => {
				button.setButtonText('Open properties').onClick(() => {
					this.close();
					this.openProperties();
				});
			});
			return;
		}
		if (!this.groupBy || !properties.includes(this.groupBy)) {
			this.groupBy = properties[0];
		}
		new Setting(this.contentEl)
			.setName('Group by')
			.setDesc('Create one column for each select option.')
			.addDropdown((dropdown) => {
				for (const property of properties) dropdown.addOption(property, property);
				dropdown.setValue(this.groupBy ?? '').onChange((value) => {
					this.groupBy = value;
				});
			});
	}

	private async create(errorEl: HTMLElement, button: HTMLButtonElement): Promise<void> {
		if (this.saving) return;
		errorEl.empty();
		const name = this.name.trim();
		if (!name) {
			errorEl.setText('Enter a view name.');
			return;
		}
		if (catalogContainsName(this.catalog, name)) {
			errorEl.setText(`A view named “${name}” already exists.`);
			return;
		}
		if (this.type === 'board' && !this.groupBy) {
			errorEl.setText('Choose a select property for the board.');
			return;
		}

		const id = this.idFactory(this.contentEl.ownerDocument.defaultView);
		const view: SavedView =
			this.type === 'calendar'
				? {
						id,
						name,
						type: 'calendar',
						layout: this.layout,
						weekStartsOn: this.weekStartsOn,
					}
				: { id, name, type: 'board', groupBy: this.groupBy };

		this.saving = true;
		button.disabled = true;
		try {
			const next = await this.plugin.savedViews.commit(this.config.documentPath, {
				kind: 'add',
				view,
			});
			await this.onSaved(next, id);
			this.close();
		} catch (error) {
			const message = errorMessage(error, 'Unable to create view.');
			errorEl.setText(message);
			new Notice(message);
		} finally {
			this.saving = false;
			button.disabled = this.type === 'board' && !this.groupBy;
		}
	}
}

export class EditSavedViewModal extends Modal {
	private layout: CalendarLayout;
	private weekStartsOn: WeekStartsOn;
	private groupBy?: string;
	private saving = false;

	constructor(
		private readonly plugin: CalendarViewPlugin,
		private readonly config: CalendarConfig,
		private readonly view: CalendarSavedView | BoardSavedView,
		private readonly onSaved: CatalogSaved,
	) {
		super(plugin.app);
		this.layout = view.type === 'calendar' ? view.layout : 'month';
		this.weekStartsOn = view.type === 'calendar' ? view.weekStartsOn : 'locale';
		this.groupBy = view.type === 'board' ? view.groupBy : undefined;
	}

	onOpen(): void {
		applyUiLocale(this.modalEl);
		this.modalEl.addClass('cv-saved-view-modal');
		this.setTitle(`Edit ${this.view.name}`);
		if (this.view.type === 'calendar') this.renderCalendarFields();
		else this.renderBoardFields();
		const errorEl = this.contentEl.createDiv({ cls: 'cv-form-error' });
		const actions = this.contentEl.createDiv({ cls: 'cv-saved-view-actions' });
		const cancel = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
		cancel.addEventListener('click', () => this.close());
		const save = actions.createEl('button', { text: 'Save', attr: { type: 'button' } });
		save.addClass('mod-cta');
		save.disabled = this.view.type === 'board' && !this.groupBy;
		save.addEventListener('click', () => void this.save(errorEl, save));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderCalendarFields(): void {
		new Setting(this.contentEl).setName('Layout').addDropdown((dropdown) => {
			dropdown
				.addOption('month', 'Month')
				.addOption('week', 'Week')
				.setValue(this.layout)
				.onChange((value) => {
					this.layout = value === 'week' ? 'week' : 'month';
				});
		});
		new Setting(this.contentEl).setName('Week starts on').addDropdown((dropdown) => {
			dropdown
				.addOption('locale', 'Locale default')
				.addOption('monday', 'Monday')
				.addOption('sunday', 'Sunday')
				.setValue(this.weekStartsOn)
				.onChange((value) => {
					this.weekStartsOn = value as WeekStartsOn;
				});
		});
	}

	private renderBoardFields(): void {
		const properties = writableBoardGroupProperties(this.config);
		new Setting(this.contentEl)
			.setName('Group by')
			.setDesc(
				properties.length > 0
					? 'Create one column for each select option.'
					: 'Add a select property in Calendar settings first.',
			)
			.addDropdown((dropdown) => {
				dropdown.addOption('', 'Choose a select property');
				for (const property of properties) dropdown.addOption(property, property);
				dropdown.setValue(this.groupBy ?? '').onChange((value) => {
					this.groupBy = value || undefined;
				});
			});
	}

	private async save(errorEl: HTMLElement, button: HTMLButtonElement): Promise<void> {
		if (this.saving) return;
		errorEl.empty();
		if (this.view.type === 'board' && !this.groupBy) {
			errorEl.setText('Choose a select property for the board.');
			return;
		}
		this.saving = true;
		button.disabled = true;
		try {
			const command =
				this.view.type === 'calendar'
					? {
							kind: 'configure-calendar' as const,
							viewId: this.view.id,
							layout: this.layout,
							weekStartsOn: this.weekStartsOn,
						}
					: {
							kind: 'configure-board' as const,
							viewId: this.view.id,
							groupBy: this.groupBy,
						};
			const catalog = await this.plugin.savedViews.commit(
				this.config.documentPath,
				command,
			);
			await this.onSaved(catalog, this.view.id);
			this.close();
		} catch (error) {
			const message = errorMessage(error, 'Unable to update view.');
			errorEl.setText(message);
			new Notice(message);
		} finally {
			this.saving = false;
			button.disabled = this.view.type === 'board' && !this.groupBy;
		}
	}
}

export class RenameSavedViewModal extends Modal {
	private name: string;
	private saving = false;

	constructor(
		private readonly plugin: CalendarViewPlugin,
		private readonly documentPath: string,
		private readonly catalog: SavedViewCatalog,
		private readonly view: SavedView,
		private readonly onSaved: CatalogSaved,
	) {
		super(plugin.app);
		this.name = view.name;
	}

	onOpen(): void {
		applyUiLocale(this.modalEl);
		this.modalEl.addClass('cv-saved-view-modal');
		this.setTitle('Rename view');
		const errorEl = this.contentEl.createDiv({ cls: 'cv-form-error' });
		let saveButton: HTMLButtonElement | undefined;
		new Setting(this.contentEl).setName('Name').addText((text) => {
			text.setValue(this.name).onChange((value) => {
				this.name = value;
				errorEl.empty();
			});
			text.inputEl.addEventListener('keydown', (event) => {
				if (event.key !== 'Enter' || event.isComposing || !saveButton) return;
				event.preventDefault();
				void this.save(errorEl, saveButton);
			});
			text.inputEl.focus();
			text.inputEl.select();
		});
		const actions = this.contentEl.createDiv({ cls: 'cv-saved-view-actions' });
		const cancel = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
		cancel.addEventListener('click', () => this.close());
		saveButton = actions.createEl('button', { text: 'Save', attr: { type: 'button' } });
		saveButton.addClass('mod-cta');
		saveButton.addEventListener('click', () => void this.save(errorEl, saveButton));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async save(errorEl: HTMLElement, button: HTMLButtonElement): Promise<void> {
		if (this.saving) return;
		errorEl.empty();
		const name = this.name.trim();
		if (!name) {
			errorEl.setText('Enter a view name.');
			return;
		}
		if (catalogContainsName(this.catalog, name, this.view.id)) {
			errorEl.setText(`A view named “${name}” already exists.`);
			return;
		}
		this.saving = true;
		button.disabled = true;
		try {
			const catalog = await this.plugin.savedViews.commit(this.documentPath, {
				kind: 'rename',
				viewId: this.view.id,
				name,
			});
			await this.onSaved(catalog, this.view.id);
			this.close();
		} catch (error) {
			const message = errorMessage(error, 'Unable to rename view.');
			errorEl.setText(message);
			new Notice(message);
		} finally {
			this.saving = false;
			button.disabled = false;
		}
	}
}

export class DeleteSavedViewModal extends Modal {
	private deleting = false;

	constructor(
		private readonly plugin: CalendarViewPlugin,
		private readonly documentPath: string,
		private readonly view: SavedView,
		private readonly onSaved: CatalogSaved,
	) {
		super(plugin.app);
	}

	onOpen(): void {
		applyUiLocale(this.modalEl);
		this.modalEl.addClass('cv-saved-view-modal');
		this.setTitle(`Delete “${this.view.name}”?`);
		this.contentEl.createEl('p', {
			text: 'This removes only the view. Event notes will not be deleted.',
		});
		const errorEl = this.contentEl.createDiv({ cls: 'cv-form-error' });
		const actions = this.contentEl.createDiv({ cls: 'cv-saved-view-actions' });
		const cancel = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
		cancel.addEventListener('click', () => this.close());
		const remove = actions.createEl('button', {
			text: 'Delete view',
			attr: { type: 'button' },
		});
		remove.addClass('mod-warning');
		remove.addEventListener('click', () => void this.remove(errorEl, remove));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async remove(errorEl: HTMLElement, button: HTMLButtonElement): Promise<void> {
		if (this.deleting) return;
		this.deleting = true;
		button.disabled = true;
		try {
			const catalog = await this.plugin.savedViews.commit(this.documentPath, {
				kind: 'remove',
				viewId: this.view.id,
			});
			await this.onSaved(catalog, this.view.id);
			this.close();
		} catch (error) {
			const message = errorMessage(error, 'Unable to delete view.');
			errorEl.setText(message);
			new Notice(message);
		} finally {
			this.deleting = false;
			button.disabled = false;
		}
	}
}
