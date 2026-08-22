import { Modal, Notice } from 'obsidian';
import type { PlainDate } from '../domain/dates';
import { createEventPropertyDraft } from '../domain/event-creation';
import { resolvedPropertyType } from '../domain/property-type-icons';
import type CalendarViewPlugin from '../main';
import type { CalendarConfig } from '../types';
import { renderEventFieldLabel } from './event-field-label';
import { renderEventPropertyInput } from './event-property-input';
import { applyUiLocale } from './ui-locale';

export class EventTitleModal extends Modal {
	private title = '';
	private body = '';
	private readonly properties: Record<string, unknown>;

	constructor(
		private readonly plugin: CalendarViewPlugin,
		private readonly config: CalendarConfig,
		private readonly date: PlainDate,
	) {
		super(plugin.app);
		this.properties = createEventPropertyDraft(config);
	}

	onOpen(): void {
		applyUiLocale(this.modalEl);
		this.modalEl.addClass('cv-event-create-modal');
		this.setTitle('New event');

		const title = this.contentEl.createEl('input', {
			cls: 'cv-event-editor-title',
			type: 'text',
			attr: { 'aria-label': 'Event title', placeholder: 'Untitled event' },
		});
		title.addEventListener('input', () => {
			this.title = title.value;
		});

		const fields = this.contentEl.createDiv({
			cls: 'cv-event-editor-fields cv-event-create-fields',
		});
		const dateRow = fields.createDiv({ cls: 'cv-event-editor-field' });
		renderEventFieldLabel(dateRow, 'Date', 'date');
		dateRow.createSpan({ cls: 'cv-event-create-date', text: this.date });
		for (const property of Object.keys(this.properties)) {
			this.renderPropertyField(fields, property);
		}

		this.contentEl.createDiv({ cls: 'cv-event-editor-divider' });
		const bodyLabel = this.contentEl.createEl('label', {
			cls: 'cv-event-editor-body-label',
			text: 'Notes',
		});
		const body = this.contentEl.createEl('textarea', {
			cls: 'cv-event-editor-body cv-event-create-body',
			attr: {
				'aria-label': 'Event notes',
				placeholder: 'Write Markdown…',
				spellcheck: 'true',
			},
		});
		bodyLabel.htmlFor = body.id = `cv-event-create-body-${Date.now()}`;
		body.addEventListener('input', () => {
			this.body = body.value;
		});

		const errorEl = this.contentEl.createDiv({
			cls: 'cv-form-error cv-event-editor-error',
		});
		const actions = this.contentEl.createDiv({ cls: 'cv-event-create-actions' });
		const createButton = actions.createEl('button', {
			text: 'Create',
			attr: { type: 'button' },
		});
		createButton.addEventListener('click', () => {
			void this.create(errorEl, createButton);
		});
		title.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' || event.metaKey || event.ctrlKey) return;
			event.preventDefault();
			void this.create(errorEl, createButton);
		});
		this.contentEl.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
			event.preventDefault();
			void this.create(errorEl, createButton);
		});
		title.focus();
	}

	private renderPropertyField(container: HTMLElement, property: string): void {
		const row = container.createDiv({ cls: 'cv-event-editor-field' });
		const definition = this.config.propertyDefinitions[property];
		renderEventFieldLabel(
			row,
			property,
			resolvedPropertyType(definition, this.properties[property]),
		);
		const control = row.createDiv({ cls: 'cv-event-editor-field-control' });
		renderEventPropertyInput(
			control,
			property,
			definition,
			this.properties[property],
			(value) => {
				this.properties[property] = value;
			},
		);
	}

	private async create(
		errorEl: HTMLElement,
		createButton: HTMLButtonElement,
	): Promise<void> {
		if (createButton.disabled) return;
		errorEl.empty();
		createButton.disabled = true;
		try {
			await this.plugin.documents.createEvent(
				this.config,
				this.title,
				this.date,
				this.properties,
				this.body,
			);
			this.close();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unable to create note.';
			errorEl.setText(message);
			new Notice(message);
			createButton.disabled = false;
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
