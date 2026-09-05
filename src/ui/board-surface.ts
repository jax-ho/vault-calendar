import { Menu, Notice } from 'obsidian';
import { projectBoardColumns } from '../domain/board-projection';
import { todayPlainDate } from '../domain/dates';
import { writableBoardGroupProperties } from '../domain/saved-view-form';
import { isWritableBoardGroupProperty, validSavedViews } from '../domain/saved-views';
import {
	resolvedSelectValue,
	selectPropertyOptions,
} from '../domain/property-values';
import {
	BoardCardMover,
	type BoardCardMoveResult,
	type ResolvedBoardView,
} from '../services/board-card-mover';
import type {
	BoardSavedView,
	CalendarItem,
	SavedViewUiState,
} from '../types';
import {
	calendarRelationshipAccessibleSummary,
	renderCardProperties,
	renderCardRelationships,
} from './calendar-card';
import { EventEditorModal } from './event-editor-modal';
import { EventTitleModal } from './event-title-modal';
import type {
	ViewSurface,
	ViewSurfaceDependencies,
	ViewSurfaceFactory,
	ViewSurfaceInput,
	ViewSurfacePrimaryAction,
} from './view-surface';

export type BoardSurfaceState = Extract<SavedViewUiState, { type: 'board' }>;

interface BoardDragSession {
	viewId: string;
	item: CalendarItem;
	groupBy: string;
	sourceValue: string;
}

interface PendingMove {
	baselineMtime: number;
	groupBy: string;
	targetValue: string;
}

const BOARD_AUTO_SCROLL_EDGE = 56;
const BOARD_AUTO_SCROLL_STEP = 24;

function boardDateLabel(item: CalendarItem): string {
	return item.end ? `${item.start} – ${item.end}` : item.start;
}

export class BoardSurface
	implements ViewSurface<BoardSavedView, BoardSurfaceState>
{
	private container?: HTMLElement;
	private root?: HTMLElement;
	private input?: ViewSurfaceInput<BoardSavedView>;
	private queuedInput?: ViewSurfaceInput<BoardSavedView>;
	private dragSession?: BoardDragSession;
	private moveInProgress = false;
	private moveAbortController?: AbortController;
	private interactionGeneration = 0;
	private readonly pendingMoves = new Map<string, PendingMove>();
	private readonly renderCleanups: Array<() => void> = [];
	private mover: BoardCardMover;

	constructor(private readonly dependencies: ViewSurfaceDependencies) {
		this.mover = new BoardCardMover(
			(viewId) => this.resolveLatestBoardView(viewId),
			dependencies.plugin.writer,
		);
	}

	mount(
		container: HTMLElement,
		input: ViewSurfaceInput<BoardSavedView>,
	): void {
		if (this.root) this.deactivate();
		this.container = container;
		this.input = input;
		this.queuedInput = undefined;
		this.pendingMoves.clear();
		container.empty();
		this.root = container.createDiv({ cls: 'cv-board-surface' });
		this.render();

		if (input.state?.type === 'board') {
			this.root.scrollLeft = input.state.scrollLeft ?? 0;
			const verticalScrollContainer = this.verticalScrollContainer();
			if (verticalScrollContainer) {
				verticalScrollContainer.scrollTop = input.state.scrollTop ?? 0;
			}
		}
	}

	update(input: ViewSurfaceInput<BoardSavedView>): void {
		if (!this.root) return;
		if (this.dragSession || this.moveInProgress) {
			this.queuedInput = input;
			return;
		}
		this.input = input;
		this.reconcilePendingMoves();
		this.render();
	}

	primaryAction(): ViewSurfacePrimaryAction {
		const date = todayPlainDate();
		return {
			label: 'New',
			ariaLabel: `Create note on ${date}`,
			run: () => this.createEvent(todayPlainDate()),
		};
	}

	cancelInteraction(message?: string): void {
		const hadInteraction = Boolean(this.dragSession || this.moveInProgress);
		if (!hadInteraction) return;

		this.interactionGeneration += 1;
		this.moveAbortController?.abort();
		this.moveAbortController = undefined;
		this.dragSession = undefined;
		this.moveInProgress = false;
		this.clearDragPreview();
		this.consumeQueuedInput();
		this.render();
		if (message) new Notice(message);
	}

	deactivate(): BoardSurfaceState {
		const state: BoardSurfaceState = {
			type: 'board',
			scrollLeft: this.root?.scrollLeft ?? 0,
			scrollTop: this.verticalScrollContainer()?.scrollTop ?? 0,
		};
		this.cancelInteraction();
		this.clearRenderListeners();
		this.root?.remove();
		this.container = undefined;
		this.root = undefined;
		this.input = undefined;
		this.queuedInput = undefined;
		this.pendingMoves.clear();
		return state;
	}

	private verticalScrollContainer(): HTMLElement | undefined {
		const root = this.root;
		return root?.closest<HTMLElement>('.calendar-view-root') ?? root;
	}

	private render(): void {
		const root = this.root;
		const input = this.input;
		if (!root || !input) return;

		this.clearRenderListeners();
		root.empty();

		const groupBy = input.definition.groupBy;
		if (!groupBy) {
			const canChooseGroup = writableBoardGroupProperties(input.config).length > 0;
			const canMutateViews = input.config.viewCatalog?.canMutate ?? false;
			this.renderState(
				root,
				'cv-board-setup',
				canMutateViews
					? 'Choose a Select property in Edit view to group this Board.'
					: 'Repair the saved-view configuration in the source document before editing this Board.',
				canMutateViews
					? canChooseGroup
						? 'Edit view'
						: 'Open properties'
					: undefined,
				canMutateViews
					? canChooseGroup
						? () => this.dependencies.editView(input.definition)
						: () => this.dependencies.openProperties()
					: undefined,
			);
			return;
		}
		if (!isWritableBoardGroupProperty(input.config, groupBy)) {
			const canChooseGroup = writableBoardGroupProperties(input.config).length > 0;
			const canMutateViews = input.config.viewCatalog?.canMutate ?? false;
			this.renderState(
				root,
				'cv-board-error',
				`The Board group property is unavailable: ${groupBy}`,
				canMutateViews
					? canChooseGroup
						? 'Edit view'
						: 'Open properties'
					: undefined,
				canMutateViews
					? canChooseGroup
						? () => this.dependencies.editView(input.definition)
						: () => this.dependencies.openProperties()
					: undefined,
			);
			return;
		}

		const definition = input.config.propertyDefinitions[groupBy];
		if (!definition) return;
		const columns = projectBoardColumns(
			input.snapshot.items,
			input.definition,
			definition,
		);
		if (!input.indexError && input.snapshot.items.length === 0) {
			root.createDiv({ cls: 'cv-empty-hint', text: 'No scheduled notes.' });
		}

		const fragment = root.ownerDocument.createDocumentFragment();
		const columnsElement = root.ownerDocument.createElement('div');
		columnsElement.addClass('cv-board-columns');
		columnsElement.setAttribute('role', 'list');
		this.listen(root, 'dragover', (event: DragEvent) => {
			if (!this.dragSession || this.moveInProgress) return;
			event.preventDefault();
			this.autoScroll(event.clientX);
		});
		for (const column of columns) {
			const columnElement = columnsElement.createDiv({ cls: 'cv-board-column' });
			columnElement.dataset.value = column.value;
			columnElement.setAttribute('role', 'group');
			columnElement.setAttribute(
				'aria-label',
				`${column.value}, ${column.items.length} ${column.items.length === 1 ? 'card' : 'cards'}`,
			);
			const header = columnElement.createDiv({ cls: 'cv-board-column-header' });
			header.createSpan({ cls: 'cv-board-column-name', text: column.value });
			header.createSpan({
				cls: 'cv-board-column-count',
				text: String(column.items.length),
			});
			const cards = columnElement.createDiv({ cls: 'cv-board-column-cards' });
			for (const item of column.items) this.renderCard(cards, item, column.value);

			this.listen(columnElement, 'dragover', (event: DragEvent) => {
				if (!this.dragSession || this.moveInProgress) return;
				event.preventDefault();
				if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
				this.markDropTarget(column.value);
			});
			this.listen(columnElement, 'dragleave', (event: DragEvent) => {
				if (!columnElement.contains(event.relatedTarget as Node | null)) {
					this.markDropTarget();
				}
			});
			this.listen(columnElement, 'drop', (event: DragEvent) => {
				if (!this.dragSession || this.moveInProgress) return;
				event.preventDefault();
				event.stopPropagation();
				void this.dropOnColumn(column.value);
			});
		}
		fragment.append(columnsElement);
		root.append(fragment);
	}

	private renderState(
		root: HTMLElement,
		className: string,
		message: string,
		actionLabel?: string,
		action?: () => void,
	): void {
		const state = root.createDiv({ cls: className });
		state.createDiv({ cls: 'cv-board-state-title', text: message });
		if (actionLabel && action) {
			const button = state.createEl('button', {
				cls: 'cv-board-state-action',
				text: actionLabel,
				attr: { type: 'button' },
			});
			button.addEventListener('click', action);
		}
	}

	private renderCard(
		container: HTMLElement,
		item: CalendarItem,
		columnValue: string,
	): void {
		const input = this.input;
		if (!input) return;
		const card = container.createDiv({
			cls: 'cv-board-card cv-event-card cv-color-token',
		});
		card.dataset.path = item.path;
		card.dataset.columnValue = columnValue;
		card.dataset.color = item.color ?? 'default';
		card.tabIndex = 0;
		card.setAttribute('role', 'button');
		card.setAttribute('title', item.title);
		const relationshipSummary = calendarRelationshipAccessibleSummary(item);
		card.setAttribute(
			'aria-label',
			[item.title, boardDateLabel(item), relationshipSummary]
				.filter(Boolean)
				.join(', '),
		);
		const pending = this.pendingMoves.has(item.path);
		card.draggable = !pending;
		if (pending) {
			card.addClass('is-pending');
			card.setAttribute('aria-busy', 'true');
		}

		card.createDiv({ cls: 'cv-card-title', text: item.title });
		card.createDiv({ cls: 'cv-board-card-date', text: boardDateLabel(item) });
		renderCardRelationships(card, item);
		renderCardProperties(
			this.dependencies.plugin.app,
			card,
			item,
			input.config.visibleProperties,
			input.config.propertyDefinitions,
			input.config.cardColorProperty,
		);

		this.listen(card, 'click', (event: MouseEvent) => {
			void this.openItem(item, event.metaKey || event.ctrlKey);
		});
		this.listen(card, 'auxclick', (event: MouseEvent) => {
			if (event.button === 1) {
				event.preventDefault();
				void this.openItem(item, true);
			}
		});
		this.listen(card, 'keydown', (event: KeyboardEvent) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			void this.openItem(item, event.metaKey || event.ctrlKey);
		});
		this.listen(card, 'contextmenu', (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			this.openItemMenu(event, item.path);
		});
		this.listen(card, 'dragstart', (event: DragEvent) => {
			if (pending || this.moveInProgress) {
				event.preventDefault();
				return;
			}
			const groupBy = this.input?.definition.groupBy;
			const definition = groupBy
				? this.input?.config.propertyDefinitions[groupBy]
				: undefined;
			if (!groupBy || !definition) {
				event.preventDefault();
				return;
			}
			this.dragSession = {
				viewId: this.input?.definition.id ?? '',
				item,
				groupBy,
				sourceValue: resolvedSelectValue(definition, item.properties[groupBy]),
			};
			event.dataTransfer?.setData('text/plain', item.path);
			if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
			card.addClass('is-dragging');
		});
		this.listen(card, 'dragend', () => {
			if (this.dragSession?.item.path !== item.path) return;
			this.dragSession = undefined;
			this.clearDragPreview();
			this.consumeQueuedInput();
			this.render();
		});
	}

	private async dropOnColumn(targetValue: string): Promise<void> {
		const session = this.dragSession;
		if (!session) return;
		this.dragSession = undefined;
		this.moveInProgress = true;
		const abortController = new AbortController();
		this.moveAbortController = abortController;
		this.clearDragPreview();
		const generation = this.interactionGeneration;
		let result: BoardCardMoveResult | undefined;
		try {
			result = await this.mover.move({
				viewId: session.viewId,
				path: session.item.path,
				expectedMtime: session.item.mtime,
				groupBy: session.groupBy,
				sourceValue: session.sourceValue,
				targetValue,
				signal: abortController.signal,
			});
			if (generation === this.interactionGeneration && result === 'moved') {
				this.pendingMoves.set(session.item.path, {
					baselineMtime: session.item.mtime,
					groupBy: session.groupBy,
					targetValue,
				});
			}
		} catch (error) {
			if (generation === this.interactionGeneration) {
				new Notice(error instanceof Error ? error.message : 'Unable to move card.');
			}
		} finally {
			if (this.moveAbortController === abortController) {
				this.moveAbortController = undefined;
			}
			if (generation === this.interactionGeneration) {
				this.moveInProgress = false;
				this.consumeQueuedInput();
				this.render();
			}
		}
	}

	private consumeQueuedInput(): void {
		if (this.queuedInput) {
			this.input = this.queuedInput;
			this.queuedInput = undefined;
		}
		this.reconcilePendingMoves();
	}

	private reconcilePendingMoves(): void {
		const input = this.input;
		if (!input) return;
		for (const [path, pending] of this.pendingMoves) {
			if (input.definition.groupBy !== pending.groupBy) {
				this.pendingMoves.delete(path);
				continue;
			}
			const definition = input.config.propertyDefinitions[pending.groupBy];
			if (
				!definition ||
				!isWritableBoardGroupProperty(input.config, pending.groupBy) ||
				!selectPropertyOptions(definition).includes(pending.targetValue)
			) {
				this.pendingMoves.delete(path);
				continue;
			}
			const item = input.snapshot.items.find((candidate) => candidate.path === path);
			if (
				!item ||
				item.mtime > pending.baselineMtime ||
				resolvedSelectValue(definition, item.properties[pending.groupBy]) ===
					pending.targetValue
			) {
				this.pendingMoves.delete(path);
			}
		}
	}

	private autoScroll(clientX: number): void {
		const root = this.root;
		if (!root || !Number.isFinite(clientX)) return;
		const bounds = root.getBoundingClientRect();
		const leftDistance = clientX - bounds.left;
		const rightDistance = bounds.right - clientX;
		let direction = 0;
		let proximity = 0;
		if (leftDistance >= 0 && leftDistance < BOARD_AUTO_SCROLL_EDGE) {
			direction = -1;
			proximity = BOARD_AUTO_SCROLL_EDGE - leftDistance;
		} else if (rightDistance >= 0 && rightDistance < BOARD_AUTO_SCROLL_EDGE) {
			direction = 1;
			proximity = BOARD_AUTO_SCROLL_EDGE - rightDistance;
		}
		if (direction === 0) return;
		const step = Math.max(
			1,
			Math.ceil((proximity / BOARD_AUTO_SCROLL_EDGE) * BOARD_AUTO_SCROLL_STEP),
		);
		root.scrollLeft += direction * step;
	}

	private markDropTarget(value?: string): void {
		for (const column of this.root?.querySelectorAll<HTMLElement>('.cv-board-column') ?? []) {
			column.toggleClass('is-drag-target', column.dataset.value === value);
		}
	}

	private clearDragPreview(): void {
		this.markDropTarget();
		for (const card of this.root?.querySelectorAll<HTMLElement>('.cv-board-card') ?? []) {
			card.removeClass('is-dragging');
		}
	}

	private async resolveLatestBoardView(
		viewId: string,
	): Promise<ResolvedBoardView | undefined> {
		const path = this.input?.config.documentPath;
		if (!path) return undefined;
		const file = this.dependencies.plugin.app.vault.getFileByPath(path);
		if (!file) return undefined;
		const parsed = await this.dependencies.plugin.documents.readFresh(file);
		const config = parsed.config;
		const catalog = config?.viewCatalog;
		if (!config || !catalog) return undefined;
		const view = validSavedViews(catalog).find((candidate) => candidate.id === viewId);
		return view ? { view, config } : undefined;
	}

	private async openItem(item: CalendarItem, newLeaf: boolean): Promise<void> {
		const file = this.dependencies.plugin.app.vault.getFileByPath(item.path);
		if (!file) {
			new Notice(`${item.path} was moved or deleted. The calendar will refresh.`);
			this.dependencies.plugin.indexes.handleFileDeleted(item.path);
			return;
		}
		if (newLeaf) {
			await this.dependencies.plugin.openAdapter.openMarkdownFile(file, true);
			return;
		}
		const input = this.input;
		if (!input) return;
		const index = this.dependencies.getActiveIndex();
		new EventEditorModal(
			this.dependencies.plugin,
			input.config,
			item,
			{
				parentItems: index?.parentCandidatesFor(item.path) ?? [],
				validateParentItem: (value) => index?.validateParentItem(item.path, value),
			},
		).open();
	}

	private createEvent(date: string): void {
		const input = this.input;
		if (!input) return;
		new EventTitleModal(
			this.dependencies.plugin,
			input.config,
			date,
			this.dependencies.getActiveIndex()?.parentCandidatesFor() ?? [],
		).open();
	}

	private openItemMenu(event: MouseEvent, path: string): void {
		const menu = new Menu();
		menu.addItem((item) => {
			item
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
		const file = this.dependencies.plugin.app.vault.getFileByPath(path);
		if (!file) {
			new Notice(`${path} was moved or deleted. The calendar will refresh.`);
			this.dependencies.plugin.indexes.handleFileDeleted(path);
			return;
		}
		try {
			await this.dependencies.plugin.app.fileManager.trashFile(file);
		} catch (error) {
			new Notice(
				error instanceof Error ? error.message : 'Unable to move event to trash.',
			);
		}
	}

	private listen<K extends keyof HTMLElementEventMap>(
		element: HTMLElement,
		type: K,
		listener: (event: HTMLElementEventMap[K]) => void,
	): void {
		element.addEventListener(type, listener);
		this.renderCleanups.push(() => element.removeEventListener(type, listener));
	}

	private clearRenderListeners(): void {
		for (const cleanup of this.renderCleanups.splice(0)) cleanup();
	}
}

export const createBoardSurface: ViewSurfaceFactory<
	BoardSavedView,
	BoardSurfaceState
> = (dependencies) => new BoardSurface(dependencies);
