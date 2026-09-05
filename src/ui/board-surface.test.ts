import { afterEach, describe, expect, it, vi } from 'vitest';

interface ElementOptions {
	attr?: Record<string, string>;
	cls?: string;
	text?: string;
	type?: string;
}

const surfaceHarness = vi.hoisted(() => {
	const menuItems: Array<{
		icon?: string;
		onClick?: () => unknown;
		title?: string;
		warning?: boolean;
	}> = [];
	const notices: string[] = [];
	const editorModals: Array<{ args: unknown[]; opened: boolean }> = [];
	const titleModals: Array<{ args: unknown[]; opened: boolean }> = [];
	const renderCardProperties = vi.fn();
	const renderCardRelationships = vi.fn();

	class MockEventTarget {
		private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

		addEventListener(type: string, listener: (event: unknown) => void): void {
			const listeners = this.listeners.get(type) ?? [];
			listeners.push(listener);
			this.listeners.set(type, listeners);
		}

		removeEventListener(type: string, listener: (event: unknown) => void): void {
			const listeners = this.listeners.get(type) ?? [];
			this.listeners.set(
				type,
				listeners.filter((candidate) => candidate !== listener),
			);
		}

		emit(type: string, event: unknown = {}): void {
			for (const listener of this.listeners.get(type) ?? []) listener(event);
		}
	}

	interface MockDocument {
		defaultView: MockEventTarget;
		createDocumentFragment(): MockFragment;
		createElement(tag: string): MockElement;
	}

	class MockFragment {
		readonly children: MockElement[] = [];

		append(...nodes: MockElement[]): void {
			this.children.push(...nodes);
		}
	}

	class MockElement extends MockEventTarget {
		readonly attributes = new Map<string, string>();
		readonly children: MockElement[] = [];
		readonly classes = new Set<string>();
		readonly dataset: Record<string, string> = {};
		readonly nodeType = 1;
		readonly style = { setProperty: vi.fn() };
		private bounds = {
			bottom: 400,
			height: 400,
			left: 0,
			right: 400,
			top: 0,
			width: 400,
			x: 0,
			y: 0,
		};
		draggable = false;
		parentElement?: MockElement;
		scrollLeft = 0;
		scrollTop = 0;
		tabIndex = -1;
		readonly text: string;

		constructor(
			readonly ownerDocument: MockDocument,
			options?: ElementOptions,
		) {
			super();
			this.text = options?.text ?? '';
			for (const className of options?.cls?.split(/\s+/u) ?? []) {
				if (className) this.classes.add(className);
			}
			for (const [name, value] of Object.entries(options?.attr ?? {})) {
				this.attributes.set(name, value);
			}
		}

		addClass(className: string): void {
			this.classes.add(className);
		}

		append(...nodes: Array<MockElement | MockFragment>): void {
			for (const node of nodes) {
				if (node instanceof MockFragment) {
					this.append(...node.children);
					continue;
				}
				node.remove();
				node.parentElement = this;
				this.children.push(node);
			}
		}

		contains(node: unknown): boolean {
			return node === this || this.children.some((child) => child.contains(node));
		}

		closest<T>(selector: string): T | null {
			const className = selector.startsWith('.') ? selector.slice(1) : undefined;
			if (!className) return null;
			if (this.classes.has(className)) return this as unknown as T;
			return this.parentElement?.closest<T>(selector) ?? null;
		}

		createDiv(options?: ElementOptions): MockElement {
			return this.create(options);
		}

		createEl(_tag: string, options?: ElementOptions): MockElement {
			return this.create(options);
		}

		createSpan(options?: ElementOptions): MockElement {
			return this.create(options);
		}

		empty(): void {
			for (const child of this.children) child.parentElement = undefined;
			this.children.length = 0;
		}

		getBoundingClientRect(): DOMRect {
			return this.bounds as DOMRect;
		}

		querySelectorAll<T>(selector: string): T[] {
			const className = selector.startsWith('.') ? selector.slice(1) : undefined;
			if (!className) return [];
			return this.children
				.flatMap((child) => [child, ...child.querySelectorAll<MockElement>(selector)])
				.filter((element) => element.classes.has(className)) as T[];
		}

		remove(): void {
			if (!this.parentElement) return;
			const index = this.parentElement.children.indexOf(this);
			if (index >= 0) this.parentElement.children.splice(index, 1);
			this.parentElement = undefined;
		}

		removeClass(className: string): void {
			this.classes.delete(className);
		}

		setAttribute(name: string, value: string): void {
			this.attributes.set(name, value);
		}

		toggleClass(className: string, active: boolean): void {
			if (active) this.classes.add(className);
			else this.classes.delete(className);
		}

		private create(options?: ElementOptions): MockElement {
			const child = new MockElement(this.ownerDocument, options);
			child.parentElement = this;
			this.children.push(child);
			return child;
		}
	}

	return {
		MockElement,
		MockEventTarget,
		MockFragment,
		editorModals,
		menuItems,
		notices,
		renderCardProperties,
		renderCardRelationships,
		titleModals,
	};
});

vi.mock('obsidian', () => ({
	Menu: class {
		addItem(
			configure: (item: {
				onClick(callback: () => unknown): unknown;
				setIcon(icon: string): unknown;
				setTitle(title: string): unknown;
				setWarning(warning: boolean): unknown;
			}) => unknown,
		): this {
			const state: (typeof surfaceHarness.menuItems)[number] = {};
			const item = {
				onClick: (callback: () => unknown) => {
					state.onClick = callback;
					return item;
				},
				setIcon: (icon: string) => {
					state.icon = icon;
					return item;
				},
				setTitle: (title: string) => {
					state.title = title;
					return item;
				},
				setWarning: (warning: boolean) => {
					state.warning = warning;
					return item;
				},
			};
			configure(item);
			surfaceHarness.menuItems.push(state);
			return this;
		}

		showAtMouseEvent(): this {
			return this;
		}
	},
	Notice: class {
		constructor(message: string) {
			surfaceHarness.notices.push(message);
		}
	},
}));

vi.mock('./calendar-card', () => ({
	calendarRelationshipAccessibleSummary: () => 'Parent item: Parent',
	renderCardProperties: surfaceHarness.renderCardProperties,
	renderCardRelationships: surfaceHarness.renderCardRelationships,
}));

vi.mock('./event-editor-modal', () => ({
	EventEditorModal: class {
		private readonly state: { args: unknown[]; opened: boolean };

		constructor(...args: unknown[]) {
			this.state = { args, opened: false };
			surfaceHarness.editorModals.push(this.state);
		}

		open(): void {
			this.state.opened = true;
		}
	},
}));

vi.mock('./event-title-modal', () => ({
	EventTitleModal: class {
		private readonly state: { args: unknown[]; opened: boolean };

		constructor(...args: unknown[]) {
			this.state = { args, opened: false };
			surfaceHarness.titleModals.push(this.state);
		}

		open(): void {
			this.state.opened = true;
		}
	},
}));

import type {
	BoardSavedView,
	CalendarConfig,
	CalendarItem,
} from '../types';
import { createBoardSurface } from './board-surface';
import type { ViewSurfaceDependencies, ViewSurfaceInput } from './view-surface';

const board: BoardSavedView = {
	id: 'work-board',
	name: 'Work board',
	type: 'board',
	groupBy: 'status',
};

function config(overrides: Partial<CalendarConfig> = {}): CalendarConfig {
	return {
		documentPath: 'Calendars/Work/_calendar.md',
		name: 'Work',
		sourceFolder: 'Calendars/Work',
		recursive: true,
		startDateProperty: 'date',
		endDateProperty: 'date-end',
		visibleProperties: ['status', 'type'],
		propertyDefinitions: {
			status: {
				type: 'select',
				options: ['None', 'Todo', 'Doing', 'Done'],
				default: 'Todo',
			},
			type: { type: 'select', options: ['None', 'Task', 'Idea'] },
		},
		viewCatalog: {
			source: 'canonical',
			entries: [{ kind: 'valid', definition: board }],
			canMutate: true,
		},
		weekStartsOn: 'locale',
		layout: 'month',
		openBehavior: 'same-leaf',
		createFolder: 'Calendars/Work',
		excludePaths: [],
		...overrides,
	};
}

function item(
	path: string,
	status: string | undefined,
	overrides: Partial<CalendarItem> = {},
): CalendarItem {
	const properties: Record<string, unknown> = { type: 'Task' };
	if (status !== undefined) properties.status = status;
	return {
		path,
		title: path.replace(/\.md$/u, ''),
		start: '2026-09-04',
		startTimeSort: 0,
		allDay: true,
		properties,
		mtime: 10,
		parentItem: { path: 'Tasks/Parent.md', title: 'Parent' },
		subItems: [],
		...overrides,
	};
}

function input(
	items: CalendarItem[],
	overrides: Partial<ViewSurfaceInput<BoardSavedView>> = {},
): ViewSurfaceInput<BoardSavedView> {
	return {
		definition: board,
		config: config(),
		configIssues: [],
		snapshot: { items, issues: [], indexedCount: items.length },
		...overrides,
	};
}

function elementsWithClass(
	root: InstanceType<typeof surfaceHarness.MockElement>,
	className: string,
): Array<InstanceType<typeof surfaceHarness.MockElement>> {
	return root.querySelectorAll(`.${className}`);
}

function elementWithClass(
	root: InstanceType<typeof surfaceHarness.MockElement>,
	className: string,
): InstanceType<typeof surfaceHarness.MockElement> {
	const element = elementsWithClass(root, className)[0];
	if (!element) throw new Error(`Missing .${className}`);
	return element;
}

function cardFor(
	root: InstanceType<typeof surfaceHarness.MockElement>,
	path: string,
): InstanceType<typeof surfaceHarness.MockElement> {
	const card = elementsWithClass(root, 'cv-board-card').find(
		(candidate) => candidate.dataset.path === path,
	);
	if (!card) throw new Error(`Missing card for ${path}`);
	return card;
}

function columnFor(
	root: InstanceType<typeof surfaceHarness.MockElement>,
	value: string,
): InstanceType<typeof surfaceHarness.MockElement> {
	const column = elementsWithClass(root, 'cv-board-column').find(
		(candidate) => candidate.dataset.value === value,
	);
	if (!column) throw new Error(`Missing column for ${value}`);
	return column;
}

function event(overrides: Record<string, unknown> = {}) {
	return {
		button: 0,
		ctrlKey: false,
		metaKey: false,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
		...overrides,
	};
}

function createHarness(initialConfig = config()) {
	const ownerWindow = new surfaceHarness.MockEventTarget();
	type BoardMockDocument = ConstructorParameters<typeof surfaceHarness.MockElement>[0];
	const ownerDocument = { defaultView: ownerWindow } as BoardMockDocument;
	ownerDocument.createDocumentFragment = () => {
		return new surfaceHarness.MockFragment();
	};
	ownerDocument.createElement = () => new surfaceHarness.MockElement(ownerDocument);
	const viewRoot = new surfaceHarness.MockElement(ownerDocument, {
		cls: 'calendar-view-root',
	});
	const container = viewRoot.createDiv({ cls: 'cv-view-surface' });
	const files = new Map<string, { path: string; stat: { mtime: number } }>([
		[initialConfig.documentPath, { path: initialConfig.documentPath, stat: { mtime: 1 } }],
		['Tasks/None.md', { path: 'Tasks/None.md', stat: { mtime: 10 } }],
		['Tasks/Doing.md', { path: 'Tasks/Doing.md', stat: { mtime: 10 } }],
		['Tasks/Range.md', { path: 'Tasks/Range.md', stat: { mtime: 10 } }],
	]);
	let latestConfig = initialConfig;
	const updateProperty = vi.fn(
		async (
			_path: string,
			_expectedMtime: number,
			_property: string,
			_value: unknown,
			_signal?: AbortSignal,
		): Promise<void> => undefined,
	);
	const openMarkdownFile = vi.fn(async () => undefined);
	const trashFile = vi.fn(async () => undefined);
	const handleFileDeleted = vi.fn();
	const documentsRead = vi.fn(() => ({
		isCalendarDocument: true,
		config: initialConfig,
		issues: [],
	}));
	const documentsReadFresh = vi.fn(async () => ({
		isCalendarDocument: true,
		config: latestConfig,
		issues: [],
	}));
	const parentCandidatesFor = vi.fn(() => [
		{ path: 'Tasks/Parent.md', title: 'Parent' },
	]);
	const validateParentItem = vi.fn();
	const editView = vi.fn();
	const openProperties = vi.fn();
	const plugin = {
		app: {
			fileManager: { trashFile },
			vault: { getFileByPath: (path: string) => files.get(path) ?? null },
		},
		documents: { read: documentsRead, readFresh: documentsReadFresh },
		indexes: { handleFileDeleted },
		openAdapter: { openMarkdownFile },
		writer: { updateProperty },
	};
	const dependencies = {
		plugin,
		getActiveIndex: () => ({ parentCandidatesFor, validateParentItem }),
		applySavedViewCatalog: vi.fn(async () => undefined),
		persistUiState: vi.fn(async () => undefined),
		editView,
		openProperties,
		retry: vi.fn(async () => undefined),
	} as unknown as ViewSurfaceDependencies;
	return {
		container,
		dependencies,
		documentsRead,
		documentsReadFresh,
		editView,
		files,
		handleFileDeleted,
		openMarkdownFile,
		openProperties,
		ownerWindow,
		parentCandidatesFor,
		plugin,
		setLatestConfig(next: CalendarConfig) {
			latestConfig = next;
		},
		trashFile,
		updateProperty,
		validateParentItem,
		viewRoot,
	};
}

describe('Board surface', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
		surfaceHarness.editorModals.length = 0;
		surfaceHarness.menuItems.length = 0;
		surfaceHarness.notices.length = 0;
		surfaceHarness.titleModals.length = 0;
	});

	it('renders every column, dates, relationships, and visible properties in document flow', () => {
		const harness = createHarness();
		const surface = createBoardSurface(harness.dependencies);
		const none = item('Tasks/None.md', undefined);
		const range = item('Tasks/Range.md', 'Doing', {
			title: 'Date range',
			end: '2026-09-06',
		});

		surface.mount(
			harness.container as unknown as HTMLElement,
			input([range, none]),
		);
		const root = elementWithClass(harness.container, 'cv-board-surface');
		const columns = elementsWithClass(root, 'cv-board-column');

		expect(columns.map((column) => column.dataset.value)).toEqual([
			'None',
			'Todo',
			'Doing',
			'Done',
		]);
		expect(columnFor(root, 'Done').attributes.get('aria-label')).toBe('Done, 0 cards');
		expect(cardFor(root, none.path).dataset.columnValue).toBe('None');
		expect(elementWithClass(cardFor(root, range.path), 'cv-board-card-date').text).toBe(
			'2026-09-04 – 2026-09-06',
		);
		for (const card of elementsWithClass(root, 'cv-board-card')) {
			expect(card.style.setProperty).not.toHaveBeenCalled();
		}
		expect(surfaceHarness.renderCardRelationships).toHaveBeenCalledWith(
			expect.anything(),
			range,
		);
		expect(surfaceHarness.renderCardProperties).toHaveBeenCalledWith(
			harness.plugin.app,
			expect.anything(),
			range,
			['status', 'type'],
			expect.any(Object),
			undefined,
		);
	});

	it('renders an empty event title as New page', () => {
		const harness = createHarness();
		const surface = createBoardSurface(harness.dependencies);
		const untitled = item('Tasks/--7f3A.md', 'Todo', { title: '' });

		surface.mount(
			harness.container as unknown as HTMLElement,
			input([untitled]),
		);
		const root = elementWithClass(harness.container, 'cv-board-surface');
		const card = cardFor(root, untitled.path);

		expect(elementWithClass(card, 'cv-card-title').text).toBe('New page');
		expect(card.attributes.get('title')).toBe('New page');
		expect(card.attributes.get('aria-label')).toBe(
			'New page, 2026-09-04, Parent item: Parent',
		);
		expect(untitled.title).toBe('');
	});

	it('routes pointer, keyboard, middle-click, context-menu, and primary actions', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 8, 4, 23, 59));
		const harness = createHarness();
		const surface = createBoardSurface(harness.dependencies);
		const doing = item('Tasks/Doing.md', 'Doing');
		surface.mount(harness.container as unknown as HTMLElement, input([doing]));
		const root = elementWithClass(harness.container, 'cv-board-surface');
		const card = cardFor(root, doing.path);

		card.emit('click', event());
		expect(surfaceHarness.editorModals.at(-1)).toMatchObject({ opened: true });
		expect(harness.parentCandidatesFor).toHaveBeenCalledWith(doing.path);

		const keyboardEvent = event({ key: ' ' });
		card.emit('keydown', keyboardEvent);
		expect(keyboardEvent.preventDefault).toHaveBeenCalled();
		expect(surfaceHarness.editorModals).toHaveLength(2);

		card.emit('click', event({ ctrlKey: true }));
		card.emit('auxclick', event({ button: 1 }));
		await vi.waitFor(() => expect(harness.openMarkdownFile).toHaveBeenCalledTimes(2));
		expect(harness.openMarkdownFile).toHaveBeenNthCalledWith(1, harness.files.get(doing.path), true);

		const contextEvent = event();
		card.emit('contextmenu', contextEvent);
		expect(contextEvent.preventDefault).toHaveBeenCalled();
		expect(surfaceHarness.menuItems).toEqual([
			expect.objectContaining({
				title: 'Move to trash',
				icon: 'trash-2',
				warning: true,
			}),
		]);
		surfaceHarness.menuItems[0]?.onClick?.();
		await vi.waitFor(() =>
			expect(harness.trashFile).toHaveBeenCalledWith(harness.files.get(doing.path)),
		);

		const action = surface.primaryAction();
		expect(action).toMatchObject({
			label: 'New',
			ariaLabel: 'Create note on 2026-09-04',
		});
		vi.setSystemTime(new Date(2026, 8, 5, 0, 1));
		action.run();
		expect(surfaceHarness.titleModals.at(-1)).toMatchObject({ opened: true });
		expect(surfaceHarness.titleModals.at(-1)?.args[2]).toBe('2026-09-05');
	});

	it('survives pointercancel, highlights valid drops, and waits for the index snapshot', async () => {
		const harness = createHarness();
		const surface = createBoardSurface(harness.dependencies);
		const doing = item('Tasks/Doing.md', 'Doing');
		const initialInput = input([doing]);
		surface.mount(harness.container as unknown as HTMLElement, initialInput);
		let root = elementWithClass(harness.container, 'cv-board-surface');
		const card = cardFor(root, doing.path);
		const dataTransfer = {
			dropEffect: 'none',
			effectAllowed: 'none',
			setData: vi.fn(),
		};

		card.emit('dragstart', event({ dataTransfer }));
		harness.ownerWindow.emit('pointercancel', { pointerId: 1 });
		const doneColumn = columnFor(root, 'Done');
		const dragOver = event({ dataTransfer });
		doneColumn.emit('dragover', dragOver);
		expect(dragOver.preventDefault).toHaveBeenCalled();
		expect(doneColumn.classes.has('is-drag-target')).toBe(true);

		doneColumn.emit('drop', event({ dataTransfer }));
		await vi.waitFor(() =>
			expect(harness.updateProperty).toHaveBeenCalledExactlyOnceWith(
				doing.path,
				doing.mtime,
				'status',
				'Done',
				expect.any(AbortSignal),
			),
		);
		expect(harness.documentsReadFresh).toHaveBeenCalled();
		expect(harness.documentsRead).not.toHaveBeenCalled();

		root = elementWithClass(harness.container, 'cv-board-surface');
		expect(cardFor(root, doing.path).classes.has('is-pending')).toBe(true);
		expect(cardFor(root, doing.path).draggable).toBe(false);

		const updated = item(doing.path, 'Done', { mtime: 11 });
		surface.update(input([updated]));
		root = elementWithClass(harness.container, 'cv-board-surface');
		expect(cardFor(root, doing.path).dataset.columnValue).toBe('Done');
		expect(cardFor(root, doing.path).classes.has('is-pending')).toBe(false);
		expect(cardFor(root, doing.path).draggable).toBe(true);
	});

	it('scrolls horizontally while a card is dragged near a Board edge', () => {
		const harness = createHarness();
		const surface = createBoardSurface(harness.dependencies);
		const doing = item('Tasks/Doing.md', 'Doing');
		surface.mount(harness.container as unknown as HTMLElement, input([doing]));
		const root = elementWithClass(harness.container, 'cv-board-surface');
		cardFor(root, doing.path).emit('dragstart', event());
		const dragOver = event({ clientX: 399 });

		root.emit('dragover', dragOver);

		expect(dragOver.preventDefault).toHaveBeenCalledOnce();
		expect(root.scrollLeft).toBeGreaterThan(0);
	});

	it('aborts an in-flight write when the active interaction is cancelled', async () => {
		const harness = createHarness();
		let moveSignal: AbortSignal | undefined;
		harness.updateProperty.mockImplementationOnce(
			(
				_path: string,
				_expectedMtime: number,
				_property: string,
				_value: unknown,
				signal?: AbortSignal,
			) =>
				new Promise<void>((_resolve, reject) => {
					moveSignal = signal;
					signal?.addEventListener('abort', () => {
						const error = new Error('The Board move was cancelled.');
						error.name = 'AbortError';
						reject(error);
					});
				}),
		);
		const surface = createBoardSurface(harness.dependencies);
		const doing = item('Tasks/Doing.md', 'Doing');
		surface.mount(harness.container as unknown as HTMLElement, input([doing]));
		let root = elementWithClass(harness.container, 'cv-board-surface');

		cardFor(root, doing.path).emit('dragstart', event());
		columnFor(root, 'Done').emit('drop', event());
		await vi.waitFor(() => expect(moveSignal).toBeDefined());
		surface.cancelInteraction('Calendar configuration changed.');

		await vi.waitFor(() => expect(moveSignal?.aborted).toBe(true));
		root = elementWithClass(harness.container, 'cv-board-surface');
		expect(cardFor(root, doing.path).classes.has('is-pending')).toBe(false);
		expect(surfaceHarness.notices).toEqual(['Calendar configuration changed.']);
	});

	it('unlocks a pending card when a newer authoritative snapshot disagrees', async () => {
		const harness = createHarness();
		const surface = createBoardSurface(harness.dependencies);
		const doing = item('Tasks/Doing.md', 'Doing');
		surface.mount(harness.container as unknown as HTMLElement, input([doing]));
		let root = elementWithClass(harness.container, 'cv-board-surface');
		cardFor(root, doing.path).emit('dragstart', event());
		columnFor(root, 'Done').emit('drop', event());
		await vi.waitFor(() =>
			expect(cardFor(elementWithClass(harness.container, 'cv-board-surface'), doing.path)
				.classes.has('is-pending')).toBe(true),
		);

		surface.update(input([item(doing.path, 'Doing', { mtime: 11 })]));

		root = elementWithClass(harness.container, 'cv-board-surface');
		expect(cardFor(root, doing.path).dataset.columnValue).toBe('Doing');
		expect(cardFor(root, doing.path).classes.has('is-pending')).toBe(false);
		expect(cardFor(root, doing.path).draggable).toBe(true);
	});

	it('unlocks a pending card when its target option or group schema disappears', async () => {
		const harness = createHarness();
		const surface = createBoardSurface(harness.dependencies);
		const doing = item('Tasks/Doing.md', 'Doing');
		surface.mount(harness.container as unknown as HTMLElement, input([doing]));
		let root = elementWithClass(harness.container, 'cv-board-surface');
		cardFor(root, doing.path).emit('dragstart', event());
		columnFor(root, 'Done').emit('drop', event());
		await vi.waitFor(() =>
			expect(cardFor(elementWithClass(harness.container, 'cv-board-surface'), doing.path)
				.classes.has('is-pending')).toBe(true),
		);

		const withoutTarget = config({
			propertyDefinitions: {
				...config().propertyDefinitions,
				status: { type: 'select', options: ['None', 'Todo', 'Doing'] },
			},
		});
		surface.update(input([doing], { config: withoutTarget }));
		root = elementWithClass(harness.container, 'cv-board-surface');
		expect(cardFor(root, doing.path).classes.has('is-pending')).toBe(false);

		const invalidSchema = config({
			propertyDefinitions: { status: { type: 'text' } },
		});
		surface.update(input([doing], { config: invalidSchema }));
		surface.update(input([doing]));
		root = elementWithClass(harness.container, 'cv-board-surface');
		expect(cardFor(root, doing.path).draggable).toBe(true);
	});

	it('treats a same-column drop as a no-op', async () => {
		const harness = createHarness();
		const surface = createBoardSurface(harness.dependencies);
		const doing = item('Tasks/Doing.md', 'Doing');
		surface.mount(harness.container as unknown as HTMLElement, input([doing]));
		const root = elementWithClass(harness.container, 'cv-board-surface');

		cardFor(root, doing.path).emit('dragstart', event());
		columnFor(root, 'Doing').emit('drop', event());
		await vi.waitFor(() => expect(cardFor(root, doing.path)).toBeDefined());

		expect(harness.documentsReadFresh).not.toHaveBeenCalled();
		expect(harness.updateProperty).not.toHaveBeenCalled();
	});

	it('rejects a drop when the latest saved view changed group property', async () => {
		const harness = createHarness();
		const surface = createBoardSurface(harness.dependencies);
		const doing = item('Tasks/Doing.md', 'Doing');
		surface.mount(harness.container as unknown as HTMLElement, input([doing]));
		const root = elementWithClass(harness.container, 'cv-board-surface');
		const changedBoard: BoardSavedView = { ...board, groupBy: 'type' };
		harness.setLatestConfig(
			config({
				viewCatalog: {
					source: 'canonical',
					entries: [{ kind: 'valid', definition: changedBoard }],
					canMutate: true,
				},
			}),
		);

		cardFor(root, doing.path).emit('dragstart', event());
		columnFor(root, 'Done').emit('drop', event());

		await vi.waitFor(() =>
			expect(surfaceHarness.notices.at(-1)).toContain('group property changed'),
		);
		expect(harness.documentsReadFresh).toHaveBeenCalledOnce();
		expect(harness.updateProperty).not.toHaveBeenCalled();
	});

	it('caches updates during a drag and applies only the latest snapshot on cancel', () => {
		const harness = createHarness();
		const surface = createBoardSurface(harness.dependencies);
		const doing = item('Tasks/Doing.md', 'Doing');
		surface.mount(harness.container as unknown as HTMLElement, input([doing]));
		let root = elementWithClass(harness.container, 'cv-board-surface');
		cardFor(root, doing.path).emit('dragstart', event());

		const renamed = { ...doing, title: 'Renamed by index' };
		surface.update(input([renamed]));
		expect(elementWithClass(cardFor(root, doing.path), 'cv-card-title').text).toBe('Tasks/Doing');

		surface.cancelInteraction('Board changed. Dragging was cancelled.');
		root = elementWithClass(harness.container, 'cv-board-surface');
		expect(elementWithClass(cardFor(root, doing.path), 'cv-card-title').text).toBe(
			'Renamed by index',
		);
		expect(surfaceHarness.notices).toEqual(['Board changed. Dragging was cancelled.']);
		surface.cancelInteraction('Should not be shown');
		expect(surfaceHarness.notices).toHaveLength(1);
	});

	it('returns scroll state and removes listeners when deactivated', () => {
		const harness = createHarness();
		const surface = createBoardSurface(harness.dependencies);
		const doing = item('Tasks/Doing.md', 'Doing');
		surface.mount(
			harness.container as unknown as HTMLElement,
			input([doing], {
				state: { type: 'board', scrollLeft: 7, scrollTop: 9 },
			}),
		);
		const root = elementWithClass(harness.container, 'cv-board-surface');
		const card = cardFor(root, doing.path);
		expect(root.scrollLeft).toBe(7);
		expect(root.scrollTop).toBe(0);
		expect(harness.viewRoot.scrollTop).toBe(9);
		root.scrollLeft = 31;
		harness.viewRoot.scrollTop = 47;

		expect(surface.deactivate()).toEqual({
			type: 'board',
			scrollLeft: 31,
			scrollTop: 47,
		});
		expect(harness.container.children).toHaveLength(0);
		card.emit('click', event());
		expect(surfaceHarness.editorModals).toHaveLength(0);
	});

	it('renders setup, invalid-group, and empty Board states', () => {
		const harness = createHarness();
		const surface = createBoardSurface(harness.dependencies);
		const setupView: BoardSavedView = { ...board, groupBy: undefined };
		surface.mount(
			harness.container as unknown as HTMLElement,
			input([], { definition: setupView }),
		);
		let root = elementWithClass(harness.container, 'cv-board-surface');
		expect(elementWithClass(root, 'cv-board-setup').children[0]?.text).toContain(
			'Choose a Select property',
		);
		elementWithClass(root, 'cv-board-state-action').emit('click');
		expect(harness.editView).toHaveBeenCalledWith(setupView);
		expect(elementsWithClass(root, 'cv-board-column')).toHaveLength(0);

		const noSelectConfig = config({
			propertyDefinitions: { notes: { type: 'text' } },
		});
		surface.update(
			input([], { config: noSelectConfig, definition: setupView }),
		);
		root = elementWithClass(harness.container, 'cv-board-surface');
		elementWithClass(root, 'cv-board-state-action').emit('click');
		expect(harness.openProperties).toHaveBeenCalledOnce();

		const invalidConfig = config({
			propertyDefinitions: { status: { type: 'text' } },
		});
		surface.update(input([], { config: invalidConfig }));
		root = elementWithClass(harness.container, 'cv-board-surface');
		expect(elementWithClass(root, 'cv-board-error').children[0]?.text).toContain(
			'group property is unavailable',
		);
		elementWithClass(root, 'cv-board-state-action').emit('click');
		expect(harness.openProperties).toHaveBeenCalledTimes(2);

		const readOnlyConfig = config({
			viewCatalog: {
				source: 'canonical',
				entries: [
					{ kind: 'valid', definition: setupView },
					{
						kind: 'unsupported',
						id: 'timeline',
						name: 'Timeline',
						viewType: 'timeline',
						raw: { id: 'timeline', name: 'Timeline', type: 'timeline' },
					},
				],
				canMutate: false,
			},
		});
		surface.update(
			input([], { config: readOnlyConfig, definition: setupView }),
		);
		root = elementWithClass(harness.container, 'cv-board-surface');
		expect(elementWithClass(root, 'cv-board-setup').children[0]?.text).toContain(
			'Repair the saved-view configuration',
		);
		expect(elementsWithClass(root, 'cv-board-state-action')).toHaveLength(0);

		surface.update(input([]));
		root = elementWithClass(harness.container, 'cv-board-surface');
		expect(elementWithClass(root, 'cv-empty-hint').text).toBe('No scheduled notes.');
		expect(elementsWithClass(root, 'cv-board-column')).toHaveLength(4);

		surface.update(input([], { indexError: 'Index is unavailable.' }));
		root = elementWithClass(harness.container, 'cv-board-surface');
		expect(elementsWithClass(root, 'cv-empty-hint')).toHaveLength(0);
		expect(elementsWithClass(root, 'cv-board-column')).toHaveLength(4);
	});

	it('projects and renders 1,000 cards within the Board performance budget', () => {
		const harness = createHarness();
		const surface = createBoardSurface(harness.dependencies);
		const items = Array.from({ length: 1_000 }, (_, index) =>
			item(`Tasks/Card ${String(index).padStart(4, '0')}.md`, 'Doing', {
				title: `Card ${index}`,
			}),
		);
		const startedAt = performance.now();

		surface.mount(harness.container as unknown as HTMLElement, input(items));

		const elapsed = performance.now() - startedAt;
		const root = elementWithClass(harness.container, 'cv-board-surface');
		expect(elementsWithClass(root, 'cv-board-card')).toHaveLength(1_000);
		expect(elapsed).toBeLessThan(500);
	});
});
