import { afterEach, describe, expect, it, vi } from 'vitest';

interface ElementOptions {
	attr?: Record<string, string>;
	cls?: string;
	text?: string;
	type?: string;
	value?: string;
}

const viewHarness = vi.hoisted(() => {
	const cleanups = new WeakMap<object, Array<() => void>>();
	const domEvents = new WeakMap<
		object,
		Map<string, Array<(event: unknown) => void>>
	>();
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
		lang = '';
		readonly nodeType = 1;
		parentElement?: MockElement;
		scrollTop = 0;
		tabIndex = 0;
		value = '';
		readonly style = { setProperty: vi.fn() };

		constructor(
			readonly ownerDocument: Document,
			readonly tag = 'div',
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

		createDiv(options?: ElementOptions): MockElement {
			return this.create('div', options);
		}

		createEl(tag: string, options?: ElementOptions): MockElement {
			return this.create(tag, options);
		}

		createSpan(options?: ElementOptions): MockElement {
			return this.create('span', options);
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

		setBounds(left: number, width: number): void {
			this.bounds = {
				...this.bounds,
				left,
				right: left + width,
				width,
				x: left,
			};
		}

		private create(tag: string, options?: ElementOptions): MockElement {
			const child = new MockElement(this.ownerDocument, tag, options);
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
		emit(target: object, event: string, detail: unknown = {}) {
			for (const handler of domEvents.get(target)?.get(event) ?? []) handler(detail);
		},
		registerDomEvent(target: object, event: string, handler: (event: unknown) => void) {
			const events =
				domEvents.get(target) ??
				new Map<string, Array<(event: unknown) => void>>();
			const handlers: Array<(event: unknown) => void> = events.get(event) ?? [];
			handlers.push(handler);
			events.set(event, handlers);
			domEvents.set(target, events);
		},
		registerCleanup(component: object, callback: () => void) {
			const callbacks = cleanups.get(component) ?? [];
			callbacks.push(callback);
			cleanups.set(component, callbacks);
		},
		runCleanups(component: object) {
			for (const callback of cleanups.get(component) ?? []) callback();
			cleanups.delete(component);
		},
	};
});

vi.mock('obsidian', () => ({
	ItemView: class {
		app: unknown;
		contentEl: InstanceType<typeof viewHarness.MockElement>;
		icon = '';
		leaf: unknown;

		constructor(leaf: {
			app: unknown;
			contentEl: InstanceType<typeof viewHarness.MockElement>;
		}) {
			this.app = leaf.app;
			this.contentEl = leaf.contentEl;
			this.leaf = leaf;
		}

		registerDomEvent(
			target: object,
			event: string,
			handler: (event: unknown) => void,
		): void {
			viewHarness.registerDomEvent(target, event, handler);
		}

		register(callback: () => void): void {
			viewHarness.registerCleanup(this, callback);
		}
	},
	Menu: class {
		addItem(
			callback: (item: {
				onClick(callback: () => unknown): unknown;
				setIcon(icon: string): unknown;
				setTitle(title: string): unknown;
				setWarning(warning: boolean): unknown;
			}) => unknown,
		): this {
			const state: (typeof viewHarness.menuItems)[number] = {};
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
			viewHarness.menuItems.push(state);
			return this;
		}

		showAtMouseEvent(event: unknown): this {
			viewHarness.shownMenuEvents.push(event);
			return this;
		}
	},
	Notice: class {
		constructor(message: string) {
			viewHarness.notices.push(message);
		}
	},
	setIcon: vi.fn(),
}));

vi.mock('./calendar-card', () => ({
	calendarRelationshipAccessibleSummary: () => '',
	calendarRelationshipRowCount: () => 0,
	renderCardProperties: vi.fn(),
	renderCardRelationships: vi.fn(),
}));
vi.mock('./calendar-list-modal', () => ({ CalendarIssuesModal: class {} }));
vi.mock('./calendar-settings-modal', () => ({ CalendarSettingsModal: class {} }));
vi.mock('./event-editor-modal', () => ({ EventEditorModal: class {} }));
vi.mock('./event-title-modal', () => ({ EventTitleModal: class {} }));

import type CalendarViewPlugin from '../main';
import type { CalendarSegment } from '../domain/range-layout';
import { FrontmatterWriter } from '../services/frontmatter-writer';
import type { CalendarConfig, CalendarItem } from '../types';
import { CalendarView } from './calendar-view';

function calendarConfig(): CalendarConfig {
	return {
		documentPath: 'Life/Work/_calendar.md',
		name: 'Work',
		sourceFolder: 'Life/Work',
		recursive: true,
		startDateProperty: 'date',
		visibleProperties: [],
		propertyDefinitions: {},
		weekStartsOn: 'monday',
		layout: 'month',
		openBehavior: 'same-leaf',
		createFolder: 'Life/Work',
		excludePaths: [],
	};
}

function allElements(
	root: InstanceType<typeof viewHarness.MockElement>,
): Array<InstanceType<typeof viewHarness.MockElement>> {
	return [root, ...root.children.flatMap((child) => allElements(child))];
}

function dayCell(
	root: InstanceType<typeof viewHarness.MockElement>,
	date: string,
): InstanceType<typeof viewHarness.MockElement> {
	const cell = allElements(root).find(
		(element) => element.classes.has('cv-day-cell') && element.dataset.date === date,
	);
	if (!cell) throw new Error(`Expected day cell for ${date}.`);
	return cell;
}

describe('calendar view today marker', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('moves the today highlight when an open view crosses local midnight', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 7, 31, 23, 59, 59));

		const timerFunctions = { clearTimeout, setTimeout };
		const ownerWindow = {
			clearTimeout: (id: number) => timerFunctions.clearTimeout(id),
			crypto: { randomUUID: () => 'calendar-view-instance' },
			requestAnimationFrame: (callback: () => void) => callback(),
			setTimeout: (callback: () => void, delay: number) =>
				timerFunctions.setTimeout(callback, delay) as unknown as number,
		};
		const ownerDocument = { defaultView: ownerWindow } as unknown as Document;
		const contentEl = new viewHarness.MockElement(ownerDocument);
		const config = calendarConfig();
		const snapshot = { items: [], issues: [], indexedCount: 0 };
		const index = {
			subscribe: (subscriber: (value: typeof snapshot) => void) => {
				subscriber(snapshot);
				return vi.fn();
			},
		};
		const app = {
			vault: { getFileByPath: () => ({ path: config.documentPath }) },
			workspace: { requestSaveLayout: vi.fn() },
		};
		const plugin = {
			documents: {
				read: () => ({ config, issues: [] }),
				validateLocations: () => [],
			},
			indexes: {
				acquire: vi.fn().mockResolvedValue(index),
				release: vi.fn(),
				updateConfig: vi.fn(),
			},
			registerViewInstance: vi.fn(),
			unregisterViewInstance: vi.fn(),
			stateStore: {
				get: vi.fn(),
				markRecent: vi.fn().mockResolvedValue(undefined),
				set: vi.fn().mockResolvedValue(undefined),
			},
		} as unknown as CalendarViewPlugin;
		const view = new CalendarView(
			{ app, contentEl } as never,
			plugin,
		);

		await view.setState(
			{ calendarDocumentPath: config.documentPath, instanceId: 'calendar-view-instance' },
			{} as never,
		);
		await (view as unknown as { onOpen: () => Promise<void> }).onOpen();

		expect(dayCell(contentEl, '2026-08-31').classes.has('is-today')).toBe(true);
		expect(dayCell(contentEl, '2026-09-01').classes.has('is-today')).toBe(false);

		await vi.advanceTimersByTimeAsync(1_100);

		expect(dayCell(contentEl, '2026-08-31').classes.has('is-today')).toBe(false);
		expect(dayCell(contentEl, '2026-09-01').classes.has('is-today')).toBe(true);

		vi.setSystemTime(new Date(2026, 8, 2, 8));
		viewHarness.emit(ownerWindow, 'focus');

		expect(dayCell(contentEl, '2026-09-01').classes.has('is-today')).toBe(false);
		expect(dayCell(contentEl, '2026-09-02').classes.has('is-today')).toBe(true);

		await (view as unknown as { onClose: () => Promise<void> }).onClose();
		expect(vi.getTimerCount()).toBe(0);

		await (view as unknown as { onOpen: () => Promise<void> }).onOpen();
		expect(vi.getTimerCount()).toBe(1);
		viewHarness.runCleanups(view);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('calendar event card drag', () => {
	afterEach(() => {
		viewHarness.notices.length = 0;
		vi.clearAllMocks();
	});

	it('moves an event after native drag initiation cancels the pointer stream', async () => {
		const ownerWindow = {
			clearTimeout: vi.fn(),
			crypto: { randomUUID: () => 'calendar-view-instance' },
			requestAnimationFrame: (callback: () => void) => callback(),
			setTimeout: vi.fn().mockReturnValue(1),
		};
		const ownerDocument = { defaultView: ownerWindow } as unknown as Document;
		const contentEl = new viewHarness.MockElement(ownerDocument);
		const config = calendarConfig();
		const item: CalendarItem = {
			path: 'Life/Work/Planning.md',
			title: 'Planning',
			start: '2026-09-01',
			startTimeSort: 0,
			allDay: true,
			properties: { date: '2026-09-01' },
			mtime: 10,
			subItems: [],
		};
		const calendarFile = { path: config.documentPath, stat: { mtime: 1 } };
		const eventFile = { path: item.path, stat: { mtime: item.mtime } };
		const frontmatter = { date: item.start };
		const processFrontMatter = vi.fn(
			async (
				_file: typeof eventFile,
				mutate: (value: Record<string, unknown>) => void,
			) => mutate(frontmatter),
		);
		const writer = new FrontmatterWriter({
			getFileByPath: (path) => (path === item.path ? eventFile : null),
			processFrontMatter,
		});
		const app = {
			vault: {
				getFileByPath: vi.fn((path: string) => {
					if (path === config.documentPath) return calendarFile;
					if (path === item.path) return eventFile;
					return null;
				}),
			},
			workspace: { requestSaveLayout: vi.fn() },
		};
		const snapshot = { items: [item], issues: [], indexedCount: 1 };
		const index = {
			subscribe: (subscriber: (value: typeof snapshot) => void) => {
				subscriber(snapshot);
				return vi.fn();
			},
		};
		const plugin = {
			documents: {
				read: () => ({ config, issues: [] }),
				validateLocations: () => [],
			},
			indexes: {
				acquire: vi.fn().mockResolvedValue(index),
				release: vi.fn(),
				updateConfig: vi.fn(),
			},
			registerViewInstance: vi.fn(),
			unregisterViewInstance: vi.fn(),
			stateStore: {
				get: vi.fn().mockReturnValue({ focusDate: '2026-09-01' }),
				markRecent: vi.fn().mockResolvedValue(undefined),
				set: vi.fn().mockResolvedValue(undefined),
			},
			writer,
		} as unknown as CalendarViewPlugin;
		const view = new CalendarView({ app, contentEl } as never, plugin);
		await view.setState(
			{ calendarDocumentPath: config.documentPath, instanceId: 'calendar-view-instance' },
			{} as never,
		);
		await (view as unknown as { onOpen(): Promise<void> }).onOpen();

		const card = allElements(contentEl).find((element) =>
			element.classes.has('cv-event-card'),
		);
		const targetCell = dayCell(contentEl, '2026-09-03');
		const week = targetCell.closest<InstanceType<typeof viewHarness.MockElement>>(
			'.cv-week-row',
		);
		if (!card || !week) throw new Error('Expected rendered drag targets.');
		week.setBounds(0, 700);
		const setData = vi.fn();
		const dragOverPreventDefault = vi.fn();
		const dropPreventDefault = vi.fn();

		card.emit('dragstart', {
			dataTransfer: { effectAllowed: 'none', setData },
		});
		viewHarness.emit(ownerWindow, 'pointercancel', { pointerId: 1 });
		week.emit('dragover', {
			clientX: 350,
			preventDefault: dragOverPreventDefault,
		});
		expect(dragOverPreventDefault).toHaveBeenCalledOnce();
		expect(targetCell.classes.has('is-drag-target')).toBe(true);
		week.emit('drop', {
			clientX: 350,
			preventDefault: dropPreventDefault,
		});

		await vi.waitFor(
			() => expect(frontmatter.date).toBe('2026-09-03'),
			{ interval: 10, timeout: 200 },
		);
		expect(processFrontMatter).toHaveBeenCalledOnce();
		expect(setData).toHaveBeenCalledWith('text/plain', item.path);
		expect(dropPreventDefault).toHaveBeenCalledOnce();
		expect(viewHarness.notices).toEqual([]);
	});
});

describe('calendar event card menu', () => {
	afterEach(() => {
		viewHarness.menuItems.length = 0;
		viewHarness.notices.length = 0;
		viewHarness.shownMenuEvents.length = 0;
		vi.clearAllMocks();
	});

	it('moves the event note to the configured Obsidian trash from the context menu', async () => {
		const ownerDocument = { defaultView: null } as unknown as Document;
		const contentEl = new viewHarness.MockElement(ownerDocument);
		const layer = contentEl.createDiv();
		const file = { path: 'Life/Work/Planning.md' };
		const trashFile = vi.fn().mockResolvedValue(undefined);
		const app = {
			fileManager: { trashFile },
			vault: { getFileByPath: vi.fn().mockReturnValue(file) },
		};
		const plugin = {
			indexes: { handleFileDeleted: vi.fn() },
		} as unknown as CalendarViewPlugin;
		const view = new CalendarView({ app, contentEl } as never, plugin);
		const item: CalendarItem = {
			path: file.path,
			title: 'Planning',
			start: '2026-09-01',
			startTimeSort: 0,
			allDay: true,
			properties: {},
			mtime: 1,
			subItems: [],
		};
		const segment: CalendarSegment = {
			item,
			weekIndex: 0,
			startDate: item.start,
			endDate: item.start,
			startColumn: 0,
			span: 1,
			continuesBefore: false,
			continuesAfter: false,
			track: 0,
		};
		const internals = view as unknown as {
			config: CalendarConfig;
			openItemMenu(event: MouseEvent): void;
			renderSegment(target: HTMLElement, value: CalendarSegment): void;
		};
		internals.config = calendarConfig();
		internals.renderSegment(layer as unknown as HTMLElement, segment);

		const card = layer.children[0];
		const preventDefault = vi.fn();
		const stopPropagation = vi.fn();
		const event = {
			preventDefault,
			stopPropagation,
			targetNode: card?.children[0],
		} as unknown as MouseEvent;
		internals.openItemMenu(event);

		expect(preventDefault).toHaveBeenCalledOnce();
		expect(stopPropagation).toHaveBeenCalledOnce();
		expect(viewHarness.shownMenuEvents).toEqual([event]);
		expect(viewHarness.menuItems).toHaveLength(1);
		expect(viewHarness.menuItems[0]).toMatchObject({
			title: 'Move to trash',
			icon: 'trash-2',
			warning: true,
		});
		expect(trashFile).not.toHaveBeenCalled();

		viewHarness.menuItems[0]?.onClick?.();
		await vi.waitFor(() => expect(trashFile).toHaveBeenCalledWith(file));
	});

	it('refreshes a stale card when its note no longer exists', async () => {
		const ownerDocument = { defaultView: null } as unknown as Document;
		const contentEl = new viewHarness.MockElement(ownerDocument);
		const trashFile = vi.fn();
		const handleFileDeleted = vi.fn();
		const app = {
			fileManager: { trashFile },
			vault: { getFileByPath: vi.fn().mockReturnValue(null) },
		};
		const plugin = {
			indexes: { handleFileDeleted },
		} as unknown as CalendarViewPlugin;
		const view = new CalendarView({ app, contentEl } as never, plugin);
		const path = 'Life/Work/Missing.md';

		await (
			view as unknown as {
				moveItemToTrash(value: string): Promise<void>;
			}
		).moveItemToTrash(path);

		expect(trashFile).not.toHaveBeenCalled();
		expect(handleFileDeleted).toHaveBeenCalledWith(path);
		expect(viewHarness.notices).toEqual([
			`${path} was moved or deleted. The calendar will refresh.`,
		]);
	});

	it('reports a trash failure without rejecting the menu action', async () => {
		const ownerDocument = { defaultView: null } as unknown as Document;
		const contentEl = new viewHarness.MockElement(ownerDocument);
		const file = { path: 'Life/Work/Protected.md' };
		const trashFile = vi.fn().mockRejectedValue(new Error('Trash is unavailable.'));
		const app = {
			fileManager: { trashFile },
			vault: { getFileByPath: vi.fn().mockReturnValue(file) },
		};
		const plugin = {
			indexes: { handleFileDeleted: vi.fn() },
		} as unknown as CalendarViewPlugin;
		const view = new CalendarView({ app, contentEl } as never, plugin);

		await (
			view as unknown as {
				moveItemToTrash(value: string): Promise<void>;
			}
		).moveItemToTrash(file.path);

		expect(trashFile).toHaveBeenCalledWith(file);
		expect(viewHarness.notices).toEqual(['Trash is unavailable.']);
	});
});
