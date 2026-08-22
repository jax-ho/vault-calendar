import type { App, TFile, WorkspaceLeaf } from 'obsidian';
import type { CalendarViewState } from '../types';

export const CALENDAR_VIEW_TYPE = 'calendar-view';

function createInstanceId(): string {
	return activeWindow.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class CalendarOpenAdapter {
	constructor(private readonly app: App) {}

	async openCalendar(
		file: TFile,
		newLeaf = false,
		preferredLeaf?: WorkspaceLeaf,
	): Promise<void> {
		const leaf = preferredLeaf ?? this.app.workspace.getLeaf(newLeaf ? 'tab' : false);
		const state: CalendarViewState = {
			calendarDocumentPath: file.path,
			instanceId: createInstanceId(),
		};
		await leaf.setViewState({
			type: CALENDAR_VIEW_TYPE,
			active: true,
			state: state as unknown as Record<string, unknown>,
		});
		await this.app.workspace.revealLeaf(leaf);
	}

	async openMarkdownFile(file: TFile, newLeaf: boolean): Promise<void> {
		await this.app.workspace.getLeaf(newLeaf ? 'tab' : false).openFile(file);
	}
}
