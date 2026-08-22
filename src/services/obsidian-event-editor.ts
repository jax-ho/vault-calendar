import type { App, TFile } from 'obsidian';
import type { EventEditorPort } from './event-editor';

export function createObsidianEventEditorPort(app: App): EventEditorPort<TFile> {
	return {
		getFileByPath: (path) => app.vault.getFileByPath(path),
		read: (file) => app.vault.read(file),
		process: (file, mutate) => app.vault.process(file, mutate),
	};
}
