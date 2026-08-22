import { FuzzySuggestModal, type TFile } from 'obsidian';
import type CalendarViewPlugin from '../main';
import { CreateCalendarModal } from './create-calendar-modal';
import { applyUiLocale } from './ui-locale';

export class CalendarPickerModal extends FuzzySuggestModal<TFile> {
	constructor(private readonly plugin: CalendarViewPlugin) {
		super(plugin.app);
		this.setPlaceholder('Choose a calendar document…');
	}

	open(): void {
		if (this.plugin.documents.list().length === 0) {
			new CreateCalendarModal(this.plugin).open();
			return;
		}
		applyUiLocale(this.modalEl);
		super.open();
	}

	getItems(): TFile[] {
		return this.plugin.documents.list();
	}

	getItemText(file: TFile): string {
		const result = this.plugin.documents.read(file);
		return result.config?.name ?? file.basename;
	}

	onChooseItem(file: TFile, event: MouseEvent | KeyboardEvent): void {
		void this.plugin.openAdapter.openCalendar(
			file,
			event instanceof MouseEvent && (event.metaKey || event.ctrlKey),
		);
	}
}
