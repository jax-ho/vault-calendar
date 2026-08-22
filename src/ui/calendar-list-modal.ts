import { Modal, type App } from 'obsidian';
import type { ProjectionIssue } from '../types';
import { applyUiLocale } from './ui-locale';

export class CalendarIssuesModal extends Modal {
	constructor(
		app: App,
		private readonly issues: ProjectionIssue[],
		private readonly openPath: (path: string) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		applyUiLocale(this.modalEl);
		this.setTitle('Unscheduled and invalid notes');
		const list = this.contentEl.createDiv({ cls: 'cv-modal-list' });
		for (const issue of this.issues) {
			const button = list.createEl('button', { cls: 'cv-modal-list-item' });
			button.createSpan({ cls: 'cv-modal-item-title', text: issue.path });
			button.createSpan({ cls: 'cv-modal-item-range', text: issue.message });
			button.addEventListener('click', () => {
				this.close();
				void this.openPath(issue.path);
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
