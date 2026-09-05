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
		disabled?: boolean;
		icon?: string;
		onClick?: () => unknown;
		title?: string;
		warning?: boolean;
	}> = [];
	const notices: string[] = [];
	const openedModals: string[] = [];
	const modalCallbacks: Record<
		string,
		((...args: unknown[]) => unknown) | undefined
	> = {};
	const shownMenuEvents: unknown[] = [];

	class MockFragment {
		readonly children: MockElement[] = [];

		append(...nodes: MockElement[]): void {
			this.children.push(...nodes);
		}
	}

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
		attributes: Record<string, string> = {};
		dataset: Record<string, string> = {};
		disabled = false;
		draggable = false;
		id = '';
		lang = '';
		readonly nodeType = 1;
		parentElement?: MockElement;
		scrollLeft = 0;
		scrollTop = 0;
		tabIndex = 0;
		text = '';
		value = '';
		readonly style = { setProperty: vi.fn() };

		constructor(
			readonly ownerDocument: Document,
			readonly tag = 'div',
			options?: ElementOptions,
		) {
			const mutableDocument = ownerDocument as unknown as {
				createDocumentFragment?: () => MockFragment;
				createElement?: (tag: string) => MockElement;
			};
			mutableDocument.createDocumentFragment ??= () => new MockFragment();
			mutableDocument.createElement ??= (tag) =>
				new MockElement(ownerDocument, tag);
			for (const className of options?.cls?.split(/\s+/u) ?? []) {
				if (className) this.classes.add(className);
			}
			for (const [name, value] of Object.entries(options?.attr ?? {})) {
				this.setAttribute(name, value);
			}
			if (options?.text) this.text = options.text;
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

		focus(): void {
			(
				this.ownerDocument as unknown as {
					activeElement: MockElement;
				}
			).activeElement = this;
		}

		querySelectorAll<T>(selector: string): T[] {
			const className = selector.startsWith('.') ? selector.slice(1) : undefined;
			return this.children
				.flatMap((child) => [child, ...child.querySelectorAll<MockElement>(selector)])
				.filter((element) => {
					if (className) return element.classes.has(className);
					if (selector === '[role="tab"]') return element.attributes.role === 'tab';
					return false;
				}) as T[];
		}

		remove(): void {
			if (!this.parentElement) return;
			const index = this.parentElement.children.indexOf(this);
			if (index >= 0) this.parentElement.children.splice(index, 1);
			this.parentElement = undefined;
		}

		removeEventListener(
			event: string,
			handler: (detail: Record<string, unknown>) => void,
		): void {
			const handlers = this.listeners.get(event);
			if (!handlers) return;
			const index = handlers.indexOf(handler);
			if (index >= 0) handlers.splice(index, 1);
		}

		removeClass(className: string): void {
			this.classes.delete(className);
		}

		setAttribute(name: string, value: string): void {
			this.attributes[name] = value;
			if (name === 'id') this.id = value;
		}

		scrollIntoView(): void {}

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
		modalCallbacks,
		notices,
		openedModals,
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
			return () => {
				const current = domEvents.get(target)?.get(event);
				if (!current) return;
				const index = current.indexOf(handler);
				if (index >= 0) current.splice(index, 1);
			};
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

vi.mock('obsidian', () => {
	class Component {
		load(): void {
			(this as { onload?: () => void }).onload?.();
		}

		unload(): void {
			viewHarness.runCleanups(this);
			(this as { onunload?: () => void }).onunload?.();
		}

		registerDomEvent(
			target: object,
			event: string,
			handler: (event: unknown) => void,
		): void {
			this.register(viewHarness.registerDomEvent(target, event, handler));
		}

		register(callback: () => void): void {
			viewHarness.registerCleanup(this, callback);
		}
	}

	return {
	Component,
	ItemView: class extends Component {
		app: unknown;
		contentEl: InstanceType<typeof viewHarness.MockElement>;
		icon = '';
		leaf: unknown;

		constructor(leaf: {
			app: unknown;
			contentEl: InstanceType<typeof viewHarness.MockElement>;
		}) {
			super();
			this.app = leaf.app;
			this.contentEl = leaf.contentEl;
			this.leaf = leaf;
		}

	},
	Menu: class {
		addItem(
			callback: (item: {
				onClick(callback: () => unknown): unknown;
				setIcon(icon: string): unknown;
				setDisabled(disabled: boolean): unknown;
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
				setDisabled: (disabled: boolean) => {
					state.disabled = disabled;
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

		addSeparator(): this {
			return this;
		}

		showAtMouseEvent(event: unknown): this {
			viewHarness.shownMenuEvents.push(event);
			return this;
		}

		showAtPosition(position: unknown): this {
			viewHarness.shownMenuEvents.push(position);
			return this;
		}
	},
	Notice: class {
		constructor(message: string) {
			viewHarness.notices.push(message);
		}
	},
	setIcon: vi.fn(),
	setTooltip: vi.fn(),
	};
});

vi.mock('./calendar-card', () => ({
	calendarRelationshipAccessibleSummary: () => '',
	calendarRelationshipRowCount: () => 0,
	renderCardProperties: vi.fn(),
	renderCardRelationships: vi.fn(),
}));
vi.mock('./calendar-list-modal', () => ({
	CalendarIssuesModal: class {
		open(): void {
			viewHarness.openedModals.push('issues');
		}
	},
}));
vi.mock('./calendar-settings-modal', () => ({
	CalendarSettingsModal: class {
		constructor(...args: unknown[]) {
			viewHarness.modalCallbacks.settings = args[2] as (
				...callbackArgs: unknown[]
			) => unknown;
		}

		open(): void {
			viewHarness.openedModals.push('settings');
		}
	},
}));
vi.mock('./saved-view-modals', () => ({
	AddSavedViewModal: class {
		constructor(...args: unknown[]) {
			viewHarness.modalCallbacks.add = args[4] as (
				...callbackArgs: unknown[]
			) => unknown;
			viewHarness.modalCallbacks.addProperties = args[5] as (
				...callbackArgs: unknown[]
			) => unknown;
		}

		open(): void {
			viewHarness.openedModals.push('add-view');
		}
	},
	DeleteSavedViewModal: class {
		constructor(...args: unknown[]) {
			viewHarness.modalCallbacks.delete = args[3] as (
				...callbackArgs: unknown[]
			) => unknown;
		}

		open(): void {
			viewHarness.openedModals.push('delete-view');
		}
	},
	EditSavedViewModal: class {
		constructor(...args: unknown[]) {
			viewHarness.modalCallbacks.edit = args[3] as (
				...callbackArgs: unknown[]
			) => unknown;
		}

		open(): void {
			viewHarness.openedModals.push('edit-view');
		}
	},
	RenameSavedViewModal: class {
		constructor(...args: unknown[]) {
			viewHarness.modalCallbacks.rename = args[4] as (
				...callbackArgs: unknown[]
			) => unknown;
		}

		open(): void {
			viewHarness.openedModals.push('rename-view');
		}
	},
}));
vi.mock('./event-editor-modal', () => ({ EventEditorModal: class {} }));
vi.mock('./event-title-modal', () => ({ EventTitleModal: class {} }));

import type CalendarViewPlugin from '../main';
import { FrontmatterWriter } from '../services/frontmatter-writer';
import type {
	CalendarConfig,
	CalendarItem,
	ConfigIssue,
	SavedView,
} from '../types';
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

function setupPendingIndexAcquire(emitOnSubscribe = true) {
	const ownerWindow = {
		clearTimeout: vi.fn(),
		crypto: { randomUUID: () => 'calendar-view-instance' },
		requestAnimationFrame: (callback: () => void) => callback(),
		setTimeout: vi.fn().mockReturnValue(1),
	};
	const ownerDocument = { defaultView: ownerWindow } as unknown as Document;
	const contentEl = new viewHarness.MockElement(ownerDocument);
	const config = calendarConfig();
	const snapshot = { items: [], issues: [], indexedCount: 0 };
	const unsubscribe = vi.fn();
	let activeSubscriber: ((value: typeof snapshot) => void) | undefined;
	const subscribe = vi.fn((subscriber: (value: typeof snapshot) => void) => {
		activeSubscriber = subscriber;
		if (emitOnSubscribe) subscriber(snapshot);
		return unsubscribe;
	});
	const index = { subscribe };
	let resolveAcquire!: (value: typeof index) => void;
	const acquirePromise = new Promise<typeof index>((resolve) => {
		resolveAcquire = resolve;
	});
	const acquire = vi.fn().mockReturnValue(acquirePromise);
	const release = vi.fn();
	const updateConfig = vi.fn().mockResolvedValue(undefined);
	const unregisterViewInstance = vi.fn();
	const setUiState = vi.fn().mockResolvedValue(undefined);
	const getFileByPath = vi.fn(
		(): { path: string } | null => ({ path: config.documentPath }),
	);
	const readDocument = vi.fn(
		(): { config?: CalendarConfig; issues: ConfigIssue[] } => ({ config, issues: [] }),
	);
	const app = {
		vault: { getFileByPath },
		workspace: { requestSaveLayout: vi.fn() },
	};
	const plugin = {
		documents: {
			read: readDocument,
			validateLocations: () => [],
		},
		indexes: { acquire, release, updateConfig },
		registerViewInstance: vi.fn(),
		unregisterViewInstance,
		stateStore: {
			get: vi.fn(),
			markRecent: vi.fn().mockResolvedValue(undefined),
			set: setUiState,
		},
	} as unknown as CalendarViewPlugin;
	const view = new CalendarView({ app, contentEl } as never, plugin);
	return {
		acquire,
		config,
		contentEl,
		emitSnapshot: (nextSnapshot = snapshot) => activeSubscriber?.(nextSnapshot),
		getFileByPath,
		index,
		readDocument,
		release,
		resolveAcquire,
		setUiState,
		subscribe,
		unsubscribe,
		unregisterViewInstance,
		updateConfig,
		view,
	};
}

function setupSwitchableCalendarHosts() {
	const ownerWindow = {
		clearTimeout: vi.fn(),
		crypto: { randomUUID: () => 'calendar-view-instance' },
		requestAnimationFrame: (callback: () => void) => callback(),
		setTimeout: vi.fn().mockReturnValue(1),
	};
	const ownerDocument = { defaultView: ownerWindow } as unknown as Document;
	const contentEl = new viewHarness.MockElement(ownerDocument);
	const configA: CalendarConfig = {
		...calendarConfig(),
		documentPath: 'Calendars/A.md',
		name: 'Calendar A',
		sourceFolder: 'Calendars/A',
		viewCatalog: {
			source: 'canonical',
			canMutate: true,
			entries: [
				{
					kind: 'valid',
					definition: {
						id: 'calendar-a',
						name: 'Calendar A',
						type: 'calendar',
						layout: 'month',
						weekStartsOn: 'monday',
					},
				},
			],
		},
	};
	const configB: CalendarConfig = {
		...calendarConfig(),
		documentPath: 'Calendars/B.md',
		name: 'Calendar B',
		sourceFolder: 'Calendars/B',
		viewCatalog: {
			source: 'canonical',
			canMutate: true,
			entries: [
				{
					kind: 'valid',
					definition: {
						id: 'calendar-b',
						name: 'Calendar B',
						type: 'calendar',
						layout: 'month',
						weekStartsOn: 'monday',
					},
				},
			],
		},
	};
	const snapshotA = { items: [], issues: [], indexedCount: 1 };
	const snapshotB = { items: [], issues: [], indexedCount: 2 };
	const subscribers = new Map<
		string,
		(snapshot: typeof snapshotA) => void
	>();
	const unsubscribeA = vi.fn();
	const unsubscribeB = vi.fn();
	const indexA = {
		subscribe: vi.fn((subscriber: (snapshot: typeof snapshotA) => void) => {
			subscribers.set(configA.documentPath, subscriber);
			subscriber(snapshotA);
			return unsubscribeA;
		}),
	};
	const indexB = {
		subscribe: vi.fn((subscriber: (snapshot: typeof snapshotB) => void) => {
			subscribers.set(configB.documentPath, subscriber);
			subscriber(snapshotB);
			return unsubscribeB;
		}),
	};
	const updateConfig = vi.fn().mockResolvedValue(undefined);
	const setUiState = vi.fn().mockResolvedValue(undefined);
	const app = {
		vault: { getFileByPath: (path: string) => ({ path }) },
		workspace: { requestSaveLayout: vi.fn() },
	};
	const plugin = {
		documents: {
			read: (file: { path: string }) => ({
				config: file.path === configA.documentPath ? configA : configB,
				issues: [],
			}),
			validateLocations: () => [],
		},
		indexes: {
			acquire: vi.fn((config: CalendarConfig) =>
				Promise.resolve(config.documentPath === configA.documentPath ? indexA : indexB),
			),
			release: vi.fn(),
			updateConfig,
		},
		registerViewInstance: vi.fn(),
		unregisterViewInstance: vi.fn(),
		stateStore: {
			get: vi.fn((path: string) => ({
				activeViewId:
					path === configA.documentPath ? 'calendar-a' : 'calendar-b',
				viewStates: {},
			})),
			markRecent: vi.fn().mockResolvedValue(undefined),
			set: setUiState,
		},
	} as unknown as CalendarViewPlugin;
	const view = new CalendarView({ app, contentEl } as never, plugin);
	return {
		configA,
		configB,
		contentEl,
		ownerDocument,
		plugin,
		setUiState,
		snapshotA,
		snapshotB,
		subscribers,
		unsubscribeA,
		unsubscribeB,
		updateConfig,
		view,
	};
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

describe('calendar view surface host', () => {
	afterEach(() => {
		viewHarness.openedModals.length = 0;
		for (const key of Object.keys(viewHarness.modalCallbacks)) {
			delete viewHarness.modalCallbacks[key];
		}
		vi.clearAllMocks();
	});

	it('serializes refresh and setState while index acquisition is pending', async () => {
		const {
			acquire,
			config,
			contentEl,
			index,
			release,
			resolveAcquire,
			subscribe,
			unsubscribe,
			updateConfig,
			view,
		} = setupPendingIndexAcquire();
		const state = {
			calendarDocumentPath: config.documentPath,
			instanceId: 'pending-index-leaf',
		};
		await view.setState(state, {} as never);
		const open = (view as unknown as { onOpen(): Promise<void> }).onOpen();
		await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce());

		const refresh = view.refreshCalendarDocument();
		const restoreState = view.setState(state, {} as never);
		await Promise.resolve();
		expect(acquire).toHaveBeenCalledOnce();
		expect(subscribe).not.toHaveBeenCalled();

		resolveAcquire(index);
		await Promise.all([open, refresh, restoreState]);

		expect(acquire).toHaveBeenCalledOnce();
		expect(subscribe).toHaveBeenCalledOnce();
		expect(updateConfig).toHaveBeenCalledTimes(2);
		expect(
			allElements(contentEl).filter((element) =>
				element.classes.has('cv-view-surface'),
			),
		).toHaveLength(1);

		await (view as unknown as { onClose(): Promise<void> }).onClose();
		expect(unsubscribe).toHaveBeenCalledOnce();
		expect(release).toHaveBeenCalledOnce();
		expect(release).toHaveBeenCalledWith(config.documentPath);
	});

	it('releases a pending acquired index after close without mounting a surface', async () => {
		const {
			acquire,
			config,
			contentEl,
			index,
			release,
			resolveAcquire,
			subscribe,
			unregisterViewInstance,
			view,
		} = setupPendingIndexAcquire();
		await view.setState(
			{
				calendarDocumentPath: config.documentPath,
				instanceId: 'closing-index-leaf',
			},
			{} as never,
		);
		const open = (view as unknown as { onOpen(): Promise<void> }).onOpen();
		await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce());

		const close = (view as unknown as { onClose(): Promise<void> }).onClose();
		resolveAcquire(index);
		await Promise.all([open, close]);

		expect(release).toHaveBeenCalledOnce();
		expect(release).toHaveBeenCalledWith(config.documentPath);
		expect(subscribe).not.toHaveBeenCalled();
		expect(unregisterViewInstance).toHaveBeenCalledWith(view);
		expect(
			allElements(contentEl).some((element) =>
				element.classes.has('cv-view-surface'),
			),
		).toBe(false);
	});

	it('always releases the host when final surface persistence fails', async () => {
		const {
			config,
			contentEl,
			index,
			release,
			resolveAcquire,
			setUiState,
			unsubscribe,
			unregisterViewInstance,
			view,
		} = setupPendingIndexAcquire();
		await view.setState(
			{ calendarDocumentPath: config.documentPath, instanceId: 'failing-close-leaf' },
			{} as never,
		);
		const open = (view as unknown as { onOpen(): Promise<void> }).onOpen();
		resolveAcquire(index);
		await open;
		await Promise.resolve();
		setUiState.mockRejectedValueOnce(new Error('Unable to persist view state.'));

		await expect(
			(view as unknown as { onClose(): Promise<void> }).onClose(),
		).rejects.toThrow('Unable to persist view state.');

		expect(unsubscribe).toHaveBeenCalledOnce();
		expect(release).toHaveBeenCalledWith(config.documentPath);
		expect(unregisterViewInstance).toHaveBeenCalledWith(view);
		expect(
			(view as unknown as { activeSurface?: unknown }).activeSurface,
		).toBeUndefined();

		const closedHost = view as unknown as {
			renderDocumentError(): void;
			syncSurface(): void;
		};
		closedHost.syncSurface();
		closedHost.renderDocumentError();
		expect(
			allElements(contentEl).some((element) =>
				element.classes.has('cv-document-error'),
			),
		).toBe(false);
	});

	it('restores the old surface when an identity transition cannot persist it', async () => {
		const {
			config,
			contentEl,
			index,
			resolveAcquire,
			setUiState,
			subscribe,
			view,
		} = setupPendingIndexAcquire(false);
		await view.setState(
			{ calendarDocumentPath: config.documentPath, instanceId: 'original-leaf' },
			{} as never,
		);
		const open = (view as unknown as { onOpen(): Promise<void> }).onOpen();
		resolveAcquire(index);
		await open;
		await Promise.resolve();
		setUiState.mockRejectedValueOnce(new Error('Unable to persist old identity.'));

		await expect(
			view.setState(
				{ calendarDocumentPath: config.documentPath, instanceId: 'replacement-leaf' },
				{} as never,
			),
		).rejects.toThrow('Unable to persist old identity.');

		expect(subscribe).toHaveBeenCalledTimes(2);
		expect(
			(view as unknown as { activeSurface?: unknown }).activeSurface,
		).toBeDefined();
		expect(
			allElements(contentEl).filter((element) =>
				element.classes.has('cv-view-surface'),
			),
		).toHaveLength(1);
		await (view as unknown as { onClose(): Promise<void> }).onClose();
	});

	it.each(['missing', 'invalid'] as const)(
		'does not render a stale %s-document error after close',
		async (failure) => {
			const {
				config,
				contentEl,
				getFileByPath,
				index,
				readDocument,
				resolveAcquire,
				setUiState,
				view,
			} = setupPendingIndexAcquire();
			await view.setState(
				{ calendarDocumentPath: config.documentPath, instanceId: 'stale-error-leaf' },
				{} as never,
			);
			const open = (view as unknown as { onOpen(): Promise<void> }).onOpen();
			resolveAcquire(index);
			await open;
			if (failure === 'missing') getFileByPath.mockReturnValueOnce(null);
			else {
				readDocument.mockReturnValueOnce({
					issues: [{ field: 'views', message: 'Invalid saved views.' }],
				});
			}
			let resolvePersist!: () => void;
			const persistGate = new Promise<void>((resolve) => {
				resolvePersist = resolve;
			});
			const previousSetCount = setUiState.mock.calls.length;
			setUiState.mockReturnValueOnce(persistGate);
			const host = view as unknown as {
				onClose(): Promise<void>;
				renderDocumentError(): void;
			};
			const renderDocumentError = vi.spyOn(host, 'renderDocumentError');

			const refresh = view.refreshCalendarDocument();
			await vi.waitFor(() =>
				expect(setUiState.mock.calls.length).toBe(previousSetCount + 1),
			);
			const close = host.onClose();
			resolvePersist();
			await Promise.all([refresh, close]);

			expect(renderDocumentError).not.toHaveBeenCalled();
			expect(
				allElements(contentEl).some((element) =>
					element.classes.has('cv-document-error'),
				),
			).toBe(false);
		},
	);

	it('ignores a subscriber retained from a previous calendar path', async () => {
		const {
			configA,
			configB,
			snapshotA,
			snapshotB,
			subscribers,
			unsubscribeA,
			view,
		} = setupSwitchableCalendarHosts();
		await view.setState(
			{ calendarDocumentPath: configA.documentPath, instanceId: 'switching-leaf' },
			{} as never,
		);
		await (view as unknown as { onOpen(): Promise<void> }).onOpen();
		const staleSubscriber = subscribers.get(configA.documentPath);
		if (!staleSubscriber) throw new Error('Expected the first calendar subscriber.');

		await view.setState(
			{ calendarDocumentPath: configB.documentPath, instanceId: 'switching-leaf' },
			{} as never,
		);
		expect(unsubscribeA).toHaveBeenCalledOnce();
		expect(
			(view as unknown as { snapshot: typeof snapshotB }).snapshot,
		).toBe(snapshotB);

		staleSubscriber({ ...snapshotA, indexedCount: 99 });
		expect(
			(view as unknown as { snapshot: typeof snapshotB }).snapshot,
		).toBe(snapshotB);
		await (view as unknown as { onClose(): Promise<void> }).onClose();
	});

	it('ignores delayed settings and saved-view callbacks from a previous host', async () => {
		const { configA, configB, updateConfig, view } = setupSwitchableCalendarHosts();
		await view.setState(
			{ calendarDocumentPath: configA.documentPath, instanceId: 'modal-leaf' },
			{} as never,
		);
		await (view as unknown as { onOpen(): Promise<void> }).onOpen();
		const entry = configA.viewCatalog?.entries[0];
		if (entry?.kind !== 'valid') throw new Error('Expected a valid saved view.');
		const host = view as unknown as {
			config?: CalendarConfig;
			openAddView(): void;
			openDeleteView(view: SavedView): void;
			openEditView(view: SavedView): void;
			openRenameView(view: SavedView): void;
			openSettings(): void;
			uiState: { activeViewId?: string };
		};
		host.openAddView();
		host.openEditView(entry.definition);
		host.openRenameView(entry.definition);
		host.openDeleteView(entry.definition);
		host.openSettings();
		for (const name of ['add', 'addProperties', 'edit', 'rename', 'delete', 'settings']) {
			expect(viewHarness.modalCallbacks[name]).toBeTypeOf('function');
		}

		await view.setState(
			{ calendarDocumentPath: configB.documentPath, instanceId: 'modal-leaf' },
			{} as never,
		);
		updateConfig.mockClear();
		viewHarness.openedModals.length = 0;
		const staleCatalog = configA.viewCatalog;
		if (!staleCatalog) throw new Error('Expected a saved-view catalog.');
		await viewHarness.modalCallbacks.add?.(staleCatalog, entry.definition.id);
		await viewHarness.modalCallbacks.addProperties?.();
		await viewHarness.modalCallbacks.edit?.(staleCatalog);
		await viewHarness.modalCallbacks.rename?.(staleCatalog);
		await viewHarness.modalCallbacks.delete?.(staleCatalog);
		await viewHarness.modalCallbacks.settings?.({
			...configA,
			name: 'Stale settings',
		});

		expect(host.config).toBe(configB);
		expect(host.uiState.activeViewId).toBe('calendar-b');
		expect(updateConfig).not.toHaveBeenCalled();
		expect(viewHarness.openedModals).toEqual([]);
		await (view as unknown as { onClose(): Promise<void> }).onClose();
	});

	it('mounts the active Board definition and persists its per-view state', async () => {
		const ownerWindow = {
			clearTimeout: vi.fn(),
			crypto: { randomUUID: () => 'calendar-view-instance' },
			requestAnimationFrame: (callback: () => void) => callback(),
			setTimeout: vi.fn().mockReturnValue(1),
		};
		const ownerDocument = { defaultView: ownerWindow } as unknown as Document;
		const contentEl = new viewHarness.MockElement(ownerDocument);
		const config = calendarConfig();
		config.propertyDefinitions = {
			status: { type: 'select', options: ['Todo', 'Doing', 'Done'] },
		};
		config.viewCatalog = {
			source: 'canonical',
			entries: [
				{
					kind: 'valid',
					definition: {
						id: 'board-a',
						name: 'Board A',
						type: 'board',
						groupBy: 'status',
					},
				},
				{
					kind: 'unsupported',
					id: 'timeline-a',
					name: 'Timeline A',
					viewType: 'timeline',
					raw: { id: 'timeline-a', name: 'Timeline A', type: 'timeline' },
				},
				{
					kind: 'valid',
					definition: {
						id: 'calendar-week',
						name: 'Calendar week',
						type: 'calendar',
						layout: 'week',
						weekStartsOn: 'monday',
					},
				},
			],
			canMutate: false,
		};
		const snapshot = { items: [], issues: [], indexedCount: 0 };
		const index = {
			subscribe: (subscriber: (value: typeof snapshot) => void) => {
				subscriber(snapshot);
				return vi.fn();
			},
		};
		const setState = vi.fn().mockResolvedValue(undefined);
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
				get: vi.fn().mockReturnValue({
					activeViewId: 'board-a',
					viewStates: {
						'board-a': { type: 'board', scrollLeft: 120 },
						'calendar-week': {
							type: 'calendar',
							focusDate: '2026-09-02',
						},
					},
				}),
				markRecent: vi.fn().mockResolvedValue(undefined),
				set: setState,
			},
		} as unknown as CalendarViewPlugin;
		const view = new CalendarView({ app, contentEl } as never, plugin);
		await view.setState(
			{ calendarDocumentPath: config.documentPath, instanceId: 'leaf-a' },
			{} as never,
		);
		await (view as unknown as { onOpen(): Promise<void> }).onOpen();

		const board = allElements(contentEl).find((element) =>
			element.classes.has('cv-board-surface'),
		);
		if (!board) throw new Error('Expected the active Board surface.');
		expect(board.scrollLeft).toBe(120);
		expect(
			allElements(contentEl).filter((element) => element.classes.has('cv-board-column')),
		).toHaveLength(4);
		board.scrollLeft = 240;
		contentEl.scrollTop = 38;
		await (view as unknown as { onClose(): Promise<void> }).onClose();

		expect(setState).toHaveBeenLastCalledWith(config.documentPath, 'leaf-a', {
			activeViewId: 'board-a',
			viewStates: {
				'board-a': { type: 'board', scrollLeft: 240, scrollTop: 38 },
				'calendar-week': {
					type: 'calendar',
					focusDate: '2026-09-02',
				},
			},
		});
	});

	it('switches dynamic tabs, restores each view state, and opens Add view', async () => {
		const ownerWindow = {
			clearTimeout: vi.fn(),
			crypto: { randomUUID: () => 'calendar-view-instance' },
			requestAnimationFrame: (callback: () => void) => callback(),
			setTimeout: vi.fn().mockReturnValue(1),
		};
		const ownerDocument = { defaultView: ownerWindow } as unknown as Document;
		const contentEl = new viewHarness.MockElement(ownerDocument);
		const config = calendarConfig();
		config.propertyDefinitions = {
			status: { type: 'select', options: ['Todo', 'Doing', 'Done'] },
		};
		config.viewCatalog = {
			source: 'canonical',
			canMutate: true,
			entries: [
				{
					kind: 'valid',
					definition: {
						id: 'calendar-month',
						name: 'Calendar',
						type: 'calendar',
						layout: 'month',
						weekStartsOn: 'monday',
					},
				},
				{
					kind: 'valid',
					definition: {
						id: 'status-board',
						name: 'Status board',
						type: 'board',
						groupBy: 'status',
					},
				},
			],
		};
		const snapshot = { items: [], issues: [], indexedCount: 0 };
		const index = {
			subscribe: (subscriber: (value: typeof snapshot) => void) => {
				subscriber(snapshot);
				return vi.fn();
			},
		};
		const setState = vi.fn().mockResolvedValue(undefined);
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
				get: vi.fn().mockReturnValue({
					activeViewId: 'calendar-month',
					viewStates: {
						'calendar-month': {
							type: 'calendar',
							focusDate: '2026-09-02',
							scrollTop: 17,
						},
						'status-board': {
							type: 'board',
							scrollLeft: 95,
							scrollTop: 7,
						},
					},
				}),
				markRecent: vi.fn().mockResolvedValue(undefined),
				set: setState,
			},
		} as unknown as CalendarViewPlugin;
		const view = new CalendarView({ app, contentEl } as never, plugin);
		await view.setState(
			{ calendarDocumentPath: config.documentPath, instanceId: 'leaf-tabs' },
			{} as never,
		);
		await (view as unknown as { onOpen(): Promise<void> }).onOpen();

		expect(
			allElements(contentEl).filter((element) => element.classes.has('cv-view-tab')),
		).toHaveLength(2);
		expect(dayCell(contentEl, '2026-09-02')).toBeDefined();
		const boardTab = allElements(contentEl).find(
			(element) => element.dataset.viewId === 'status-board',
		);
		if (!boardTab) throw new Error('Expected the Board tab.');
		boardTab.focus();
		boardTab.emit('keydown', { key: 'Enter', preventDefault: vi.fn() });

		const board = allElements(contentEl).find((element) =>
			element.classes.has('cv-board-surface'),
		);
		if (!board) throw new Error('Expected the Board surface after switching tabs.');
		const activeBoardTab = allElements(contentEl).find(
			(element) => element.dataset.viewId === 'status-board',
		);
		expect(
			(ownerDocument as unknown as { activeElement?: unknown }).activeElement,
		).toBe(activeBoardTab);
		expect(board.scrollLeft).toBe(95);
		board.scrollLeft = 144;
		const calendarTab = allElements(contentEl).find(
			(element) => element.dataset.viewId === 'calendar-month',
		);
		if (!calendarTab) throw new Error('Expected the Calendar tab.');
		calendarTab.emit('click');

		expect(dayCell(contentEl, '2026-09-02')).toBeDefined();
		const addView = allElements(contentEl).find((element) =>
			element.classes.has('cv-add-view'),
		);
		if (!addView) throw new Error('Expected Add view.');
		expect(addView.disabled).toBe(false);
		addView.emit('click');
		expect(viewHarness.openedModals).toEqual(['add-view']);

		await (view as unknown as { onClose(): Promise<void> }).onClose();
		expect(setState).toHaveBeenLastCalledWith(config.documentPath, 'leaf-tabs', {
			activeViewId: 'calendar-month',
			viewStates: {
				'calendar-month': {
					type: 'calendar',
					focusDate: '2026-09-02',
					scrollTop: 17,
				},
				'status-board': {
					type: 'board',
					scrollLeft: 144,
					scrollTop: 7,
				},
			},
		});
	});

	it('falls back to the next saved view when the active view is removed externally', async () => {
		const ownerWindow = {
			clearTimeout: vi.fn(),
			crypto: { randomUUID: () => 'calendar-view-instance' },
			requestAnimationFrame: (callback: () => void) => callback(),
			setTimeout: vi.fn().mockReturnValue(1),
		};
		const ownerDocument = { defaultView: ownerWindow } as unknown as Document;
		const contentEl = new viewHarness.MockElement(ownerDocument);
		const calendarLeft = {
			id: 'calendar-left',
			name: 'Left',
			type: 'calendar' as const,
			layout: 'month' as const,
			weekStartsOn: 'monday' as const,
		};
		const board = {
			id: 'board-active',
			name: 'Board',
			type: 'board' as const,
			groupBy: 'status',
		};
		const calendarRight = {
			id: 'calendar-right',
			name: 'Right',
			type: 'calendar' as const,
			layout: 'week' as const,
			weekStartsOn: 'sunday' as const,
		};
		let currentConfig: CalendarConfig = {
			...calendarConfig(),
			propertyDefinitions: {
				status: { type: 'select', options: ['Todo', 'Done'] },
			},
			viewCatalog: {
				source: 'canonical',
				canMutate: true,
				entries: [calendarLeft, board, calendarRight].map((definition) => ({
					kind: 'valid' as const,
					definition,
				})),
			},
		};
		const snapshot = { items: [], issues: [], indexedCount: 0 };
		const index = {
			subscribe: (subscriber: (value: typeof snapshot) => void) => {
				subscriber(snapshot);
				return vi.fn();
			},
		};
		const setState = vi.fn().mockResolvedValue(undefined);
		const app = {
			vault: { getFileByPath: () => ({ path: currentConfig.documentPath }) },
			workspace: { requestSaveLayout: vi.fn() },
		};
		const plugin = {
			documents: {
				read: () => ({ config: currentConfig, issues: [] }),
				validateLocations: () => [],
			},
			indexes: {
				acquire: vi.fn().mockResolvedValue(index),
				release: vi.fn(),
				updateConfig: vi.fn().mockResolvedValue(undefined),
			},
			registerViewInstance: vi.fn(),
			unregisterViewInstance: vi.fn(),
			stateStore: {
				get: vi.fn().mockReturnValue({
					activeViewId: board.id,
					viewStates: { [board.id]: { type: 'board', scrollLeft: 70 } },
				}),
				markRecent: vi.fn().mockResolvedValue(undefined),
				set: setState,
			},
		} as unknown as CalendarViewPlugin;
		const view = new CalendarView({ app, contentEl } as never, plugin);
		await view.setState(
			{ calendarDocumentPath: currentConfig.documentPath, instanceId: 'leaf-fallback' },
			{} as never,
		);
		await (view as unknown as { onOpen(): Promise<void> }).onOpen();
		expect(
			allElements(contentEl).some((element) =>
				element.classes.has('cv-board-surface'),
			),
		).toBe(true);

		currentConfig = {
			...currentConfig,
			viewCatalog: {
				source: 'canonical',
				canMutate: true,
				entries: [calendarLeft, calendarRight].map((definition) => ({
					kind: 'valid' as const,
					definition,
				})),
			},
		};
		await view.refreshCalendarDocument();

		const activeTab = allElements(contentEl).find((element) =>
			element.classes.has('is-active'),
		);
		expect(activeTab?.dataset.viewId).toBe(calendarRight.id);
		expect(
			allElements(contentEl).filter((element) => element.classes.has('cv-day-cell')),
		).toHaveLength(7);
		expect(setState).toHaveBeenLastCalledWith(
			currentConfig.documentPath,
			'leaf-fallback',
			{ activeViewId: calendarRight.id, viewStates: {} },
		);
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
				get: vi.fn().mockReturnValue({
					activeViewId: 'calendar',
					viewStates: {
						calendar: { type: 'calendar', focusDate: '2026-09-01' },
					},
				}),
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
