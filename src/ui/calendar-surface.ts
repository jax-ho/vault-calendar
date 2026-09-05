import { Component, Menu, Notice, setIcon } from 'obsidian';
import { calendarCardMetrics } from '../domain/card-layout';
import {
	addDays,
	addMonths,
	compareDates,
	isPlainDate,
	monthGrid,
	resolveWeekStart,
	sameMonth,
	todayPlainDate,
	toUtcDate,
	weekGrid,
	type PlainDate,
} from '../domain/dates';
import { replaceCalendarDatePart } from '../domain/frontmatter-mutation';
import {
	moveDateRange,
	resizeDateRange,
	type DateRange,
	type ResizeEdge,
} from '../domain/interactions';
import {
	segmentCalendarItems,
	type CalendarSegment,
	visibleTrackCount,
} from '../domain/range-layout';
import type {
	CalendarConfig,
	CalendarIndexSnapshot,
	CalendarItem,
	CalendarSavedView,
	SavedViewCatalogEntry,
	SavedViewUiState,
} from '../types';
import {
	calendarRelationshipAccessibleSummary,
	calendarRelationshipRowCount,
	renderCardProperties,
	renderCardRelationships,
} from './calendar-card';
import { EventEditorModal } from './event-editor-modal';
import { EventTitleModal } from './event-title-modal';
import { applyUiLocale, UI_LOCALE } from './ui-locale';
import type {
	ViewSurface,
	ViewSurfaceDependencies,
	ViewSurfaceInput,
} from './view-surface';

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

export type CalendarSurfaceState = Extract<SavedViewUiState, { type: 'calendar' }>;
export type CalendarSurfaceInput = ViewSurfaceInput<CalendarSavedView>;

export function replaceCalendarViewDefinition(
	config: CalendarConfig,
	definition: CalendarSavedView,
): CalendarConfig {
	const next: CalendarConfig = {
		...config,
		layout: definition.layout,
		weekStartsOn: definition.weekStartsOn,
	};
	if (!config.viewCatalog) return next;
	const entries: SavedViewCatalogEntry[] = config.viewCatalog.entries.map((entry) => {
		if (
			entry.kind !== 'valid' ||
			entry.definition.type !== 'calendar' ||
			entry.definition.id !== definition.id
		) {
			return entry;
		}
		return { ...entry, definition: { ...definition } };
	});
	return {
		...next,
		viewCatalog: { ...config.viewCatalog, entries },
	};
}

export class CalendarSurface extends Component implements ViewSurface<
	CalendarSavedView,
	CalendarSurfaceState
> {
	private container?: HTMLElement;
	private definition?: CalendarSavedView;
	private config?: CalendarConfig;
	private indexError?: string;
	private focusDate: PlainDate = todayPlainDate();
	private snapshot: CalendarIndexSnapshot = {
		items: [],
		issues: [],
		indexedCount: 0,
	};
	private pendingInput?: CalendarSurfaceInput;
	private dragSession?: DragSession;
	private resizeSession?: ResizeSession;
	private pendingScrollTop?: number;
	private todayRefreshTimer?: number;
	private todayRefreshWindow?: Window;
	private mounted = false;
	private mountGeneration = 0;

	constructor(private readonly dependencies: ViewSurfaceDependencies) {
		super();
	}

	mount(container: HTMLElement, input: CalendarSurfaceInput): void {
		if (this.mounted) throw new Error('Calendar surface is already mounted.');
		this.mountGeneration += 1;
		this.container = container;
		this.applyInput(input);
		if (input.state?.type === 'calendar' && isPlainDate(input.state.focusDate)) {
			this.focusDate = input.state.focusDate;
			this.pendingScrollTop = input.state.scrollTop;
		}
		this.mounted = true;
		this.load();
		this.render();
	}

	update(input: CalendarSurfaceInput): void {
		if (!this.mounted) throw new Error('Calendar surface is not mounted.');
		if (this.dragSession || this.resizeSession) {
			this.pendingInput = input;
			return;
		}
		this.applyInput(input);
		this.render();
	}

	primaryAction(): { label: string; ariaLabel: string; run(): void } {
		const date = this.focusDate;
		return {
			label: 'New',
			ariaLabel: `Create note on ${date}`,
			run: () => this.createEvent(date),
		};
	}

	cancelInteraction(message?: string): void {
		const hadInteraction = Boolean(this.dragSession || this.resizeSession);
		this.clearInteractionPreview();
		if (hadInteraction && message) new Notice(message);
	}

	deactivate(): CalendarSurfaceState {
		this.cancelInteraction();
		const state = this.currentState();
		this.mounted = false;
		this.unload();
		this.container = undefined;
		return state;
	}

	onload(): void {
		const container = this.container;
		if (!container) return;
		const root = this.scrollContainer();
		applyUiLocale(root);
		root.addClass('calendar-view-root');
		root.tabIndex = 0;
		this.registerDomEvent(root, 'keydown', (event) => this.handleKeydown(event));
		this.registerDomEvent(root, 'contextmenu', (event) => {
			this.openItemMenu(event);
		});
		const ownerWindow = root.ownerDocument.defaultView;
		if (ownerWindow) {
			this.registerDomEvent(ownerWindow, 'focus', () => {
				if (!this.mounted) return;
				this.refreshTodayHighlight();
				this.scheduleTodayRefresh();
			});
			this.registerDomEvent(ownerWindow, 'pointermove', (event) => {
				this.handlePointerMove(event);
			});
			this.registerDomEvent(ownerWindow, 'pointerup', (event) => {
				void this.handlePointerUp(event);
			});
			this.registerDomEvent(ownerWindow, 'pointercancel', (event) => {
				if (this.resizeSession?.pointerId === event.pointerId) {
					this.clearInteractionPreview();
				}
			});
		}
		this.scheduleTodayRefresh();
	}

	onunload(): void {
		this.clearTodayRefreshTimer();
	}

	private applyInput(input: CalendarSurfaceInput): void {
		const previous = this.config;
		this.definition = input.definition;
		this.config = replaceCalendarViewDefinition(input.config, input.definition);
		this.snapshot = input.snapshot;
		this.indexError = input.indexError;
		if (
			previous &&
			(previous.sourceFolder !== this.config.sourceFolder ||
				previous.startDateProperty !== this.config.startDateProperty)
		) {
			this.focusDate = todayPlainDate();
		}
	}

	private currentState(): CalendarSurfaceState {
		return {
			type: 'calendar',
			focusDate: this.focusDate,
			scrollTop: this.scrollContainer().scrollTop,
		};
	}

	private render(): void {
		const container = this.container;
		if (!container || !this.config || !this.definition) return;
		container.empty();
		const relationshipRows = this.snapshot.items.reduce(
			(maximum, item) => Math.max(maximum, calendarRelationshipRowCount(item)),
			0,
		);
		const cardMetrics = calendarCardMetrics(
			this.config.visibleProperties.length,
			relationshipRows,
		);
		const root = this.scrollContainer();
		root.style.setProperty('--cv-card-height', `${cardMetrics.height}px`);
		root.style.setProperty('--cv-card-step', `${cardMetrics.step}px`);

		this.renderDateToolbar(container);
		if (!this.indexError && this.snapshot.items.length === 0) {
			container.createDiv({
				cls: 'cv-empty-hint',
				text: `No scheduled notes in ${this.config.sourceFolder || 'the vault root'} using ${this.config.startDateProperty}.`,
			});
		}
		this.renderGrid(container);
		if (this.pendingScrollTop !== undefined) {
			const scrollTop = this.pendingScrollTop;
			this.pendingScrollTop = undefined;
			root.ownerDocument.defaultView?.requestAnimationFrame(() => {
				if (this.mounted && this.container === container) root.scrollTop = scrollTop;
			});
		}
	}

	private scrollContainer(): HTMLElement {
		const container = this.container;
		if (!container) throw new Error('Calendar surface is not mounted.');
		return container.closest<HTMLElement>('.calendar-view-root') ?? container;
	}

	private scheduleTodayRefresh(): void {
		this.clearTodayRefreshTimer();
		const ownerWindow = this.container?.ownerDocument.defaultView;
		if (!ownerWindow || !this.mounted) return;
		const now = new Date();
		const elapsedInMinute = now.getSeconds() * 1_000 + now.getMilliseconds();
		const delay = 60_000 - elapsedInMinute + 100;
		this.todayRefreshWindow = ownerWindow;
		this.todayRefreshTimer = ownerWindow.setTimeout(() => {
			this.todayRefreshTimer = undefined;
			this.todayRefreshWindow = undefined;
			if (!this.mounted) return;
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
		for (const cell of this.container?.querySelectorAll<HTMLElement>('.cv-day-cell') ?? []) {
			cell.toggleClass('is-today', cell.dataset.date === today);
		}
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
			for (const date of weekDates) this.renderDayCell(week, date);
			const segmentLayer = week.createDiv({ cls: 'cv-segment-layer' });
			for (const segment of segments) {
				if (segment.weekIndex === weekIndex) this.renderSegment(segmentLayer, segment);
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
		header.createSpan({ cls: 'cv-day-number', text: this.dayLabel(date) });
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
		const relationshipSummary = calendarRelationshipAccessibleSummary(segment.item);
		card.setAttribute(
			'aria-label',
			[segment.item.title, segment.item.start, relationshipSummary]
				.filter(Boolean)
				.join(', '),
		);
		card.setAttribute('title', segment.item.title);
		card.draggable = true;
		if (segment.item.end) card.addClass('is-multiday');
		if (segment.continuesBefore) card.addClass('continues-before');
		if (segment.continuesAfter) card.addClass('continues-after');

		card.createDiv({ cls: 'cv-card-title', text: segment.item.title });
		renderCardRelationships(card, segment.item);
		renderCardProperties(
			this.dependencies.plugin.app,
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
			if (event.key === 'Enter' || event.key === ' ') {
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
			moveDateRange(this.dragSession.item.start, this.dragSession.item.end, targetDate),
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
		await this.dependencies.plugin.writer.updateDateRange(
			item.path,
			item.mtime,
			{
				startProperty: this.config.startDateProperty,
				endProperty: this.config.endDateProperty,
			},
			range,
		);
		const file = this.dependencies.plugin.app.vault.getFileByPath(item.path);
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
		for (const cell of this.container?.querySelectorAll<HTMLElement>('.cv-day-cell') ?? []) {
			const date = cell.dataset.date;
			if (date && compareDates(date, range.start) >= 0 && compareDates(date, end) <= 0) {
				cell.addClass('is-drag-target');
			}
		}
	}

	private clearDatePreviewClasses(): void {
		for (const cell of this.container?.querySelectorAll<HTMLElement>('.is-drag-target') ?? []) {
			cell.removeClass('is-drag-target');
		}
	}

	private markOriginalCards(path: string, active: boolean): void {
		for (const card of this.container?.querySelectorAll<HTMLElement>('.cv-event-card') ?? []) {
			if (card.dataset.path === path) card.toggleClass('is-dragging', active);
		}
	}

	private clearInteractionPreview(): void {
		if (this.dragSession) this.markOriginalCards(this.dragSession.item.path, false);
		if (this.resizeSession) this.markOriginalCards(this.resizeSession.item.path, false);
		this.dragSession = undefined;
		this.resizeSession = undefined;
		this.clearDatePreviewClasses();
		const pendingInput = this.pendingInput;
		this.pendingInput = undefined;
		if (pendingInput) this.applyInput(pendingInput);
		if (pendingInput && this.mounted) this.render();
	}

	private dateFromPoint(clientX: number, clientY: number): PlainDate | undefined {
		for (const week of this.container?.querySelectorAll<HTMLElement>('.cv-week-row') ?? []) {
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

	private async openItem(item: CalendarItem, newLeaf: boolean): Promise<void> {
		const plugin = this.dependencies.plugin;
		const file = plugin.app.vault.getFileByPath(item.path);
		if (!file) {
			new Notice(`${item.path} was moved or deleted. The calendar will refresh.`);
			plugin.indexes.handleFileDeleted(item.path);
			return;
		}
		if (!newLeaf && this.config) {
			const index = this.dependencies.getActiveIndex();
			new EventEditorModal(plugin, this.config, item, {
				parentItems: index?.parentCandidatesFor(item.path) ?? [],
				validateParentItem: (value) => index?.validateParentItem(item.path, value),
			}).open();
			return;
		}
		await plugin.openAdapter.openMarkdownFile(file, true);
	}

	private openItemMenu(event: MouseEvent): void {
		const targetNode = event.targetNode;
		const target =
			targetNode?.nodeType === 1
				? (targetNode as HTMLElement)
				: targetNode?.parentElement;
		const card = target?.closest<HTMLElement>('.cv-event-card');
		const path = card?.dataset.path;
		if (!card || !path || !this.container?.contains(card)) return;
		event.preventDefault();
		event.stopPropagation();
		const menu = new Menu();
		menu.addItem((menuItem) => {
			menuItem
				.setTitle('Move to trash')
				.setIcon('trash-2')
				.setWarning(true)
				.onClick(() => {
					void this.moveItemToTrash(path);
				});
		});
		menu.showAtMouseEvent(event);
	}

	private async moveItemToTrash(path: string): Promise<void> {
		const plugin = this.dependencies.plugin;
		const file = plugin.app.vault.getFileByPath(path);
		if (!file) {
			new Notice(`${path} was moved or deleted. The calendar will refresh.`);
			plugin.indexes.handleFileDeleted(path);
			return;
		}
		try {
			await plugin.app.fileManager.trashFile(file);
		} catch (error) {
			new Notice(
				error instanceof Error ? error.message : 'Unable to move event to trash.',
			);
		}
	}

	private createEvent(date: PlainDate): void {
		if (!this.config) return;
		new EventTitleModal(
			this.dependencies.plugin,
			this.config,
			date,
			this.dependencies.getActiveIndex()?.parentCandidatesFor() ?? [],
		).open();
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
		if (
			!this.mounted ||
			!this.config ||
			!this.definition ||
			this.definition.layout === layout
		) {
			return;
		}
		const mountGeneration = this.mountGeneration;
		const config = this.config;
		const definition: CalendarSavedView = { ...this.definition, layout };
		try {
			const viewCatalog = await this.dependencies.plugin.savedViews.commit(
				config.documentPath,
				{
					kind: 'configure-calendar',
					viewId: definition.id,
					layout: definition.layout,
					weekStartsOn: definition.weekStartsOn,
				},
			);
			if (!this.isCurrentMount(mountGeneration, definition.id)) return;
			await this.applySavedViewCatalog(
				viewCatalog,
				mountGeneration,
				definition.id,
			);
		} catch (error) {
			if (!this.isCurrentMount(mountGeneration, definition.id)) return;
			new Notice(error instanceof Error ? error.message : 'Unable to change layout.');
			this.render();
		}
	}

	private async applySavedViewCatalog(
		catalog: NonNullable<CalendarConfig['viewCatalog']>,
		mountGeneration: number,
		viewId: string,
	): Promise<void> {
		if (!this.isCurrentMount(mountGeneration, viewId)) return;
		await this.dependencies.applySavedViewCatalog(catalog);
		if (!this.isCurrentMount(mountGeneration, viewId)) return;
		await this.persistUiState();
	}

	private isCurrentMount(mountGeneration: number, viewId: string): boolean {
		return (
			this.mounted &&
			this.mountGeneration === mountGeneration &&
			this.definition?.id === viewId
		);
	}

	private async persistUiState(): Promise<void> {
		if (!this.definition) return;
		await this.dependencies.persistUiState(this.definition.id, this.currentState());
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
		else if (event.key === 'Enter' && target === this.scrollContainer()) {
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

export function createCalendarSurface(
	dependencies: ViewSurfaceDependencies,
): CalendarSurface {
	return new CalendarSurface(dependencies);
}
