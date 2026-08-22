import { App, Modal, Setting, setIcon } from 'obsidian';
import {
	CALENDAR_COLORS,
	CALENDAR_COLOR_LABELS,
} from '../domain/calendar-colors';
import { copyCalendarPropertyDefinition } from '../domain/calendar-copy';
import {
	createPropertyDefinition,
	uniquePropertyName,
	validatePropertyName,
} from '../domain/property-schema';
import { propertyTypeLabel } from '../domain/property-type-icons';
import type {
	CalendarColor,
	CalendarPropertyDefinition,
	CalendarPropertyType,
} from '../types';
import { applyUiLocale } from './ui-locale';

interface SelectOptionDraft {
	id: string;
	name: string;
	color: CalendarColor;
}

type PropertyEditorSave = (
	name: string,
	definition: CalendarPropertyDefinition,
) => Promise<void> | void;

export class PropertyEditorModal extends Modal {
	private name: string;
	private definition: CalendarPropertyDefinition;
	private options: SelectOptionDraft[] = [];
	private defaultOptionId = '';
	private optionId = 0;
	private errorEl?: HTMLElement;
	private saveButton?: HTMLButtonElement;
	private saving = false;

	constructor(
		app: App,
		private readonly propertyDefinitions: Record<string, CalendarPropertyDefinition>,
		private readonly currentName: string | undefined,
		private readonly onSave: PropertyEditorSave,
	) {
		super(app);
		this.name = currentName ?? uniquePropertyName(propertyDefinitions);
		this.definition = currentName
			? copyCalendarPropertyDefinition(
				propertyDefinitions[currentName] ?? createPropertyDefinition('select'),
			)
			: createPropertyDefinition('select');
		this.resetSelectOptions();
	}

	onOpen(): void {
		applyUiLocale(this.modalEl);
		this.modalEl.addClass('cv-property-editor-modal');
		this.renderEditor();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderEditor(): void {
		this.setTitle(this.currentName ? 'Edit property' : 'New property');
		this.contentEl.empty();

		new Setting(this.contentEl).setName('Name').addText((text) => {
			text.setValue(this.name).onChange((value) => {
				this.name = value;
				this.errorEl?.empty();
			});
			text.inputEl.setAttribute('aria-label', 'Property name');
			text.inputEl.focus();
		});

		new Setting(this.contentEl).setName('Type').addDropdown((dropdown) => {
			for (const type of ['select', 'checkbox', 'text', 'number'] as const) {
				dropdown.addOption(type, propertyTypeLabel(type));
			}
			dropdown
				.setValue(this.definition.type)
				.onChange((value) => this.changeType(value as CalendarPropertyType));
		});

		if (this.definition.type === 'select') this.renderSelectEditor();
		else this.renderDefaultEditor();

		this.errorEl = this.contentEl.createDiv({ cls: 'cv-form-error' });
		const actions = this.contentEl.createDiv({ cls: 'cv-property-editor-actions' });
		const cancel = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
		cancel.addEventListener('click', () => this.close());
		this.saveButton = actions.createEl('button', {
			text: 'Save',
			attr: { type: 'button' },
		});
		this.saveButton.addEventListener('click', () => void this.save());
	}

	private renderSelectEditor(): void {
		const section = this.contentEl.createDiv({ cls: 'cv-property-options-section' });
		section.createEl('h3', { text: 'Options' });
		section.createEl('p', {
			cls: 'setting-item-description',
			text: 'Every select includes a required empty option. Set each option label and color here.',
		});
		const list = section.createDiv({ cls: 'cv-property-option-list' });
		for (const [index, option] of this.options.entries()) {
			this.renderSelectOption(list, option, index);
		}

		const add = section.createEl('button', {
			cls: 'cv-property-option-add',
			text: 'Add option',
			attr: { type: 'button' },
		});
		add.addEventListener('click', () => {
			this.options.push({
				id: this.nextOptionId(),
				name: this.uniqueOptionName(),
				color: 'default',
			});
			this.renderEditor();
		});

		new Setting(this.contentEl).setName('Default').addDropdown((dropdown) => {
			for (const option of this.options) dropdown.addOption(option.id, option.name);
			dropdown.setValue(this.defaultOptionId).onChange((id) => {
				this.defaultOptionId = id;
			});
		});
	}

	private renderSelectOption(
		container: HTMLElement,
		option: SelectOptionDraft,
		index: number,
	): void {
		const row = container.createDiv({ cls: 'cv-property-option-row' });
		const swatch = row.createSpan({ cls: 'cv-color-swatch cv-color-token' });
		swatch.dataset.color = option.color;

		const name = row.createEl('input', {
			type: 'text',
			attr: { 'aria-label': `Option ${index + 1} name` },
		});
		name.value = option.name;
		name.disabled = index === 0;
		name.addEventListener('input', () => {
			option.name = name.value;
			this.errorEl?.empty();
		});

		const color = row.createEl('select', {
			cls: 'dropdown cv-property-option-color',
			attr: { 'aria-label': `${option.name} color` },
		});
		for (const value of CALENDAR_COLORS) {
			color.createEl('option', { value, text: CALENDAR_COLOR_LABELS[value] });
		}
		color.value = option.color;
		color.addEventListener('change', () => {
			option.color = color.value as CalendarColor;
			swatch.dataset.color = option.color;
		});

		this.renderOptionIconButton(row, 'chevron-up', 'Move option up', index <= 1, () => {
			this.moveOption(index, -1);
		});
		this.renderOptionIconButton(
			row,
			'chevron-down',
			'Move option down',
			index === 0 || index === this.options.length - 1,
			() => this.moveOption(index, 1),
		);
		this.renderOptionIconButton(row, 'trash-2', 'Delete option', index === 0, () => {
			this.removeOption(index);
		});
	}

	private renderOptionIconButton(
		container: HTMLElement,
		icon: string,
		label: string,
		disabled: boolean,
		onClick: () => void,
	): void {
		const button = container.createEl('button', {
			cls: 'clickable-icon',
			attr: { type: 'button', 'aria-label': label },
		});
		button.disabled = disabled;
		setIcon(button, icon);
		button.addEventListener('click', onClick);
	}

	private renderDefaultEditor(): void {
		if (this.definition.type === 'checkbox') {
			new Setting(this.contentEl).setName('Default').addToggle((toggle) => {
				toggle
					.setValue(this.definition.default === true)
					.onChange((value) => {
						this.definition.default = value;
					});
			});
			return;
		}

		if (this.definition.type === 'number') {
			new Setting(this.contentEl).setName('Default').addText((text) => {
				text.inputEl.type = 'number';
				text.setValue(
					typeof this.definition.default === 'number'
						? String(this.definition.default)
						: '',
				);
				text.onChange((value) => {
					if (!value.trim()) delete this.definition.default;
					else this.definition.default = Number(value);
				});
			});
			return;
		}

		new Setting(this.contentEl).setName('Default').addText((text) => {
			text
				.setValue(typeof this.definition.default === 'string' ? this.definition.default : '')
				.onChange((value) => {
					if (value) this.definition.default = value;
					else delete this.definition.default;
				});
		});
	}

	private changeType(type: CalendarPropertyType): void {
		if (type === this.definition.type) return;
		this.definition = createPropertyDefinition(type);
		this.resetSelectOptions();
		this.renderEditor();
	}

	private resetSelectOptions(): void {
		this.options = [];
		if (this.definition.type !== 'select') return;
		const source = this.definition.options ?? [];
		const names = ['None', ...source.filter((option) => option !== 'None')];
		for (const name of names) {
			this.options.push({
				id: this.nextOptionId(),
				name,
				color: this.definition.colors?.[name] ?? 'default',
			});
		}
		const selected = this.options.find(
			(option) => option.name === this.definition.default,
		);
		this.defaultOptionId = selected?.id ?? this.options[0]?.id ?? '';
	}

	private moveOption(index: number, direction: -1 | 1): void {
		const target = index + direction;
		if (index <= 0 || target <= 0 || target >= this.options.length) return;
		const option = this.options[index];
		const adjacent = this.options[target];
		if (!option || !adjacent) return;
		this.options[index] = adjacent;
		this.options[target] = option;
		this.renderEditor();
	}

	private removeOption(index: number): void {
		if (index === 0) return;
		const removed = this.options[index];
		this.options.splice(index, 1);
		if (removed?.id === this.defaultOptionId) {
			this.defaultOptionId = this.options[0]?.id ?? '';
		}
		this.renderEditor();
	}

	private uniqueOptionName(): string {
		const names = new Set(this.options.map((option) => option.name));
		if (!names.has('Option')) return 'Option';
		let index = 2;
		while (names.has(`Option ${index}`)) index += 1;
		return `Option ${index}`;
	}

	private nextOptionId(): string {
		this.optionId += 1;
		return `option-${this.optionId}`;
	}

	private async save(): Promise<void> {
		if (this.saving) return;
		try {
			const name = validatePropertyName(
				this.propertyDefinitions,
				this.name,
				this.currentName,
			);
			const definition = this.buildDefinition();
			this.saving = true;
			if (this.saveButton) {
				this.saveButton.disabled = true;
				this.saveButton.setText('Saving…');
			}
			await this.onSave(name, definition);
			this.close();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unable to save property.';
			this.errorEl?.setText(message);
		} finally {
			this.saving = false;
			if (this.saveButton) {
				this.saveButton.disabled = false;
				this.saveButton.setText('Save');
			}
		}
	}

	private buildDefinition(): CalendarPropertyDefinition {
		if (this.definition.type !== 'select') {
			if (
				this.definition.type === 'number' &&
				this.definition.default !== undefined &&
				(typeof this.definition.default !== 'number' ||
					!Number.isFinite(this.definition.default))
			) {
				throw new Error('Enter a valid number for the default value.');
			}
			return copyCalendarPropertyDefinition(this.definition);
		}

		const normalized = this.options.map((option) => ({
			...option,
			name: option.name.trim(),
		}));
		for (const option of normalized) {
			if (!option.name) throw new Error('Option names cannot be empty.');
		}
		const seen = new Set<string>();
		for (const option of normalized) {
			const key = option.name.toLocaleLowerCase();
			if (seen.has(key)) throw new Error(`Duplicate option: ${option.name}`);
			seen.add(key);
		}
		const defaultOption = normalized.find(
			(option) => option.id === this.defaultOptionId,
		);
		return {
			type: 'select',
			options: normalized.map((option) => option.name),
			colors: Object.fromEntries(
				normalized.map((option) => [option.name, option.color]),
			),
			default: defaultOption?.name ?? 'None',
		};
	}
}
