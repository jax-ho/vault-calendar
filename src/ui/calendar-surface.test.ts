import { afterEach, describe, expect, it, vi } from 'vitest';

interface ElementOptions {
	cls?: string;
	text?: string;
	value?: string;
}

const surfaceHarness = vi.hoisted(() => {
	const cleanups = new WeakMap<object, Array<() => void>>();
	const domEvents = new WeakMap<object, Map<string, Array<(event: unknown) => void>>>();
	const menuItems: Array<{
		icon?: string;
		onClick?: () => unknown;
		title?: string;
		warning?: boolean;
	}> = [];
	const notices: string[] = [];
	const shownMenuEvents: unknown[] = [];

	class MockElement {
		private readonly listeners = new Map<
			string,
			Array<(event: Record<string, unknown>) => void>
		>();
		private bounds = {
			bottom: 100,
			height: 100,
			left: 0,
			right: 700,
			top: 0,
			width: 700,
			x: 0,
			y: 0,
		};
		children: MockElement[] = [];
		classes = new Set<string>();
		dataset: Record<string, string> = {};
		draggable = false;
		readonly nodeType = 1;
		parentElement?: MockElement;
		scrollLeft = 0;
		scrollTop = 0;
		tabIndex = 0;
		value = '';
		readonly style = { setProperty: vi.fn() };

		constructor(
			readonly ownerDocument: Document,
			options?: ElementOptions,
		) {
			for (const className of options?.cls?.split(/\s+/u) ?? []) {
				if (className) this.classes.add(className);
			}
			if (options?.value) this.value = options.value;
		}

		addClass(className: string): void {
			this.classes.add(className);
		}

		addEventListener(
			event: string,
			handler: (detail: Record<string, unknown>) => void,
		): void {
			const handlers = this.listeners.get(event) ?? [];
			handlers.push(handler);
			this.listeners.set(event, handlers);
		}

		closest<T>(selector: string): T | null {
			const className = selector.startsWith('.') ? selector.slice(1) : undefined;
			if (!className) return null;
			if (this.classes.has(className)) return this as unknown as T;
			return this.parentElement?.closest<T>(selector) ?? null;
		}

		contains(node: unknown): boolean {
			return node === this || this.children.some((child) => child.contains(node));
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
			this.children.length = 0;
		}

		emit(event: string, detail: Record<string, unknown> = {}): void {
			for (const handler of this.listeners.get(event) ?? []) handler(detail);
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

		removeClass(className: string): void {
			this.classes.delete(className);
		}

		setAttribute(_name: string, _value: string): void {}

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
		menuItems,
		notices,
		shownMenuEvents,
		emitDom(target: object, event: string, detail: unknown): void {
			for (const handler of domEvents.get(target)?.get(event) ?? []) handler(detail);
		},
		registerCleanup(component: object, callback: () => void): void {
			const callbacks = cleanups.get(component) ?? [];
			callbacks.push(callback);
			cleanups.set(component, callbacks);
		},
		registerDomEvent(
			target: object,
			event: string,
			handler: (event: unknown) => void,
		): () => void {
			const events: Map<string, Array<(event: unknown) => void>> =
				domEvents.get(target) ?? new Map<string, Array<(event: unknown) => void>>();
			const handlers: Array<(event: unknown) => void> = events.get(event) ?? [];
			handlers.push(handler);
			events.set(event, handlers);
			domEvents.set(target, events);
			return () => {
				const index = handlers.indexOf(handler);
				if (index >= 0) handlers.splice(index, 1);
			};
		},
		runCleanups(component: object): void {
			for (const callback of cleanups.get(component) ?? []) callback();
			cleanups.delete(component);
		},
	};
});

vi.mock('obsidian', () => {
	class Component {
		load(): void {
			(this as { onload?: () => void }).onload?.();
		}

		unload(): void {
			surfaceHarness.runCleanups(this);
			(this as { onunload?: () => void }).onunload?.();
		}

		registerDomEvent(
			target: object,
			event: string,
			handler: (event: unknown) => void,
		): void {
			this.register(surfaceHarness.registerDomEvent(target, event, handler));
		}

		register(callback: () => void): void {
			surfaceHarness.registerCleanup(this, callback);
		}
	}

	return {
		Component,
		Menu: class {
			addItem(
				callback: (item: {
					onClick(callback: () => unknown): unknown;
					setIcon(icon: string): unknown;
					setTitle(title: string): unknown;
					setWarning(warning: boolean): unknown;
				}) => unknown,
			): this {
				const state: (typeof surfaceHarness.menuItems)[number] = {};
				const item = {
					onClick: (handler: () => unknown) => {
						state.onClick = handler;
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
				callback(item);
				surfaceHarness.menuItems.push(state);
				return this;
			}

			showAtMouseEvent(event: unknown): this {
				surfaceHarness.shownMenuEvents.push(event);
				return this;
			}
		},
		Notice: class {
			constructor(message: string) {
				surfaceHarness.notices.push(message);
			}
		},
		setIcon: vi.fn(),
	};
});

vi.mock('./calendar-card', () => ({
	calendarRelationshipAccessibleSummary: () => '',
	calendarRelationshipRowCount: () => 0,
	renderCardProperties: vi.fn(),
	renderCardRelationships: vi.fn(),
}));
vi.mock('./event-editor-modal', () => ({ EventEditorModal: class {} }));
vi.mock('./event-title-modal', () => ({ EventTitleModal: class {} }));

import type CalendarViewPlugin from '../main';
import type {
	CalendarConfig,
	CalendarIndexSnapshot,
	CalendarItem,
	CalendarSavedView,
} from '../types';
import { CalendarSurface } from './calendar-surface';
import type { ViewSurfaceDependencies } from './view-surface';

const definition: CalendarSavedView = {
	id: 'calendar-a',
	name: 'Calendar A',
	type: 'calendar',
	layout: 'month',
	weekStartsOn: 'monday',
};

function calendarConfig(): CalendarConfig {
	return {
		documentPath: 'Life/Work/_calendar.md',
		name: 'Work',
		sourceFolder: 'Life/Work',
		recursive: true,
		startDateProperty: 'date',
		visibleProperties: [],
		propertyDefinitions: {},
		viewCatalog: {
			source: 'canonical',
			entries: [{ kind: 'valid', definition }],
			canMutate: true,
		},
		weekStartsOn: 'monday',
		layout: 'month',
		openBehavior: 'same-leaf',
		createFolder: 'Life/Work',
		excludePaths: [],
	};
}

function item(path = 'Life/Work/Planning.md'): CalendarItem {
	return {
		path,
		title: 'Planning',
		start: '2026-09-01',
		startTimeSort: 0,
		allDay: true,
		properties: {},
		mtime: 1,
		subItems: [],
	};
}

function snapshot(items: CalendarItem[]): CalendarIndexSnapshot {
	return { items, issues: [], indexedCount: items.length };
}

function setup(options: {
	getFileByPath?: (path: string) => unknown;
	trashFile?: (file: unknown) => Promise<void>;
	snapshot?: CalendarIndexSnapshot;
} = {}) {
	const ownerWindow = {
		clearTimeout: vi.fn(),
		requestAnimationFrame: (callback: () => void) => callback(),
		setTimeout: vi.fn().mockReturnValue(1),
	};
	const ownerDocument = { defaultView: ownerWindow } as unknown as Document;
	const root = new surfaceHarness.MockElement(ownerDocument, { cls: 'calendar-view-root' });
	const container = root.createDiv({ cls: 'cv-view-surface' });
	const trashFile = options.trashFile ?? vi.fn().mockResolvedValue(undefined);
	const handleFileDeleted = vi.fn();
	const savedViewCommit = vi.fn().mockResolvedValue(calendarConfig().viewCatalog);
	const plugin = {
		app: {
			fileManager: { trashFile },
			vault: {
				getFileByPath: options.getFileByPath ?? ((path: string) => ({ path })),
			},
		},
		indexes: { handleFileDeleted },
		savedViews: { commit: savedViewCommit },
	} as unknown as CalendarViewPlugin;
	const applySavedViewCatalog = vi.fn().mockResolvedValue(undefined);
	const persistUiState = vi.fn().mockResolvedValue(undefined);
	const dependencies: ViewSurfaceDependencies = {
		plugin,
		getActiveIndex: () => undefined,
		applySavedViewCatalog,
		persistUiState,
		editView: vi.fn(),
		openProperties: vi.fn(),
		retry: vi.fn().mockResolvedValue(undefined),
	};
	const surface = new CalendarSurface(dependencies);
	surface.mount(container as unknown as HTMLElement, {
		definition,
		config: calendarConfig(),
		configIssues: [],
		snapshot: options.snapshot ?? snapshot([item()]),
	});
	return {
		applySavedViewCatalog,
		container,
		dependencies,
		handleFileDeleted,
		persistUiState,
		root,
		savedViewCommit,
		surface,
		trashFile,
	};
}

function cards(
	container: InstanceType<typeof surfaceHarness.MockElement>,
): Array<InstanceType<typeof surfaceHarness.MockElement>> {
	return container.querySelectorAll('.cv-event-card');
}

afterEach(() => {
	surfaceHarness.menuItems.length = 0;
	surfaceHarness.notices.length = 0;
	surfaceHarness.shownMenuEvents.length = 0;
	vi.clearAllMocks();
});

describe('calendar surface lifecycle', () => {
	it('restores per-view state, ignores state on update, and returns current scroll state', () => {
		const setupResult = setup({ snapshot: snapshot([]) });
		setupResult.surface.deactivate();

		const surface = new CalendarSurface(setupResult.dependencies);
		surface.mount(setupResult.container as unknown as HTMLElement, {
			definition,
			config: calendarConfig(),
			configIssues: [],
			snapshot: snapshot([]),
			state: { type: 'calendar', focusDate: '2026-11-03', scrollTop: 44 },
		});
		expect(surface.primaryAction().ariaLabel).toBe('Create note on 2026-11-03');
		surface.update({
			definition,
			config: calendarConfig(),
			configIssues: [],
			snapshot: snapshot([]),
			state: { type: 'calendar', focusDate: '2030-01-01' },
		});
		expect(surface.primaryAction().ariaLabel).toBe('Create note on 2026-11-03');
		setupResult.root.scrollTop = 77;
		expect(surface.deactivate()).toEqual({
			type: 'calendar',
			focusDate: '2026-11-03',
			scrollTop: 77,
		});
	});

	it('defers snapshots during a drag and applies the latest input after cancellation', () => {
		const first = item('Life/Work/First.md');
		const second = item('Life/Work/Second.md');
		const { container, surface } = setup({ snapshot: snapshot([first]) });
		cards(container)[0]?.emit('dragstart', { dataTransfer: { setData: vi.fn() } });
		surface.update({
			definition,
			config: calendarConfig(),
			configIssues: [],
			snapshot: snapshot([second]),
		});
		expect(cards(container)[0]?.dataset.path).toBe(first.path);
		surface.cancelInteraction('Cancelled for refresh.');
		expect(cards(container)[0]?.dataset.path).toBe(second.path);
		expect(surfaceHarness.notices).toEqual(['Cancelled for refresh.']);
	});

	it('persists layout changes through the saved-view command seam', async () => {
		const { applySavedViewCatalog, container, persistUiState, savedViewCommit } = setup({
			snapshot: snapshot([]),
		});
		const layout = container.querySelectorAll<
			InstanceType<typeof surfaceHarness.MockElement>
		>('.cv-layout-select')[0];
		if (!layout) throw new Error('Expected layout selector.');
		layout.value = 'week';
		layout.emit('change');

		await vi.waitFor(() => {
			expect(savedViewCommit).toHaveBeenCalledWith(
				'Life/Work/_calendar.md',
				{
					kind: 'configure-calendar',
					viewId: 'calendar-a',
					layout: 'week',
					weekStartsOn: 'monday',
				},
			);
		});
		await vi.waitFor(() => {
			expect(applySavedViewCatalog).toHaveBeenCalledWith(
				expect.objectContaining({ source: 'canonical' }),
			);
			expect(persistUiState).toHaveBeenCalledWith(
				'calendar-a',
				expect.objectContaining({ type: 'calendar' }),
			);
		});
	});

	it('ignores a layout commit that completes after deactivation', async () => {
		let releaseCommit!: () => void;
		const commitGate = new Promise<void>((resolve) => {
			releaseCommit = resolve;
		});
		const viewCatalog = calendarConfig().viewCatalog;
		if (!viewCatalog) throw new Error('Expected saved-view catalog.');
		const {
			applySavedViewCatalog,
			container,
			persistUiState,
			savedViewCommit,
			surface,
		} = setup({
			snapshot: snapshot([]),
		});
		let commitCompleted = false;
		savedViewCommit.mockImplementation(async () => {
			await commitGate;
			commitCompleted = true;
			return viewCatalog;
		});
		const layout = container.querySelectorAll<
			InstanceType<typeof surfaceHarness.MockElement>
		>('.cv-layout-select')[0];
		if (!layout) throw new Error('Expected layout selector.');
		layout.value = 'week';
		layout.emit('change');

		await vi.waitFor(() => expect(savedViewCommit).toHaveBeenCalledOnce());
		surface.deactivate();
		releaseCommit();
		await vi.waitFor(() => expect(commitCompleted).toBe(true));

		expect(applySavedViewCatalog).not.toHaveBeenCalled();
		expect(persistUiState).not.toHaveBeenCalled();
		expect(surfaceHarness.notices).toEqual([]);
	});
});

describe('calendar surface event menu', () => {
	it('moves the event note to Obsidian trash from the context menu', async () => {
		const eventFile = { path: 'Life/Work/Planning.md' };
		const { container, root, trashFile } = setup({
			getFileByPath: () => eventFile,
		});
		const card = cards(container)[0];
		const preventDefault = vi.fn();
		const stopPropagation = vi.fn();
		const event = {
			preventDefault,
			stopPropagation,
			targetNode: card?.children[0],
		} as unknown as MouseEvent;
		surfaceHarness.emitDom(root, 'contextmenu', event);

		expect(surfaceHarness.menuItems).toHaveLength(1);
		expect(surfaceHarness.menuItems[0]).toMatchObject({
			title: 'Move to trash',
			icon: 'trash-2',
			warning: true,
		});
		surfaceHarness.menuItems[0]?.onClick?.();
		await vi.waitFor(() => expect(trashFile).toHaveBeenCalledWith(eventFile));
	});

	it('refreshes a stale card when its note no longer exists', async () => {
		const { container, handleFileDeleted, root, trashFile } = setup({
			getFileByPath: () => null,
		});
		const path = cards(container)[0]?.dataset.path;
		const event = {
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
			targetNode: cards(container)[0]?.children[0],
		} as unknown as MouseEvent;
		surfaceHarness.emitDom(root, 'contextmenu', event);
		surfaceHarness.menuItems[0]?.onClick?.();

		await vi.waitFor(() => expect(handleFileDeleted).toHaveBeenCalledWith(path));
		expect(trashFile).not.toHaveBeenCalled();
		expect(surfaceHarness.notices).toEqual([
			`${path} was moved or deleted. The calendar will refresh.`,
		]);
	});

	it('reports a trash failure without rejecting the menu action', async () => {
		const trashFile = vi.fn().mockRejectedValue(new Error('Trash is unavailable.'));
		const { container, root } = setup({ trashFile });
		const event = {
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
			targetNode: cards(container)[0]?.children[0],
		} as unknown as MouseEvent;
		surfaceHarness.emitDom(root, 'contextmenu', event);
		surfaceHarness.menuItems[0]?.onClick?.();

		await vi.waitFor(() => {
			expect(surfaceHarness.notices).toEqual(['Trash is unavailable.']);
		});
	});
});
