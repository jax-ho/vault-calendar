import {
	ItemView,
	Notice,
	setIcon,
	type ViewStateResult,
	type WorkspaceLeaf,
} from 'obsidian';
import {
	addDays,
	addMonths,
	compareDates,
	monthGrid,
	resolveWeekStart,
	sameMonth,
	todayPlainDate,
	toUtcDate,
	weekGrid,
	type PlainDate,
} from '../domain/dates';
import { calendarCardMetrics } from '../domain/card-layout';
import {
	moveDateRange,
	resizeDateRange,
	type DateRange,
	type ResizeEdge,
} from '../domain/interactions';
import { replaceCalendarDatePart } from '../domain/frontmatter-mutation';
import {
	segmentCalendarItems,
	type CalendarSegment,
	visibleTrackCount,
} from '../domain/range-layout';
import { CALENDAR_VIEW_TYPE } from '../services/open-adapter';
import type { CalendarIndex } from '../services/calendar-index';
import type CalendarViewPlugin from '../main';
import type {
	CalendarConfig,
	CalendarIndexSnapshot,
	CalendarItem,
	CalendarViewState,
	ConfigIssue,
} from '../types';
import { renderCardProperties } from './calendar-card';
import { CalendarIssuesModal } from './calendar-list-modal';
import { CalendarSettingsModal } from './calendar-settings-modal';
import { EventTitleModal } from './event-title-modal';
import { EventEditorModal } from './event-editor-modal';
import { applyUiLocale, UI_LOCALE } from './ui-locale';

interface DragSession {
	item: CalendarItem;
	targetDate?: PlainDate;
}

interface ResizeSession {
	item: CalendarItem;
	edge: ResizeEdge;
	pointerId: number;
	targetDate?: PlainDate;
}

const EMPTY_SNAPSHOT: CalendarIndexSnapshot = {
	items: [],
	issues: [],
	indexedCount: 0,
};

export class CalendarView extends ItemView {
	private calendarDocumentPath?: string;
	private instanceId = '';
	private config?: CalendarConfig;
	private configIssues: ConfigIssue[] = [];
	private indexError?: string;
	private focusDate: PlainDate = todayPlainDate();
	private snapshot = EMPTY_SNAPSHOT;
	private pendingSnapshot?: CalendarIndexSnapshot;
	private index?: CalendarIndex;
	private activeIndexPath?: string;
	private unsubscribeIndex?: () => void;
	private opened = false;
	private calendarDeleted = false;
	private dragSession?: DragSession;
	private resizeSession?: ResizeSession;
	private pendingScrollTop?: number;
	private todayRefreshTimer?: number;
	private todayRefreshWindow?: Window;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: CalendarViewPlugin,
	) {
		super(leaf);
		this.icon = 'calendar-days';
		this.register(() => this.clearTodayRefreshTimer());
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
		if (
			this.opened &&
			this.calendarDocumentPath &&
			(this.calendarDocumentPath !== nextPath || this.instanceId !== nextInstanceId)
		) {
			await this.persistUiState();
		}
		if (this.calendarDocumentPath !== nextPath) this.releaseActiveIndex();
		this.calendarDocumentPath = nextPath;
		this.instanceId = nextInstanceId;
		this.calendarDeleted = false;
		if (this.opened) await this.loadCalendar();
	}

	protected async onOpen(): Promise<void> {
		this.opened = true;
		this.scheduleTodayRefresh();
		applyUiLocale(this.contentEl);
		this.contentEl.addClass('calendar-view-root');
		this.contentEl.tabIndex = 0;
		this.plugin.registerViewInstance(this);
		this.registerDomEvent(this.contentEl, 'keydown', (event) => this.handleKeydown(event));
		const ownerWindow = this.contentEl.ownerDocument.defaultView;
		if (ownerWindow) {
			this.registerDomEvent(ownerWindow, 'focus', () => {
				if (!this.opened) return;
				this.refreshTodayHighlight();
				this.scheduleTodayRefresh();
			});
			this.registerDomEvent(ownerWindow, 'pointermove', (event) => this.handlePointerMove(event));
			this.registerDomEvent(ownerWindow, 'pointerup', (event) => {
				void this.handlePointerUp(event);
			});
			this.registerDomEvent(ownerWindow, 'pointercancel', () => this.clearInteractionPreview());
		}
		await this.loadCalendar();
	}

	protected async onClose(): Promise<void> {
		this.opened = false;
		this.clearTodayRefreshTimer();
		if (!this.calendarDeleted && this.calendarDocumentPath && this.instanceId && this.config) {
			await this.plugin.stateStore.set(this.calendarDocumentPath, this.instanceId, {
				focusDate: this.focusDate,
				layout: this.config.layout,
				scrollTop: this.contentEl.scrollTop,
			});
		}
		this.releaseActiveIndex();
		this.plugin.unregisterViewInstance(this);
	}

	async refreshCalendarDocument(): Promise<void> {
		if (this.dragSession || this.resizeSession) {
			this.clearInteractionPreview();
			new Notice('Calendar configuration changed. The active interaction was cancelled.');
		}
		await this.loadCalendar(true);
	}

	async handleCalendarRenamed(oldPath: string, newPath: string): Promise<void> {
		if (this.calendarDocumentPath !== oldPath) return;
		this.calendarDocumentPath = newPath;
		this.activeIndexPath = newPath;
		if (this.config) this.config = { ...this.config, documentPath: newPath };
		await this.loadCalendar(true);
		void this.app.workspace.requestSaveLayout();
	}

	handleCalendarDeleted(path: string): void {
		if (this.calendarDocumentPath !== path) return;
		this.calendarDeleted = true;
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
		this.unsubscribeIndex?.();
		if (this.activeIndexPath) this.plugin.indexes.release(this.activeIndexPath);
		this.unsubscribeIndex = undefined;
		this.index = undefined;
		this.activeIndexPath = undefined;
		this.config = undefined;
		this.configIssues = [];
		this.indexError = undefined;
		this.snapshot = EMPTY_SNAPSHOT;
		this.pendingSnapshot = undefined;
		this.clearInteractionPreview();
	}

	private async loadCalendar(isRefresh = false): Promise<void> {
		const path = this.calendarDocumentPath;
		if (!path) {
			this.config = undefined;
			this.configIssues = [
				{ field: 'calendar document', message: 'Choose a calendar document to continue.' },
			];
			this.render();
			return;
		}
		const file = this.app.vault.getFileByPath(path);
		if (!file) {
			this.config = undefined;
			this.configIssues = [{ field: 'calendar document', message: `File not found: ${path}` }];
			this.render();
			return;
		}
		const parsed = this.plugin.documents.read(file);
		if (!parsed.config) {
			this.configIssues = parsed.issues;
			this.render();
			return;
		}
		const nextConfig = parsed.config;
		this.configIssues = this.plugin.documents.validateLocations(nextConfig);
		const previousConfig = this.config;
		this.config = nextConfig;
		if (
			previousConfig &&
			(previousConfig.sourceFolder !== nextConfig.sourceFolder ||
				previousConfig.startDateProperty !== nextConfig.startDateProperty)
		) {
			this.focusDate = todayPlainDate();
		}

		try {
			if (!this.index || this.activeIndexPath !== path) {
				this.unsubscribeIndex?.();
				if (this.activeIndexPath) this.plugin.indexes.release(this.activeIndexPath);
				this.index = await this.plugin.indexes.acquire(nextConfig);
				this.activeIndexPath = path;
				this.unsubscribeIndex = this.index.subscribe((snapshot) => {
					if (this.dragSession || this.resizeSession) {
						this.pendingSnapshot = snapshot;
					} else {
						this.snapshot = snapshot;
						this.render();
					}
				});
			} else {
				await this.plugin.indexes.updateConfig(nextConfig);
			}
			this.indexError = undefined;
		} catch (error) {
			this.indexError = error instanceof Error ? error.message : 'Unable to index this calendar.';
			this.render();
			return;
		}

		if (!isRefresh || !previousConfig) {
			const stored = this.plugin.stateStore.get(path, this.instanceId);
			if (stored?.focusDate) this.focusDate = stored.focusDate;
			if (stored?.scrollTop !== undefined) this.pendingScrollTop = stored.scrollTop;
		}
		await this.plugin.stateStore.markRecent(path);
		this.render();
	}

	private render(): void {
		this.contentEl.empty();
		this.contentEl.addClass('calendar-view-root');
		const cardMetrics = calendarCardMetrics(this.config?.visibleProperties.length ?? 0);
		this.contentEl.style.setProperty('--cv-card-height', `${cardMetrics.height}px`);
		this.contentEl.style.setProperty('--cv-card-step', `${cardMetrics.step}px`);
		if (!this.config) {
			this.renderDocumentError();
			return;
		}

		const root = this.contentEl.createDiv({ cls: 'cv-shell' });
		this.renderViewToolbar(root);
		if (this.configIssues.length > 0) this.renderConfigBanner(root);
		this.renderDateToolbar(root);
		if (this.indexError) this.renderIndexError(root);
		if (!this.indexError && this.snapshot.items.length === 0) {
			root.createDiv({
				cls: 'cv-empty-hint',
				text: `No scheduled notes in ${this.config.sourceFolder || 'the vault root'} using ${this.config.startDateProperty}.`,
			});
		}
		this.renderGrid(root);
		if (this.pendingScrollTop !== undefined) {
			const scrollTop = this.pendingScrollTop;
			this.pendingScrollTop = undefined;
			this.contentEl.ownerDocument.defaultView?.requestAnimationFrame(() => {
				this.contentEl.scrollTop = scrollTop;
			});
		}
	}

	private scheduleTodayRefresh(): void {
		this.clearTodayRefreshTimer();
		const ownerWindow = this.contentEl.ownerDocument.defaultView;
		if (!ownerWindow || !this.opened) return;
		const now = new Date();
		const elapsedInMinute = now.getSeconds() * 1_000 + now.getMilliseconds();
		const delay = 60_000 - elapsedInMinute + 100;
		this.todayRefreshWindow = ownerWindow;
		this.todayRefreshTimer = ownerWindow.setTimeout(() => {
			this.todayRefreshTimer = undefined;
			this.todayRefreshWindow = undefined;
			if (!this.opened) return;
			this.refreshTodayHighlight();
			this.scheduleTodayRefresh();
		}, delay);
	}

	private clearTodayRefreshTimer(): void {
		if (this.todayRefreshTimer === undefined) return;
		this.todayRefreshWindow?.clearTimeout(this.todayRefreshTimer);
		this.todayRefreshTimer = undefined;
		this.todayRefreshWindow = undefined;
	}

	private refreshTodayHighlight(): void {
		const today = todayPlainDate();
		for (const cell of this.contentEl.querySelectorAll<HTMLElement>('.cv-day-cell')) {
			cell.toggleClass('is-today', cell.dataset.date === today);
		}
	}

	private renderDocumentError(): void {
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

	private renderViewToolbar(root: HTMLElement): void {
		if (!this.config) return;
		const toolbar = root.createDiv({ cls: 'cv-toolbar cv-view-toolbar' });
		const identity = toolbar.createDiv({ cls: 'cv-calendar-identity' });
		identity.createSpan({ cls: 'cv-calendar-name', text: this.config.name });
		const sourceButton = this.iconButton(identity, 'file-text', 'Open source document');
		sourceButton.addEventListener('click', () => void this.openSourceDocument());

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
		const newButton = actions.createEl('button', { text: 'New' });
		newButton.setAttribute('aria-label', `Create note on ${this.focusDate}`);
		newButton.addEventListener('click', () => this.createEvent(this.focusDate));
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

	private renderDateToolbar(root: HTMLElement): void {
		if (!this.config) return;
		const toolbar = root.createDiv({ cls: 'cv-toolbar cv-date-toolbar' });
		toolbar.createEl('h2', { cls: 'cv-interval-title', text: this.intervalTitle() });
		const actions = toolbar.createDiv({ cls: 'cv-toolbar-actions' });
		const previous = this.iconButton(actions, 'chevron-left', 'Previous interval');
		previous.addEventListener('click', () => this.navigate(-1));
		const today = actions.createEl('button', { text: 'Today' });
		today.addEventListener('click', () => this.setFocusDate(todayPlainDate()));
		const next = this.iconButton(actions, 'chevron-right', 'Next interval');
		next.addEventListener('click', () => this.navigate(1));
		const layout = actions.createEl('select', { cls: 'dropdown cv-layout-select' });
		layout.setAttribute('aria-label', 'Calendar layout');
		layout.createEl('option', { text: 'Month', value: 'month' });
		layout.createEl('option', { text: 'Week', value: 'week' });
		layout.value = this.config.layout;
		layout.addEventListener('change', () => {
			void this.changeLayout(layout.value === 'week' ? 'week' : 'month');
		});
	}

	private renderGrid(root: HTMLElement): void {
		if (!this.config) return;
		const weekStart = resolveWeekStart(this.config.weekStartsOn);
		const dates =
			this.config.layout === 'month'
				? monthGrid(this.focusDate, weekStart)
				: weekGrid(this.focusDate, weekStart);
		const grid = root.createDiv({ cls: `cv-calendar-grid is-${this.config.layout}` });
		const weekdayHeader = grid.createDiv({ cls: 'cv-weekday-header' });
		for (const date of dates.slice(0, 7)) {
			weekdayHeader.createDiv({ cls: 'cv-weekday', text: this.weekdayLabel(date) });
		}

		const segments = segmentCalendarItems(this.snapshot.items, dates);
		for (let weekIndex = 0; weekIndex < dates.length / 7; weekIndex += 1) {
			const week = grid.createDiv({ cls: 'cv-week-row' });
			week.style.setProperty(
				'--cv-visible-tracks',
				String(Math.max(1, visibleTrackCount(segments, weekIndex))),
			);
			const weekDates = dates.slice(weekIndex * 7, weekIndex * 7 + 7);
			for (const date of weekDates) {
				this.renderDayCell(week, date);
			}
			const segmentLayer = week.createDiv({ cls: 'cv-segment-layer' });
			for (const segment of segments) {
				if (segment.weekIndex === weekIndex) {
					this.renderSegment(segmentLayer, segment);
				}
			}
			week.addEventListener('dragover', (event) => {
				if (!this.dragSession) return;
				const date = this.dateFromWeekPoint(week, event.clientX);
				if (!date) return;
				event.preventDefault();
				this.updateDragPreview(date);
			});
			week.addEventListener('drop', (event) => {
				const date = this.dateFromWeekPoint(week, event.clientX);
				if (!date) return;
				event.preventDefault();
				void this.dropOnDate(date);
			});
		}
	}

	private renderDayCell(week: HTMLElement, date: PlainDate): void {
		const cell = week.createDiv({ cls: 'cv-day-cell' });
		cell.dataset.date = date;
		cell.tabIndex = 0;
		cell.setAttribute('role', 'gridcell');
		if (!sameMonth(date, this.focusDate) && this.config?.layout === 'month') {
			cell.addClass('is-outside-month');
		}
		const dayOfWeek = toUtcDate(date).getUTCDay();
		if (dayOfWeek === 0 || dayOfWeek === 6) cell.addClass('is-weekend');
		if (date === todayPlainDate()) cell.addClass('is-today');
		const header = cell.createDiv({ cls: 'cv-day-header' });
		const addButton = header.createEl('button', {
			cls: 'cv-add-day clickable-icon',
			attr: { type: 'button' },
		});
		setIcon(addButton, 'plus');
		addButton.setAttribute('aria-label', `Create note on ${date}`);
		addButton.setAttribute('title', `Create note on ${date}`);
		addButton.addEventListener('click', () => this.createEvent(date));
		header.createSpan({
			cls: 'cv-day-number',
			text: this.dayLabel(date),
		});
	}

	private renderSegment(layer: HTMLElement, segment: CalendarSegment): void {
		if (!this.config) return;
		const card = layer.createDiv({ cls: 'cv-event-card cv-color-token' });
		card.dataset.path = segment.item.path;
		card.dataset.color = segment.item.color ?? 'default';
		card.style.setProperty('--cv-column-start', String(segment.startColumn));
		card.style.setProperty('--cv-span', String(segment.span));
		card.style.setProperty('--cv-track', String(segment.track));
		card.tabIndex = 0;
		card.setAttribute('role', 'button');
		card.setAttribute('aria-label', `${segment.item.title}, ${segment.item.start}`);
		card.setAttribute('title', segment.item.title);
		card.draggable = true;
		if (segment.item.end) card.addClass('is-multiday');
		if (segment.continuesBefore) card.addClass('continues-before');
		if (segment.continuesAfter) card.addClass('continues-after');

		card.createDiv({ cls: 'cv-card-title', text: segment.item.title });
		renderCardProperties(
			this.app,
			card,
			segment.item,
			this.config.visibleProperties,
			this.config.propertyDefinitions,
			this.config.cardColorProperty,
		);
		card.addEventListener('click', (event) => {
			if ((event.target as HTMLElement).closest('.cv-resize-handle')) return;
			void this.openItem(segment.item, event.metaKey || event.ctrlKey);
		});
		card.addEventListener('auxclick', (event) => {
			if (event.button === 1) void this.openItem(segment.item, true);
		});
		card.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				void this.openItem(segment.item, event.metaKey || event.ctrlKey);
			}
		});
		card.addEventListener('dragstart', (event) => {
			this.dragSession = { item: segment.item };
			event.dataTransfer?.setData('text/plain', segment.item.path);
			if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
			this.markOriginalCards(segment.item.path, true);
		});
		card.addEventListener('dragend', () => this.clearInteractionPreview());

		if (this.config.endDateProperty && !segment.continuesBefore) {
			this.renderResizeHandle(card, segment.item, 'start');
		}
		if (this.config.endDateProperty && !segment.continuesAfter) {
			this.renderResizeHandle(card, segment.item, 'end');
		}
	}

	private renderResizeHandle(card: HTMLElement, item: CalendarItem, edge: ResizeEdge): void {
		const handle = card.createDiv({ cls: `cv-resize-handle is-${edge}` });
		handle.setAttribute('role', 'separator');
		handle.setAttribute('aria-label', `Resize ${edge} date for ${item.title}`);
		handle.tabIndex = 0;
		handle.addEventListener('pointerdown', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.resizeSession = { item, edge, pointerId: event.pointerId };
			this.markOriginalCards(item.path, true);
			this.markPreviewRange({ start: item.start, end: item.end });
		});
		handle.addEventListener('keydown', (event) => {
			if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
			event.preventDefault();
			event.stopPropagation();
			const current = edge === 'start' ? item.start : (item.end ?? item.start);
			const target = addDays(current, event.key === 'ArrowLeft' ? -1 : 1);
			try {
				const next = resizeDateRange(item.start, item.end, edge, target);
				void this.writeDateRange(item, next).catch((error: unknown) => {
					new Notice(error instanceof Error ? error.message : 'Unable to resize event.');
				});
			} catch (error) {
				new Notice(error instanceof Error ? error.message : 'Unable to resize event.');
			}
		});
	}

	private handlePointerMove(event: PointerEvent): void {
		const session = this.resizeSession;
		if (!session || session.pointerId !== event.pointerId) return;
		const date = this.dateFromPoint(event.clientX, event.clientY);
		if (!date) return;
		try {
			const next = resizeDateRange(session.item.start, session.item.end, session.edge, date);
			session.targetDate = date;
			this.markPreviewRange(next);
		} catch {
			this.clearDatePreviewClasses();
		}
	}

	private async handlePointerUp(event: PointerEvent): Promise<void> {
		const session = this.resizeSession;
		if (!session || session.pointerId !== event.pointerId) return;
		this.resizeSession = undefined;
		if (!session.targetDate) {
			this.clearInteractionPreview();
			return;
		}
		try {
			const next = resizeDateRange(
				session.item.start,
				session.item.end,
				session.edge,
				session.targetDate,
			);
			await this.writeDateRange(session.item, next);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : 'Unable to resize event.');
		} finally {
			this.clearInteractionPreview();
		}
	}

	private updateDragPreview(targetDate: PlainDate): void {
		if (!this.dragSession) return;
		this.dragSession.targetDate = targetDate;
		this.markPreviewRange(
			moveDateRange(
				this.dragSession.item.start,
				this.dragSession.item.end,
				targetDate,
			),
		);
	}

	private async dropOnDate(date: PlainDate): Promise<void> {
		const session = this.dragSession;
		if (!session) return;
		try {
			const next = moveDateRange(session.item.start, session.item.end, date);
			await this.writeDateRange(session.item, next);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : 'Unable to move event.');
		} finally {
			this.clearInteractionPreview();
		}
	}

	private async writeDateRange(item: CalendarItem, range: DateRange): Promise<void> {
		if (!this.config) return;
		await this.plugin.writer.updateDateRange(
			item.path,
			item.mtime,
			{
				startProperty: this.config.startDateProperty,
				endProperty: this.config.endDateProperty,
			},
			range,
		);
		const file = this.app.vault.getFileByPath(item.path);
		this.snapshot = {
			...this.snapshot,
			items: this.snapshot.items.map((candidate) => {
				if (candidate.path !== item.path) return candidate;
				const properties = { ...candidate.properties };
				const startProperty = this.config?.startDateProperty ?? 'date';
				properties[startProperty] = replaceCalendarDatePart(
					properties[startProperty],
					range.start,
				);
				if (this.config?.endDateProperty) {
					if (range.end) {
						properties[this.config.endDateProperty] = replaceCalendarDatePart(
							properties[this.config.endDateProperty] ?? properties[startProperty],
							range.end,
						);
					} else delete properties[this.config.endDateProperty];
				}
				const updated: CalendarItem = {
					...candidate,
					start: range.start,
					properties,
					mtime: file?.stat.mtime ?? candidate.mtime,
				};
				if (range.end) updated.end = range.end;
				else delete updated.end;
				return updated;
			}),
		};
		this.render();
	}

	private markPreviewRange(range: DateRange): void {
		this.clearDatePreviewClasses();
		const end = range.end ?? range.start;
		for (const cell of this.contentEl.querySelectorAll<HTMLElement>('.cv-day-cell')) {
			const date = cell.dataset.date;
			if (date && compareDates(date, range.start) >= 0 && compareDates(date, end) <= 0) {
				cell.addClass('is-drag-target');
			}
		}
	}

	private clearDatePreviewClasses(): void {
		for (const cell of this.contentEl.querySelectorAll<HTMLElement>('.is-drag-target')) {
			cell.removeClass('is-drag-target');
		}
	}

	private markOriginalCards(path: string, active: boolean): void {
		for (const card of this.contentEl.querySelectorAll<HTMLElement>('.cv-event-card')) {
			if (card.dataset.path === path) card.toggleClass('is-dragging', active);
		}
	}

	private clearInteractionPreview(): void {
		if (this.dragSession) this.markOriginalCards(this.dragSession.item.path, false);
		if (this.resizeSession) this.markOriginalCards(this.resizeSession.item.path, false);
		this.dragSession = undefined;
		this.resizeSession = undefined;
		this.clearDatePreviewClasses();
		if (this.pendingSnapshot) {
			this.snapshot = this.pendingSnapshot;
			this.pendingSnapshot = undefined;
			this.render();
		}
	}

	private dateFromPoint(clientX: number, clientY: number): PlainDate | undefined {
		for (const week of this.contentEl.querySelectorAll<HTMLElement>('.cv-week-row')) {
			const bounds = week.getBoundingClientRect();
			if (clientY >= bounds.top && clientY <= bounds.bottom) {
				return this.dateFromWeekPoint(week, clientX);
			}
		}
		return undefined;
	}

	private dateFromWeekPoint(week: HTMLElement, clientX: number): PlainDate | undefined {
		const bounds = week.getBoundingClientRect();
		if (clientX < bounds.left || clientX > bounds.right || bounds.width <= 0) return undefined;
		const column = Math.min(6, Math.floor(((clientX - bounds.left) / bounds.width) * 7));
		return week.querySelectorAll<HTMLElement>('.cv-day-cell')[column]?.dataset.date;
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

	private async openItem(item: CalendarItem, newLeaf: boolean): Promise<void> {
		const file = this.app.vault.getFileByPath(item.path);
		if (!file) {
			new Notice(`${item.path} was moved or deleted. The calendar will refresh.`);
			this.plugin.indexes.handleFileDeleted(item.path);
			return;
		}
		if (!newLeaf && this.config) {
			new EventEditorModal(this.plugin, this.config, item).open();
			return;
		}
		await this.plugin.openAdapter.openMarkdownFile(file, true);
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

	private openSettings(): void {
		if (!this.config) return;
		new CalendarSettingsModal(this.plugin, this.config, async (config) => {
			await this.applyConfig(config);
		}).open();
	}

	private createEvent(date: PlainDate): void {
		if (!this.config) return;
		new EventTitleModal(this.plugin, this.config, date).open();
	}

	private navigate(direction: -1 | 1): void {
		if (!this.config) return;
		this.setFocusDate(
			this.config.layout === 'month'
				? addMonths(this.focusDate, direction)
				: addDays(this.focusDate, direction * 7),
		);
	}

	private setFocusDate(date: PlainDate): void {
		this.focusDate = date;
		void this.persistUiState();
		this.render();
	}

	private async changeLayout(layout: CalendarConfig['layout']): Promise<void> {
		if (!this.config || this.config.layout === layout) return;
		const next = { ...this.config, layout };
		try {
			await this.plugin.documents.save(next);
			await this.applyConfig(next);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : 'Unable to change layout.');
			this.render();
		}
	}

	private async applyConfig(config: CalendarConfig): Promise<void> {
		const previous = this.config;
		this.config = config;
		this.configIssues = this.plugin.documents.validateLocations(config);
		if (
			previous &&
			(previous.sourceFolder !== config.sourceFolder ||
				previous.startDateProperty !== config.startDateProperty)
		) {
			this.focusDate = todayPlainDate();
		}
		await this.plugin.indexes.updateConfig(config);
		await this.persistUiState();
		this.render();
	}

	private async persistUiState(): Promise<void> {
		if (!this.calendarDocumentPath || !this.instanceId || !this.config) return;
		await this.plugin.stateStore.set(this.calendarDocumentPath, this.instanceId, {
			focusDate: this.focusDate,
			layout: this.config.layout,
			scrollTop: this.contentEl.scrollTop,
		});
	}

	private handleKeydown(event: KeyboardEvent): void {
		if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) return;
		const target = event.target as HTMLElement;
		if (target.matches('input, textarea, select')) return;
		let nextDate: PlainDate | undefined;
		if (event.key.toLocaleLowerCase() === 't') nextDate = todayPlainDate();
		else if (event.key === 'ArrowLeft') nextDate = addDays(this.focusDate, -1);
		else if (event.key === 'ArrowRight') nextDate = addDays(this.focusDate, 1);
		else if (event.key === 'ArrowUp') nextDate = addDays(this.focusDate, -7);
		else if (event.key === 'ArrowDown') nextDate = addDays(this.focusDate, 7);
		else if (event.key === 'Enter' && target === this.contentEl) {
			this.createEvent(this.focusDate);
			event.preventDefault();
			return;
		} else if (event.key === 'Escape') {
			this.clearInteractionPreview();
			return;
		}
		if (nextDate) {
			event.preventDefault();
			this.setFocusDate(nextDate);
		}
	}

	private intervalTitle(): string {
		if (this.config?.layout === 'week') {
			const dates = weekGrid(this.focusDate, resolveWeekStart(this.config.weekStartsOn));
			const first = dates[0] ?? this.focusDate;
			const last = dates.at(-1) ?? this.focusDate;
			return `${this.shortDate(first)} – ${this.shortDate(last)}`;
		}
		return new Intl.DateTimeFormat(UI_LOCALE, {
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC',
		}).format(toUtcDate(this.focusDate));
	}

	private shortDate(date: PlainDate): string {
		return new Intl.DateTimeFormat(UI_LOCALE, {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			timeZone: 'UTC',
		}).format(toUtcDate(date));
	}

	private weekdayLabel(date: PlainDate): string {
		return new Intl.DateTimeFormat(UI_LOCALE, {
			weekday: 'short',
			timeZone: 'UTC',
		}).format(toUtcDate(date));
	}

	private dayLabel(date: PlainDate): string {
		const parsed = toUtcDate(date);
		if (parsed.getUTCDate() !== 1) return String(parsed.getUTCDate());
		return new Intl.DateTimeFormat(UI_LOCALE, {
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC',
		}).format(parsed);
	}

	private iconButton(parent: HTMLElement, icon: string, label: string): HTMLButtonElement {
		const button = parent.createEl('button', { cls: 'clickable-icon' });
		button.setAttribute('aria-label', label);
		button.setAttribute('title', label);
		setIcon(button, icon);
		return button;
	}
}
