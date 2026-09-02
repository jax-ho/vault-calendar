import { Menu, Plugin, TFile } from 'obsidian';
import { CALENDAR_KEYS, isCalendarDocumentPath } from './domain/config';
import { CalendarDocumentService } from './services/calendar-document';
import { CalendarPropertyMigrationService } from './services/calendar-property-migration';
import {
	CalendarIndexManager,
	createObsidianCalendarIndexPort,
} from './services/calendar-index';
import { FrontmatterWriter } from './services/frontmatter-writer';
import { EventEditorService } from './services/event-editor';
import { createObsidianEventEditorPort } from './services/obsidian-event-editor';
import { ObsidianMarkdownDocumentCodec } from './services/obsidian-markdown-document';
import { createObsidianPropertyMigrationPort } from './services/obsidian-property-migration';
import {
	CALENDAR_VIEW_TYPE,
	CalendarOpenAdapter,
} from './services/open-adapter';
import { CalendarStateStore } from './services/state-store';
import { CalendarView } from './ui/calendar-view';
import { CalendarPickerModal } from './ui/calendar-picker-modal';
import { CreateCalendarModal } from './ui/create-calendar-modal';

export default class CalendarViewPlugin extends Plugin {
	documents!: CalendarDocumentService;
	indexes!: CalendarIndexManager;
	stateStore!: CalendarStateStore;
	openAdapter!: CalendarOpenAdapter;
	writer!: FrontmatterWriter<TFile>;
	eventEditor!: EventEditorService<TFile>;
	propertyMigration!: CalendarPropertyMigrationService<TFile>;
	private views = new Set<CalendarView>();

	async onload(): Promise<void> {
		this.documents = new CalendarDocumentService(this.app);
		this.indexes = new CalendarIndexManager(createObsidianCalendarIndexPort(this.app));
		this.openAdapter = new CalendarOpenAdapter(this.app);
		this.writer = new FrontmatterWriter<TFile>({
			getFileByPath: (path) => this.app.vault.getFileByPath(path),
			processFrontMatter: (file, mutate) =>
				this.app.fileManager.processFrontMatter(file, mutate),
		});
		const documentCodec = new ObsidianMarkdownDocumentCodec();
		this.eventEditor = new EventEditorService(
			createObsidianEventEditorPort(this.app),
			documentCodec,
		);
		this.propertyMigration = new CalendarPropertyMigrationService(
			createObsidianPropertyMigrationPort(this.app),
			documentCodec,
		);
		this.stateStore = new CalendarStateStore(await this.loadData(), (data) =>
			this.saveData(data),
		);

		this.registerView(
			CALENDAR_VIEW_TYPE,
			(leaf) => new CalendarView(leaf, this),
		);
		this.registerCommands();
		this.registerRibbon();
		this.registerFileMenu();
		this.registerVaultEvents();
	}

	registerViewInstance(view: CalendarView): void {
		this.views.add(view);
	}

	unregisterViewInstance(view: CalendarView): void {
		this.views.delete(view);
	}

	private registerCommands(): void {
		this.addCommand({
			id: 'create-calendar-document',
			name: 'Create calendar document',
			callback: () => new CreateCalendarModal(this).open(),
		});
		this.addCommand({
			id: 'open-calendar-document',
			name: 'Open calendar document',
			callback: () => new CalendarPickerModal(this).open(),
		});
		this.addCommand({
			id: 'open-active-file-as-calendar',
			name: 'Open active file as calendar',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const available = file ? this.isCalendarFile(file) : false;
				if (available && !checking && file) void this.openAdapter.openCalendar(file);
				return available;
			},
		});
	}

	private registerRibbon(): void {
		this.addRibbonIcon('calendar-days', 'Open calendar document', () => {
			const recent = this.stateStore.recentCalendarPath;
			const file = recent ? this.app.vault.getFileByPath(recent) : null;
			if (file && this.isCalendarFile(file)) void this.openAdapter.openCalendar(file);
			else new CalendarPickerModal(this).open();
		});
	}

	private registerFileMenu(): void {
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu: Menu, file) => {
				if (!(file instanceof TFile) || !this.isCalendarFile(file)) return;
				menu.addItem((item) => {
					item
						.setTitle('Open as calendar')
						.setIcon('calendar-days')
						.onClick(() => this.openAdapter.openCalendar(file));
				});
			}),
		);
	}

	private registerVaultEvents(): void {
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile) this.handleFileChanged(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile) this.handleFileChanged(file);
			}),
		);
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => this.handleFileChanged(file)),
		);
		this.registerEvent(
			this.app.metadataCache.on('resolved', () => this.indexes.handleLinksResolved()),
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile) void this.handleFileRenamed(file, oldPath);
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile) void this.handleFileDeleted(file.path);
			}),
		);
	}

	private handleFileChanged(file: TFile): void {
		this.indexes.handleFileChanged(file);
		for (const view of this.views) {
			if (view.getState().calendarDocumentPath === file.path) {
				void view.refreshCalendarDocument();
			}
		}
	}

	private async handleFileRenamed(file: TFile, oldPath: string): Promise<void> {
		const affectedViews = [...this.views].filter(
			(view) => view.getState().calendarDocumentPath === oldPath,
		);
		if (affectedViews.length > 0 || this.isCalendarFile(file)) {
			this.indexes.renameCalendar(oldPath, file.path);
			await this.stateStore.migrate(oldPath, file.path);
			for (const view of affectedViews) {
				await view.handleCalendarRenamed(oldPath, file.path);
			}
		}
		this.indexes.handleFileRenamed(file, oldPath);
	}

	private async handleFileDeleted(path: string): Promise<void> {
		this.indexes.handleFileDeleted(path);
		const affectedViews = [...this.views].filter(
			(view) => view.getState().calendarDocumentPath === path,
		);
		if (affectedViews.length > 0 || this.stateStore.has(path)) {
			await this.stateStore.delete(path);
			for (const view of affectedViews) view.handleCalendarDeleted(path);
		}
	}

	private isCalendarFile(file: TFile): boolean {
		return (
			isCalendarDocumentPath(file.path) &&
			this.app.metadataCache.getFileCache(file)?.frontmatter?.[CALENDAR_KEYS.marker] === true
		);
	}
}
