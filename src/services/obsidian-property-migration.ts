import type { App, TFile } from 'obsidian';
import type { CalendarPropertyMigrationPort } from './calendar-property-migration';

export function createObsidianPropertyMigrationPort(
	app: App,
): CalendarPropertyMigrationPort<TFile> {
	return {
		configDirectory: app.vault.configDir,
		getMarkdownFiles: () => app.vault.getMarkdownFiles(),
		getFileByPath: (path) => app.vault.getFileByPath(path),
		read: (file) => app.vault.read(file),
		process: (file, mutate) => app.vault.process(file, mutate),
	};
}
