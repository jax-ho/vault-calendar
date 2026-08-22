import { Modal, Notice, Setting } from 'obsidian';
import { calendarFolderPath } from '../domain/note-creation';
import type CalendarViewPlugin from '../main';
import type { CreateCalendarInput } from '../services/calendar-document';
import { applyUiLocale } from './ui-locale';

function folderOptions(plugin: CalendarViewPlugin): string[] {
	return [
		'',
		...plugin.app.vault
			.getAllFolders(false)
			.map((folder) => folder.path)
			.sort((left, right) => left.localeCompare(right)),
	];
}

export class CreateCalendarModal extends Modal {
	private parentFolder = '';
	private input: CreateCalendarInput = {
		name: '',
		documentFolder: '',
		startDateProperty: 'date',
		endDateProperty: 'date-end',
	};

	constructor(private readonly plugin: CalendarViewPlugin) {
		super(plugin.app);
	}

	onOpen(): void {
		applyUiLocale(this.modalEl);
		this.setTitle('Create calendar document');
		this.contentEl.addClass('cv-form-modal');
		const errorEl = this.contentEl.createDiv({ cls: 'cv-form-error' });
		const folders = folderOptions(this.plugin);

		new Setting(this.contentEl)
			.setName('Calendar name')
			.setDesc('Used as the calendar folder and display name.')
			.addText((text) => {
				text.setPlaceholder('Work calendar').onChange((value) => {
					this.input.name = value;
				});
				text.inputEl.focus();
			});

		new Setting(this.contentEl)
			.setName('Calendar location')
			.setDesc('Creates a dedicated folder here for this calendar and its events.')
			.addDropdown((dropdown) => {
				for (const folder of folders) dropdown.addOption(folder, folder || 'Entire vault');
				dropdown.onChange((value) => {
					this.parentFolder = value;
				});
		});

		new Setting(this.contentEl).addButton((button) => {
			button.setButtonText('Create').onClick(async () => {
				errorEl.empty();
				button.setDisabled(true);
				try {
					const folder = calendarFolderPath(this.input.name, this.parentFolder);
					const file = await this.plugin.documents.create({
						...this.input,
						documentFolder: folder,
					});
					this.close();
					await this.plugin.openAdapter.openCalendar(file);
				} catch (error) {
					const message = error instanceof Error ? error.message : 'Unable to create calendar.';
					errorEl.setText(message);
					new Notice(message);
				} finally {
					button.setDisabled(false);
				}
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
