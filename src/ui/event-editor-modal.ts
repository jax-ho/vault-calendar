import { Modal, Notice, setIcon } from 'obsidian';
import {
	copyEventEditDraft,
	type EventEditDraft,
	type EventFieldMapping,
} from '../domain/event-edit';
import {
	EMPTY_EVENT_TITLE_DISPLAY,
	eventDisplayTitle,
} from '../domain/event-title';
import { resolvedPropertyType } from '../domain/property-type-icons';
import { EVENT_PARENT_ITEM_PROPERTY } from '../domain/reserved-properties';
import type CalendarViewPlugin from '../main';
import type { EventEditSession } from '../services/event-editor';
import type {
	CalendarConfig,
	CalendarItem,
	CalendarItemReference,
} from '../types';
import { configurePickerOnlyDateInput } from './date-picker-input';
import { renderEventFieldLabel } from './event-field-label';
import { renderEventPropertyInput } from './event-property-input';
import { applyUiLocale } from './ui-locale';

const SAVE_DELAY_MS = 450;

interface EventEditorRelationContext {
	parentItems: readonly CalendarItemReference[];
	validateParentItem?: (value: string | undefined) => void;
}

function fieldMapping(
	config: CalendarConfig,
	validateParentItem?: (value: string | undefined) => void,
): EventFieldMapping {
	return {
		startDateProperty: config.startDateProperty,
		endDateProperty: config.endDateProperty,
		visibleProperties: config.visibleProperties,
		propertyDefinitions: config.propertyDefinitions,
		validateParentItem,
	};
}

export class EventEditorModal extends Modal {
	private readonly mapping: EventFieldMapping;
	private session?: EventEditSession;
	private draft?: EventEditDraft;
	private statusEl?: HTMLElement;
	private errorEl?: HTMLElement;
	private saveTimer?: number;
	private revision = 0;
	private queuedRevision = 0;
	private savedRevision = 0;
	private saveQueue: Promise<void> = Promise.resolve();
	private lastError?: string;

	constructor(
		private readonly plugin: CalendarViewPlugin,
		private readonly config: CalendarConfig,
		private readonly item: CalendarItem,
		private readonly relations: EventEditorRelationContext = {
			parentItems: [],
		},
	) {
		super(plugin.app);
		this.mapping = fieldMapping(config, relations.validateParentItem);
	}

	async onOpen(): Promise<void> {
		applyUiLocale(this.modalEl);
		this.modalEl.addClass('cv-event-editor-modal');
		this.setTitle('Event');
		this.contentEl.createDiv({ cls: 'cv-event-editor-loading', text: 'Loading…' });
		try {
			this.session = await this.plugin.eventEditor.load(
				this.item.path,
				this.mapping,
				{ title: this.item.title, start: this.item.start },
			);
			this.draft = copyEventEditDraft(this.session.draft);
			this.renderEditor();
		} catch (error) {
			this.renderLoadError(error);
		}
	}

	onClose(): void {
		if (this.saveTimer !== undefined) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = undefined;
			void this.commit();
		}
		this.contentEl.empty();
	}

	private renderEditor(): void {
		if (!this.draft) return;
		this.contentEl.empty();

		const toolbar = this.contentEl.createDiv({ cls: 'cv-event-editor-toolbar' });
		this.statusEl = toolbar.createSpan({ cls: 'cv-event-save-status is-saved', text: 'Saved' });
		const openButton = toolbar.createEl('button', {
			cls: 'cv-event-open-note',
			attr: { type: 'button' },
		});
		setIcon(openButton, 'external-link');
		openButton.createSpan({ text: 'Open note' });
		openButton.addEventListener('click', () => void this.openFullNote());

		const title = this.contentEl.createEl('input', {
			cls: 'cv-event-editor-title',
			type: 'text',
			attr: {
				'aria-label': 'Event title',
				placeholder: EMPTY_EVENT_TITLE_DISPLAY,
			},
		});
		title.value = this.draft.title;
		title.addEventListener('input', () => {
			if (!this.draft) return;
			this.draft.title = title.value;
			this.queueSave();
		});

		const fields = this.contentEl.createDiv({ cls: 'cv-event-editor-fields' });
		this.renderDateField(fields, 'Start', this.draft.start, (value) => {
			if (this.draft) this.draft.start = value;
		});
		if (this.mapping.endDateProperty) {
			this.renderDateField(fields, 'End', this.draft.end, (value) => {
				if (this.draft) this.draft.end = value;
			});
		}
		for (const property of Object.keys(this.draft.properties)) {
			this.renderPropertyField(fields, property, this.draft.properties[property]);
		}
		this.renderSubItemsField(fields);

		this.contentEl.createDiv({ cls: 'cv-event-editor-divider' });
		const bodyLabel = this.contentEl.createEl('label', {
			cls: 'cv-event-editor-body-label',
			text: 'Notes',
		});
		const body = this.contentEl.createEl('textarea', {
			cls: 'cv-event-editor-body',
			attr: {
				'aria-label': 'Event notes',
				placeholder: 'Write Markdown…',
				spellcheck: 'true',
			},
		});
		bodyLabel.htmlFor = body.id = `cv-event-body-${Date.now()}`;
		body.value = this.draft.body;
		body.addEventListener('input', () => {
			if (!this.draft) return;
			this.draft.body = body.value;
			this.queueSave();
		});

		this.errorEl = this.contentEl.createDiv({ cls: 'cv-form-error cv-event-editor-error' });
		this.contentEl.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
			event.preventDefault();
			void this.flushSave();
		});
		title.focus();
		title.setSelectionRange(title.value.length, title.value.length);
	}

	private renderDateField(
		container: HTMLElement,
		label: string,
		value: string,
		onChange: (value: string) => void,
	): void {
		const row = container.createDiv({ cls: 'cv-event-editor-field' });
		renderEventFieldLabel(row, label, 'date');
		const input = row.createEl('input', {
			cls: 'cv-date-picker-only',
			type: 'date',
		});
		input.value = value;
		configurePickerOnlyDateInput(input);
		input.addEventListener('input', () => {
			onChange(input.value);
			this.queueSave();
		});
	}

	private renderPropertyField(
		container: HTMLElement,
		property: string,
		value: unknown,
	): void {
		if (!this.draft) return;
		const row = container.createDiv({ cls: 'cv-event-editor-field' });
		const definition = this.mapping.propertyDefinitions[property];
		renderEventFieldLabel(
			row,
			property === EVENT_PARENT_ITEM_PROPERTY ? 'Parent item' : property,
			property === EVENT_PARENT_ITEM_PROPERTY
				? 'relation'
				: resolvedPropertyType(definition, value),
		);
		const control = row.createDiv({ cls: 'cv-event-editor-field-control' });
		renderEventPropertyInput(
			control,
			property,
			definition,
			value,
			(nextValue) => {
				if (this.draft) this.draft.properties[property] = nextValue;
				this.queueSave();
			},
			this.relations.parentItems,
		);
	}

	private renderSubItemsField(container: HTMLElement): void {
		const row = container.createDiv({ cls: 'cv-event-editor-field' });
		renderEventFieldLabel(row, 'Sub-items', 'relations');
		const value = row.createDiv({
			cls: 'cv-event-editor-field-control cv-event-sub-items',
		});
		if (this.item.subItems.length === 0) {
			value.createSpan({
				cls: 'cv-event-property-readonly',
				text: 'No sub-items',
			});
			return;
		}
		for (const item of this.item.subItems) {
			const chip = value.createSpan({ cls: 'cv-event-relation-chip' });
			chip.setAttribute('title', item.path);
			chip.createSpan({ text: eventDisplayTitle(item.title) });
		}
	}

	private queueSave(): void {
		this.revision += 1;
		this.lastError = undefined;
		this.errorEl?.empty();
		this.setStatus('Saving…', 'saving');
		if (this.saveTimer !== undefined) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = undefined;
			void this.commit();
		}, SAVE_DELAY_MS);
	}

	private async flushSave(): Promise<boolean> {
		if (this.saveTimer !== undefined) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = undefined;
		}
		return this.commit();
	}

	private commit(): Promise<boolean> {
		if (!this.session || !this.draft) return Promise.resolve(false);
		const targetRevision = this.revision;
		if (targetRevision <= this.savedRevision) return this.saveQueue.then(() => true);
		if (targetRevision <= this.queuedRevision) {
			return this.saveQueue.then(() => this.savedRevision >= targetRevision);
		}
		this.queuedRevision = targetRevision;
		const snapshot = copyEventEditDraft(this.draft);
		let result = false;
		this.saveQueue = this.saveQueue.then(async () => {
			try {
				if (!this.session) return;
				this.setStatus('Saving…', 'saving');
				this.session = await this.plugin.eventEditor.save(
					this.session,
					this.mapping,
					snapshot,
				);
				this.savedRevision = Math.max(this.savedRevision, targetRevision);
				this.lastError = undefined;
				this.errorEl?.empty();
				if (this.savedRevision >= this.revision) this.setStatus('Saved', 'saved');
				result = true;
			} catch (error) {
				this.queuedRevision = this.savedRevision;
				const message = error instanceof Error ? error.message : 'Unable to save event.';
				this.setStatus('Not saved', 'error');
				this.errorEl?.setText(message);
				if (message !== this.lastError) new Notice(message);
				this.lastError = message;
			}
		});
		return this.saveQueue.then(() => result);
	}

	private setStatus(text: string, state: 'saving' | 'saved' | 'error'): void {
		if (!this.statusEl) return;
		this.statusEl.setText(text);
		this.statusEl.className = `cv-event-save-status is-${state}`;
	}

	private async openFullNote(): Promise<void> {
		if (!(await this.flushSave())) return;
		const file = this.plugin.app.vault.getFileByPath(this.item.path);
		if (!file) {
			new Notice(`${this.item.path} no longer exists.`);
			return;
		}
		this.close();
		await this.plugin.openAdapter.openMarkdownFile(
			file,
			this.config.openBehavior === 'new-tab',
		);
	}

	private renderLoadError(error: unknown): void {
		this.contentEl.empty();
		const message = error instanceof Error ? error.message : 'Unable to load event.';
		this.contentEl.createDiv({ cls: 'cv-form-error', text: message });
		const file = this.plugin.app.vault.getFileByPath(this.item.path);
		if (!file) return;
		const button = this.contentEl.createEl('button', { text: 'Open note' });
		button.addEventListener('click', () => {
			this.close();
			void this.plugin.openAdapter.openMarkdownFile(file, false);
		});
	}
}
