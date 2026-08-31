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

	class MockElement {
		children: MockElement[] = [];
		classes = new Set<string>();
		dataset: Record<string, string> = {};
		draggable = false;
		lang = '';
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

		addEventListener(_event: string, _handler: (...args: never[]) => void): void {}

		createDiv(options?: ElementOptions): MockElement {
			return this.create('div', options);
		}

		createEl(tag: string, options?: ElementOptions): MockElement {
			return this.create(tag, options);
		}

		createSpan(options?: ElementOptions): MockElement {
			return this.create('span', options);
		}

		empty(): void {
			this.children.length = 0;
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

		private create(tag: string, options?: ElementOptions): MockElement {
			const child = new MockElement(this.ownerDocument, tag, options);
			this.children.push(child);
			return child;
		}
	}

	return {
		MockElement,
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
	Notice: class {
		constructor(_message: string) {}
	},
	setIcon: vi.fn(),
}));

vi.mock('./calendar-card', () => ({ renderCardProperties: vi.fn() }));
vi.mock('./calendar-list-modal', () => ({ CalendarIssuesModal: class {} }));
vi.mock('./calendar-settings-modal', () => ({ CalendarSettingsModal: class {} }));
vi.mock('./event-editor-modal', () => ({ EventEditorModal: class {} }));
vi.mock('./event-title-modal', () => ({ EventTitleModal: class {} }));

import type CalendarViewPlugin from '../main';
import type { CalendarConfig } from '../types';
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
