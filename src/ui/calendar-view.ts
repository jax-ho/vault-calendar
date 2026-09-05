import {
	ItemView,
	Notice,
	setIcon,
	type ViewStateResult,
	type WorkspaceLeaf,
} from 'obsidian';
import {
	fallbackAfterViewRemoval,
	findSavedView,
	resolveActiveSavedView,
} from '../domain/saved-view-selection';
import { createDefaultSavedViewCatalog } from '../domain/saved-views';
import type { CalendarIndex } from '../services/calendar-index';
import { CALENDAR_VIEW_TYPE } from '../services/open-adapter';
import type CalendarViewPlugin from '../main';
import type {
	CalendarConfig,
	CalendarIndexSnapshot,
	BoardSavedView,
	CalendarSavedView,
	CalendarUiState,
	CalendarViewState,
	ConfigIssue,
	SavedView,
	SavedViewCatalog,
	SavedViewUiState,
	ViewId,
} from '../types';
import {
	createCalendarSurface,
	type CalendarSurfaceState,
} from './calendar-surface';
import {
	createBoardSurface,
	type BoardSurfaceState,
} from './board-surface';
import { CalendarIssuesModal } from './calendar-list-modal';
import {
	CalendarSettingsModal,
	type CalendarSettingsSectionId,
} from './calendar-settings-modal';
import {
	AddSavedViewModal,
	DeleteSavedViewModal,
	EditSavedViewModal,
	RenameSavedViewModal,
} from './saved-view-modals';
import {
	renderSavedViewTabs,
	savedViewPanelId,
} from './saved-view-tabs';
import { applyUiLocale } from './ui-locale';
import type {
	ViewSurface,
	ViewSurfaceDependencies,
	ViewSurfaceFactory,
} from './view-surface';

const EMPTY_SNAPSHOT: CalendarIndexSnapshot = {
	items: [],
	issues: [],
	indexedCount: 0,
};

const VIEW_SURFACE_FACTORIES = {
	calendar: createCalendarSurface,
	board: createBoardSurface,
} satisfies {
	calendar: ViewSurfaceFactory<CalendarSavedView, CalendarSurfaceState>;
	board: ViewSurfaceFactory<BoardSavedView, BoardSurfaceState>;
};

type ActiveSurface =
	| {
			type: 'calendar';
			viewId: ViewId;
			surface: ViewSurface<CalendarSavedView, CalendarSurfaceState>;
	  }
	| {
			type: 'board';
			viewId: ViewId;
			surface: ViewSurface<BoardSavedView, BoardSurfaceState>;
	  };

interface HostApplyContext {
	documentPath: string;
	generation: number;
}

export class CalendarView extends ItemView {
	private calendarDocumentPath?: string;
	private instanceId = '';
	private config?: CalendarConfig;
	private configIssues: ConfigIssue[] = [];
	private indexError?: string;
	private snapshot = EMPTY_SNAPSHOT;
	private index?: CalendarIndex;
	private activeIndexPath?: string;
	private unsubscribeIndex?: () => void;
	private opened = false;
	private calendarDeleted = false;
	private uiState: CalendarUiState = { viewStates: {} };
	private activeSurface?: ActiveSurface;
	private sharedChrome?: HTMLElement;
	private surfaceContainer?: HTMLElement;
	private loadQueue: Promise<void> = Promise.resolve();
	private hostGeneration = 0;
	private indexSubscriptionGeneration = 0;
	private subscribedHostGeneration?: number;
	private subscribedIndex?: CalendarIndex;
	private subscribedIndexPath?: string;
	private pendingTabFocusViewId?: ViewId;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: CalendarViewPlugin,
	) {
		super(leaf);
		this.icon = 'calendar-days';
		this.register(() => this.detachSurface());
	}

	getViewType(): string {
		return CALENDAR_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.config?.name ?? 'Calendar view';
	}

	getState(): Record<string, unknown> {
		const state: CalendarViewState = {
			calendarDocumentPath: this.calendarDocumentPath,
			instanceId: this.instanceId,
		};
		return state as unknown as Record<string, unknown>;
	}

	async setState(state: unknown, _result: ViewStateResult): Promise<void> {
		const candidate = state as CalendarViewState | null;
		const nextPath =
			typeof candidate?.calendarDocumentPath === 'string'
				? candidate.calendarDocumentPath
				: undefined;
		const nextInstanceId =
			typeof candidate?.instanceId === 'string' && candidate.instanceId
				? candidate.instanceId
				: this.createInstanceId();
		const identityChanged =
			this.calendarDocumentPath !== nextPath || this.instanceId !== nextInstanceId;
		if (identityChanged) this.hostGeneration += 1;
		if (this.opened && this.calendarDocumentPath && identityChanged) {
			try {
				await this.persistAndDetachSurface();
			} catch (error) {
				this.ensureActiveIndexSubscription();
				this.syncSurface();
				throw error;
			}
		}
		if (this.calendarDocumentPath !== nextPath) this.releaseActiveIndex();
		if (identityChanged) this.uiState = { viewStates: {} };
		this.calendarDocumentPath = nextPath;
		this.instanceId = nextInstanceId;
		this.calendarDeleted = false;
		if (this.opened) await this.loadCalendar();
	}

	protected async onOpen(): Promise<void> {
		this.hostGeneration += 1;
		this.opened = true;
		applyUiLocale(this.contentEl);
		this.contentEl.addClass('calendar-view-root');
		this.contentEl.tabIndex = 0;
		this.plugin.registerViewInstance(this);
		await this.loadCalendar();
	}

	protected async onClose(): Promise<void> {
		this.opened = false;
		this.hostGeneration += 1;
		try {
			await this.loadQueue.catch(() => undefined);
			if (!this.calendarDeleted) await this.persistAndDetachSurface();
			else this.detachSurface();
		} finally {
			this.detachSurface();
			this.pendingTabFocusViewId = undefined;
			this.releaseActiveIndex();
			this.plugin.unregisterViewInstance(this);
		}
	}

	async refreshCalendarDocument(): Promise<void> {
		this.activeSurface?.surface.cancelInteraction(
			'Calendar configuration changed. The active interaction was cancelled.',
		);
		await this.loadCalendar(true);
	}

	async handleCalendarRenamed(oldPath: string, newPath: string): Promise<void> {
		if (this.calendarDocumentPath !== oldPath) return;
		this.hostGeneration += 1;
		this.calendarDocumentPath = newPath;
		this.activeIndexPath = newPath;
		if (this.config) this.config = { ...this.config, documentPath: newPath };
		await this.loadCalendar(true);
		void this.app.workspace.requestSaveLayout();
	}

	handleCalendarDeleted(path: string): void {
		if (this.calendarDocumentPath !== path) return;
		this.calendarDeleted = true;
		this.hostGeneration += 1;
		this.detachSurface();
		new Notice(`Calendar document deleted: ${path}`);
		this.leaf.detach();
	}

	private createInstanceId(): string {
		return (
			this.contentEl.ownerDocument.defaultView?.crypto.randomUUID?.() ??
			`${Date.now()}-${Math.random().toString(36).slice(2)}`
		);
	}

	private releaseActiveIndex(): void {
		this.clearIndexSubscription();
		if (this.activeIndexPath) this.plugin.indexes.release(this.activeIndexPath);
		this.index = undefined;
		this.activeIndexPath = undefined;
		this.config = undefined;
		this.configIssues = [];
		this.indexError = undefined;
		this.snapshot = EMPTY_SNAPSHOT;
	}

	private clearIndexSubscription(): void {
		this.indexSubscriptionGeneration += 1;
		this.unsubscribeIndex?.();
		this.unsubscribeIndex = undefined;
		this.subscribedHostGeneration = undefined;
		this.subscribedIndex = undefined;
		this.subscribedIndexPath = undefined;
	}

	private ensureActiveIndexSubscription(): void {
		const index = this.index;
		const path = this.activeIndexPath;
		if (!index || !path || path !== this.calendarDocumentPath) return;
		if (
			this.unsubscribeIndex &&
			this.subscribedHostGeneration === this.hostGeneration &&
			this.subscribedIndex === index &&
			this.subscribedIndexPath === path
		) {
			return;
		}

		this.clearIndexSubscription();
		const subscriptionGeneration = this.indexSubscriptionGeneration + 1;
		this.indexSubscriptionGeneration = subscriptionGeneration;
		const hostGeneration = this.hostGeneration;
		this.subscribedHostGeneration = hostGeneration;
		this.subscribedIndex = index;
		this.subscribedIndexPath = path;
		this.unsubscribeIndex = index.subscribe((snapshot) => {
			if (
				!this.isCurrentHost(path, hostGeneration) ||
				this.indexSubscriptionGeneration !== subscriptionGeneration ||
				this.index !== index ||
				this.activeIndexPath !== path
			) {
				return;
			}
			this.snapshot = snapshot;
			this.syncSurface();
		});
	}

	private loadCalendar(isRefresh = false): Promise<void> {
		const next = this.loadQueue
			.catch(() => undefined)
			.then(() => this.performLoadCalendar(isRefresh));
		this.loadQueue = next.catch(() => undefined);
		return next;
	}

	private async performLoadCalendar(isRefresh: boolean): Promise<void> {
		if (!this.opened) return;
		const hostGeneration = this.hostGeneration;
		const path = this.calendarDocumentPath;
		if (!path) {
			this.config = undefined;
			this.configIssues = [
				{ field: 'calendar document', message: 'Choose a calendar document to continue.' },
			];
			await this.persistAndDetachSurface();
			if (this.opened && this.hostGeneration === hostGeneration && !this.calendarDocumentPath) {
				this.renderDocumentError();
			}
			return;
		}
		const file = this.app.vault.getFileByPath(path);
		if (!file) {
			this.config = undefined;
			this.configIssues = [
				{ field: 'calendar document', message: `File not found: ${path}` },
			];
			await this.persistAndDetachSurface();
			if (this.isCurrentHost(path, hostGeneration)) this.renderDocumentError();
			return;
		}
		const parsed = this.plugin.documents.read(file);
		if (!parsed.config) {
			this.config = undefined;
			this.configIssues = parsed.issues;
			await this.persistAndDetachSurface();
			if (this.isCurrentHost(path, hostGeneration)) this.renderDocumentError();
			return;
		}

		const previousConfig = this.config;
		const previousCatalog = previousConfig
			? this.savedViewCatalog(previousConfig)
			: undefined;
		const nextConfig = parsed.config;
		this.config = nextConfig;
		this.configIssues = [
			...parsed.issues,
			...this.plugin.documents.validateLocations(nextConfig),
		];
		if (!isRefresh || !previousConfig) {
			this.uiState = this.plugin.stateStore.get(path, this.instanceId) ?? {
				viewStates: {},
			};
		}
		const nextCatalog = this.savedViewCatalog(nextConfig);
		this.pruneUiState(nextCatalog);
		const preferredViewId = this.uiState.activeViewId;
		if (!findSavedView(nextCatalog, preferredViewId)) {
			const fallback =
				preferredViewId && previousCatalog
					? fallbackAfterViewRemoval(
							previousCatalog,
							preferredViewId,
							nextCatalog,
						)
					: resolveActiveSavedView(nextCatalog);
			this.uiState.activeViewId = fallback?.id;
		}

		try {
			if (!this.index || this.activeIndexPath !== path) {
				const previousIndexPath = this.activeIndexPath;
				this.clearIndexSubscription();
				if (previousIndexPath) this.plugin.indexes.release(previousIndexPath);
				this.index = undefined;
				this.activeIndexPath = undefined;
				const nextIndex = await this.plugin.indexes.acquire(nextConfig);
				if (!this.isCurrentHost(path, hostGeneration)) {
					this.plugin.indexes.release(path);
					return;
				}
				this.index = nextIndex;
				this.activeIndexPath = path;
				this.ensureActiveIndexSubscription();
			} else {
				await this.plugin.indexes.updateConfig(nextConfig);
				if (!this.isCurrentHost(path, hostGeneration)) return;
				this.ensureActiveIndexSubscription();
			}
			this.indexError = undefined;
		} catch (error) {
			if (!this.isCurrentHost(path, hostGeneration)) return;
			this.indexError =
				error instanceof Error ? error.message : 'Unable to index this calendar.';
			this.syncSurface();
			return;
		}

		await this.plugin.stateStore.markRecent(path);
		if (this.isCurrentHost(path, hostGeneration)) this.syncSurface();
	}

	private isCurrentHost(documentPath: string, generation: number): boolean {
		return (
			this.opened &&
			!this.calendarDeleted &&
			this.calendarDocumentPath === documentPath &&
			this.hostGeneration === generation
		);
	}

	private isCurrentApplyContext(context: HostApplyContext): boolean {
		return (
			this.isCurrentHost(context.documentPath, context.generation) &&
			this.config?.documentPath === context.documentPath
		);
	}

	private savedViewCatalog(config: CalendarConfig): SavedViewCatalog {
		return (
			config.viewCatalog ??
			createDefaultSavedViewCatalog(config.layout, config.weekStartsOn)
		);
	}

	private activeDefinition(): SavedView | undefined {
		if (!this.config) return undefined;
		return resolveActiveSavedView(
			this.savedViewCatalog(this.config),
			this.uiState.activeViewId,
		);
	}

	private syncSurface(): void {
		if (!this.opened || this.calendarDeleted) return;
		const config = this.config;
		const definition = this.activeDefinition();
		if (!config || !definition) {
			const detached = this.detachSurface();
			if (detached) void this.persistUiState(detached.viewId, detached.state);
			this.renderUnavailableSurface();
			return;
		}

		const input = {
			definition,
			config,
			configIssues: this.configIssues,
			snapshot: this.snapshot,
			indexError: this.indexError,
		};
		const active = this.activeSurface;
		if (active?.viewId === definition.id && active.type === definition.type) {
			this.prepareSurfaceContainer(definition);
			if (active.type === 'calendar' && definition.type === 'calendar') {
				active.surface.update({ ...input, definition });
			}
			if (active.type === 'board' && definition.type === 'board') {
				active.surface.update({ ...input, definition });
			}
			this.renderSharedChrome();
			return;
		}

		const restoreTabFocus = this.focusedViewTabId() !== undefined;
		this.detachSurface();
		if (restoreTabFocus) this.pendingTabFocusViewId = definition.id;
		this.uiState.activeViewId = definition.id;
		const hostContext: HostApplyContext = {
			documentPath: config.documentPath,
			generation: this.hostGeneration,
		};
		const dependencies: ViewSurfaceDependencies = {
			plugin: this.plugin,
			getActiveIndex: () => this.index,
			applySavedViewCatalog: (catalog) =>
				this.applySavedViewCatalog(catalog, undefined, hostContext),
			persistUiState: (viewId, state) => this.persistUiState(viewId, state),
			editView: (view) => this.openEditView(view),
			openProperties: () => this.openSettings('properties'),
			retry: () => this.loadCalendar(true),
		};
		this.createHostFrame();
		if (!this.surfaceContainer) throw new Error('Calendar host frame was not created.');
		this.prepareSurfaceContainer(definition);
		if (definition.type === 'calendar') {
			const surface = VIEW_SURFACE_FACTORIES.calendar(dependencies);
			this.activeSurface = { type: 'calendar', viewId: definition.id, surface };
			surface.mount(this.surfaceContainer, {
				...input,
				definition,
				state: this.uiState.viewStates[definition.id],
			});
		} else {
			const surface = VIEW_SURFACE_FACTORIES.board(dependencies);
			this.activeSurface = { type: 'board', viewId: definition.id, surface };
			surface.mount(this.surfaceContainer, {
				...input,
				definition,
				state: this.uiState.viewStates[definition.id],
			});
		}
		this.renderSharedChrome();
		void this.persistCurrentUiState();
	}

	private detachSurface():
		| { viewId: ViewId; state: SavedViewUiState }
		| undefined {
		const active = this.activeSurface;
		this.activeSurface = undefined;
		this.sharedChrome = undefined;
		this.surfaceContainer = undefined;
		if (!active) return undefined;
		const state = active.surface.deactivate();
		const keepState =
			!this.config || this.catalogContainsId(this.savedViewCatalog(this.config), active.viewId);
		this.uiState = {
			activeViewId: keepState ? active.viewId : this.uiState.activeViewId,
			viewStates: keepState
				? { ...this.uiState.viewStates, [active.viewId]: state }
				: { ...this.uiState.viewStates },
		};
		return keepState ? { viewId: active.viewId, state } : undefined;
	}

	private async persistAndDetachSurface(): Promise<void> {
		const detached = this.detachSurface();
		if (detached) await this.persistUiState(detached.viewId, detached.state);
	}

	private async persistUiState(
		viewId: ViewId,
		state: SavedViewUiState,
	): Promise<void> {
		const path = this.calendarDocumentPath;
		if (!path || !this.instanceId || this.calendarDeleted) return;
		this.uiState = {
			activeViewId:
				this.activeSurface?.viewId === viewId
					? viewId
					: this.uiState.activeViewId,
			viewStates: { ...this.uiState.viewStates, [viewId]: { ...state } },
		};
		this.renderSharedChrome();
		await this.plugin.stateStore.set(path, this.instanceId, this.uiState);
	}

	private async persistCurrentUiState(): Promise<void> {
		const path = this.calendarDocumentPath;
		if (!path || !this.instanceId || this.calendarDeleted) return;
		await this.plugin.stateStore.set(path, this.instanceId, this.uiState);
	}

	private async applyConfig(
		config: CalendarConfig,
		context: HostApplyContext,
	): Promise<void> {
		if (!this.isCurrentApplyContext(context)) return;
		this.config = config;
		this.configIssues = this.plugin.documents.validateLocations(config);
		await this.plugin.indexes.updateConfig(config);
		if (this.isCurrentApplyContext(context)) this.syncSurface();
	}

	private renderDocumentError(): void {
		if (!this.opened || this.calendarDeleted) return;
		this.contentEl.empty();
		this.sharedChrome = undefined;
		this.surfaceContainer = undefined;
		this.contentEl.addClass('calendar-view-root');
		const state = this.contentEl.createDiv({ cls: 'cv-document-error' });
		state.createEl('h2', { text: 'Calendar document needs attention' });
		state.createEl('p', {
			text: 'A calendar is a Markdown note with calendar-view: true and valid calendar properties.',
		});
		const list = state.createEl('ul');
		for (const issue of this.configIssues) {
			list.createEl('li', { text: `${issue.field}: ${issue.message}` });
		}
		const button = state.createEl('button', { text: 'Open source document' });
		button.addEventListener('click', () => void this.openSourceDocument());
	}

	private renderUnavailableSurface(): void {
		if (!this.config) return;
		this.createHostFrame();
		this.renderSharedChrome();
		const state = this.surfaceContainer?.createDiv({ cls: 'cv-document-error' });
		if (!state) return;
		state.createEl('h2', { text: 'Calendar view unavailable' });
		state.createEl('p', {
			text: 'Repair or add an available saved view in the source document.',
		});
		const button = state.createEl('button', { text: 'Open source document' });
		button.addEventListener('click', () => void this.openSourceDocument());
	}

	private async openSourceDocument(): Promise<void> {
		if (!this.calendarDocumentPath) return;
		const file = this.app.vault.getFileByPath(this.calendarDocumentPath);
		if (!file) {
			new Notice(`Calendar document not found: ${this.calendarDocumentPath}`);
			return;
		}
		await this.plugin.openAdapter.openMarkdownFile(file, true);
	}

	private createHostFrame(): void {
		this.contentEl.empty();
		this.contentEl.addClass('calendar-view-root');
		const shell = this.contentEl.createDiv({ cls: 'cv-shell' });
		this.sharedChrome = shell.createDiv({ cls: 'cv-shared-chrome' });
		this.surfaceContainer = shell.createDiv({ cls: 'cv-view-surface' });
	}

	private prepareSurfaceContainer(definition: SavedView): void {
		const container = this.surfaceContainer;
		if (!container) return;
		container.id = savedViewPanelId(this.viewIdPrefix(), definition.id);
		container.setAttribute('role', 'tabpanel');
		container.setAttribute('aria-label', definition.name);
	}

	private viewIdPrefix(): string {
		return `cv-${this.instanceId.replaceAll(/[^a-zA-Z0-9_-]/gu, '-')}`;
	}

	private renderSharedChrome(): void {
		const root = this.sharedChrome;
		const config = this.config;
		if (!root || !config) return;
		const activeElement = root.ownerDocument.activeElement as HTMLElement | null;
		const focusedViewId =
			activeElement && root.contains(activeElement)
				? activeElement.closest<HTMLElement>('.cv-view-tab')?.dataset.viewId
				: this.pendingTabFocusViewId;
		root.empty();
		this.renderViewToolbar(root);
		if (this.configIssues.length > 0) this.renderConfigBanner(root);
		if (this.indexError) this.renderIndexError(root);
		if (focusedViewId) {
			const tab = [...root.querySelectorAll<HTMLElement>('.cv-view-tab')].find(
				(candidate) => candidate.dataset.viewId === focusedViewId,
			);
			if (tab) {
				tab.focus();
				this.pendingTabFocusViewId = undefined;
			}
		}
	}

	private focusedViewTabId(): ViewId | undefined {
		const activeElement = this.contentEl.ownerDocument.activeElement as HTMLElement | null;
		if (!activeElement || !this.contentEl.contains(activeElement)) return undefined;
		return activeElement.closest<HTMLElement>('.cv-view-tab')?.dataset.viewId;
	}

	private renderViewToolbar(root: HTMLElement): void {
		const config = this.config;
		if (!config) return;
		const toolbar = root.createDiv({ cls: 'cv-toolbar cv-view-toolbar' });
		const identity = toolbar.createDiv({ cls: 'cv-calendar-identity' });
		identity.createSpan({ cls: 'cv-calendar-name', text: config.name });
		const sourceButton = this.iconButton(identity, 'file-text', 'Open source document');
		sourceButton.addEventListener('click', () => void this.openSourceDocument());
		renderSavedViewTabs(
			toolbar,
			this.savedViewCatalog(config),
			this.uiState.activeViewId,
			this.viewIdPrefix(),
			{
				onActivate: (view) => this.activateView(view),
				onAdd: () => this.openAddView(),
				onEdit: (view) => this.openEditView(view),
				onRename: (view) => this.openRenameView(view),
				onDelete: (view) => this.openDeleteView(view),
			},
		);

		const actions = toolbar.createDiv({ cls: 'cv-toolbar-actions' });
		if (this.snapshot.issues.length > 0) {
			const issueButton = actions.createEl('button', {
				cls: 'cv-issue-button',
				text: `${this.snapshot.issues.length} unscheduled`,
			});
			issueButton.setAttribute('aria-label', 'Show unscheduled and invalid notes');
			issueButton.addEventListener('click', () => this.openIssues());
		}
		const settings = this.iconButton(actions, 'settings-2', 'Calendar settings');
		settings.addEventListener('click', () => this.openSettings());
		const primaryAction = this.activeSurface?.surface.primaryAction();
		if (primaryAction) {
			const button = actions.createEl('button', { text: primaryAction.label });
			button.setAttribute('aria-label', primaryAction.ariaLabel);
			button.addEventListener('click', () =>
				this.activeSurface?.surface.primaryAction().run(),
			);
		}
	}

	private renderConfigBanner(root: HTMLElement): void {
		const banner = root.createDiv({ cls: 'cv-config-banner' });
		banner.createSpan({ text: 'Calendar configuration warning' });
		const list = banner.createEl('ul');
		for (const issue of this.configIssues) {
			list.createEl('li', { text: `${issue.field}: ${issue.message}` });
		}
	}

	private renderIndexError(root: HTMLElement): void {
		const banner = root.createDiv({ cls: 'cv-index-error' });
		banner.createSpan({ text: `Index failed: ${this.indexError ?? 'Unknown error'}` });
		const retry = banner.createEl('button', { text: 'Retry' });
		retry.addEventListener('click', () => void this.loadCalendar(true));
	}

	private openIssues(): void {
		new CalendarIssuesModal(this.app, this.snapshot.issues, async (path) => {
			const file = this.app.vault.getFileByPath(path);
			if (!file) {
				new Notice(`${path} no longer exists.`);
				return;
			}
			await this.plugin.openAdapter.openMarkdownFile(file, false);
		}).open();
	}

	private activateView(view: SavedView): void {
		const config = this.config;
		if (!config || this.uiState.activeViewId === view.id) return;
		const current = findSavedView(this.savedViewCatalog(config), view.id);
		if (!current) return;
		this.uiState = { ...this.uiState, activeViewId: current.id };
		this.syncSurface();
	}

	private openAddView(): void {
		const config = this.config;
		if (!config) return;
		const catalog = this.savedViewCatalog(config);
		if (!catalog.canMutate) return;
		const context: HostApplyContext = {
			documentPath: config.documentPath,
			generation: this.hostGeneration,
		};
		new AddSavedViewModal(
			this.plugin,
			config,
			catalog,
			this.uiState.activeViewId,
			(nextCatalog, viewId) =>
				this.applySavedViewCatalog(nextCatalog, viewId, context),
			() => {
				if (this.isCurrentApplyContext(context)) this.openSettings('properties');
			},
		).open();
	}

	private openEditView(view: SavedView): void {
		const config = this.config;
		if (!config || !this.savedViewCatalog(config).canMutate) return;
		const context: HostApplyContext = {
			documentPath: config.documentPath,
			generation: this.hostGeneration,
		};
		new EditSavedViewModal(
			this.plugin,
			config,
			view,
			(nextCatalog) => this.applySavedViewCatalog(nextCatalog, undefined, context),
		).open();
	}

	private openRenameView(view: SavedView): void {
		const config = this.config;
		if (!config) return;
		const catalog = this.savedViewCatalog(config);
		if (!catalog.canMutate) return;
		const context: HostApplyContext = {
			documentPath: config.documentPath,
			generation: this.hostGeneration,
		};
		new RenameSavedViewModal(
			this.plugin,
			config.documentPath,
			catalog,
			view,
			(nextCatalog) => this.applySavedViewCatalog(nextCatalog, undefined, context),
		).open();
	}

	private openDeleteView(view: SavedView): void {
		const config = this.config;
		if (!config) return;
		const previousCatalog = this.savedViewCatalog(config);
		if (!previousCatalog.canMutate) return;
		const context: HostApplyContext = {
			documentPath: config.documentPath,
			generation: this.hostGeneration,
		};
		new DeleteSavedViewModal(
			this.plugin,
			config.documentPath,
			view,
			(nextCatalog) => {
				if (!this.isCurrentApplyContext(context)) return;
				const viewStates = { ...this.uiState.viewStates };
				delete viewStates[view.id];
				this.uiState = { ...this.uiState, viewStates };
				const fallback =
					this.uiState.activeViewId === view.id
						? fallbackAfterViewRemoval(previousCatalog, view.id, nextCatalog)
						: undefined;
				this.applySavedViewCatalog(nextCatalog, fallback?.id, context);
			},
		).open();
	}

	private applySavedViewCatalog(
		catalog: SavedViewCatalog,
		activeViewId?: ViewId,
		context?: HostApplyContext,
	): void {
		if (!this.config || (context && !this.isCurrentApplyContext(context))) return;
		this.config = { ...this.config, viewCatalog: catalog };
		if (activeViewId) this.uiState = { ...this.uiState, activeViewId };
		this.pruneUiState(catalog);
		this.syncSurface();
	}

	private catalogContainsId(catalog: SavedViewCatalog, viewId: ViewId): boolean {
		return catalog.entries.some((entry) =>
			entry.kind === 'valid' ? entry.definition.id === viewId : entry.id === viewId,
		);
	}

	private pruneUiState(catalog: SavedViewCatalog): void {
		const entriesById = new Map(
			catalog.entries.flatMap((entry) => {
				const id = entry.kind === 'valid' ? entry.definition.id : entry.id;
				return id ? [[id, entry] as const] : [];
			}),
		);
		const viewStates = Object.fromEntries(
			Object.entries(this.uiState.viewStates).filter(([viewId, state]) => {
				const entry = entriesById.get(viewId);
				return (
					entry !== undefined &&
					(entry.kind !== 'valid' || entry.definition.type === state.type)
				);
			}),
		);
		this.uiState = { ...this.uiState, viewStates };
	}

	private openSettings(initialSection: CalendarSettingsSectionId = 'calendar'): void {
		const config = this.config;
		if (!config) return;
		const context: HostApplyContext = {
			documentPath: config.documentPath,
			generation: this.hostGeneration,
		};
		new CalendarSettingsModal(
			this.plugin,
			config,
			(nextConfig) => this.applyConfig(nextConfig, context),
			initialSection,
		).open();
	}

	private iconButton(parent: HTMLElement, icon: string, label: string): HTMLButtonElement {
		const button = parent.createEl('button', { cls: 'clickable-icon' });
		button.setAttribute('aria-label', label);
		button.setAttribute('title', label);
		setIcon(button, icon);
		return button;
	}
}
