import { beforeEach, describe, expect, it, vi } from 'vitest';

const menuHarness = vi.hoisted(() => ({
	items: [] as Array<{
		disabled: boolean;
		onClick?: () => void;
		title: string;
		warning: boolean;
	}>,
	mouseEvents: [] as unknown[],
	positionCalls: [] as Array<{ document: unknown; position: unknown }>,
	tooltips: [] as Array<{ element: unknown; options: unknown; tooltip: string }>,
}));

vi.mock('obsidian', () => ({
	Menu: class {
		addItem(configure: (item: unknown) => void): this {
			const record: {
				disabled: boolean;
				onClick?: () => void;
				title: string;
				warning: boolean;
			} = { disabled: false, title: '', warning: false };
			type MockMenuItem = {
				onClick(callback: () => void): MockMenuItem;
				setDisabled(value: boolean): MockMenuItem;
				setIcon(value: string): MockMenuItem;
				setTitle(value: string): MockMenuItem;
				setWarning(value: boolean): MockMenuItem;
			};
			const item: MockMenuItem = {
				onClick: (callback) => {
					record.onClick = callback;
					return item;
				},
				setDisabled: (value) => {
					record.disabled = value;
					return item;
				},
				setIcon: () => item,
				setTitle: (value) => {
					record.title = value;
					return item;
				},
				setWarning: (value) => {
					record.warning = value;
					return item;
				},
			};
			configure(item);
			menuHarness.items.push(record);
			return this;
		}

		addSeparator(): this {
			return this;
		}

		showAtMouseEvent(event: unknown): void {
			menuHarness.mouseEvents.push(event);
		}

		showAtPosition(position: unknown, document: unknown): void {
			menuHarness.positionCalls.push({ document, position });
		}
	},
	setIcon: vi.fn(),
	setTooltip: (element: unknown, tooltip: string, options: unknown) => {
		menuHarness.tooltips.push({ element, options, tooltip });
	},
}));

import type { SavedViewCatalog } from '../types';
import {
	renderSavedViewTabs,
	savedViewPanelId,
	savedViewTabModels,
} from './saved-view-tabs';

interface ElementOptions {
	attr?: Record<string, string>;
	cls?: string;
	text?: string;
}

class MockElement {
	readonly attributes: Record<string, string> = {};
	readonly children: MockElement[] = [];
	readonly classes = new Set<string>();
	readonly dataset: Record<string, string> = {};
	private readonly listeners = new Map<
		string,
		(event: Record<string, unknown>) => void
	>();
	private bounds = {
		bottom: 30,
		height: 30,
		left: 0,
		right: 0,
		top: 0,
		width: 0,
		x: 0,
		y: 0,
	};
	disabled = false;
	parentElement?: MockElement;
	scrollLeft = 0;
	tabIndex = -1;

	constructor(
		readonly ownerDocument: Document,
		options?: ElementOptions,
	) {
		for (const className of options?.cls?.split(/\s+/u) ?? []) {
			if (className) this.classes.add(className);
		}
		for (const [name, value] of Object.entries(options?.attr ?? {})) {
			this.setAttribute(name, value);
		}
	}

	addClass(className: string): void {
		this.classes.add(className);
	}

	addEventListener(
		type: string,
		listener: (event: Record<string, unknown>) => void,
	): void {
		this.listeners.set(type, listener);
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

	emit(type: string, event: Record<string, unknown>): void {
		this.listeners.get(type)?.(event);
	}

	findByClass(className: string): MockElement | undefined {
		if (this.classes.has(className)) return this;
		for (const child of this.children) {
			const match = child.findByClass(className);
			if (match) return match;
		}
		return undefined;
	}

	getBoundingClientRect(): DOMRect {
		return this.bounds as DOMRect;
	}

	setAttribute(name: string, value: string): void {
		this.attributes[name] = value;
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

	private create(options?: ElementOptions): MockElement {
		const child = new MockElement(this.ownerDocument, options);
		child.parentElement = this;
		this.children.push(child);
		return child;
	}
}

describe('saved-view tabs', () => {
	beforeEach(() => {
		menuHarness.items.length = 0;
		menuHarness.mouseEvents.length = 0;
		menuHarness.positionCalls.length = 0;
		menuHarness.tooltips.length = 0;
	});

	it('keeps ordered valid and uniquely-addressable unavailable entries', () => {
		const catalog: SavedViewCatalog = {
			source: 'canonical',
			canMutate: false,
			entries: [
				{
					kind: 'valid',
					definition: {
						id: 'calendar',
						name: 'Calendar',
						type: 'calendar',
						layout: 'month',
						weekStartsOn: 'locale',
					},
				},
				{
					kind: 'unsupported',
					id: 'timeline',
					name: 'Timeline',
					viewType: 'timeline',
					raw: {},
				},
				{
					kind: 'invalid',
					id: 'broken',
					name: 'Broken',
					raw: {},
					issues: [{ field: 'layout', message: 'Invalid layout.' }],
				},
			],
		};

		expect(savedViewTabModels(catalog)).toEqual([
			expect.objectContaining({ id: 'calendar', name: 'Calendar', type: 'calendar' }),
			expect.objectContaining({
				id: 'timeline',
				name: 'Timeline',
				unavailableReason: 'Unsupported view type: timeline',
			}),
			expect.objectContaining({
				id: 'broken',
				name: 'Broken',
				unavailableReason: 'Invalid layout.',
			}),
		]);
	});

	it('does not create tabs for missing, invalid, or duplicate IDs', () => {
		const catalog: SavedViewCatalog = {
			source: 'canonical',
			canMutate: false,
			entries: [
				{ kind: 'invalid', name: 'Missing', raw: {}, issues: [] },
				{ kind: 'invalid', id: 'Bad ID', name: 'Bad', raw: {}, issues: [] },
				{ kind: 'invalid', id: 'same', name: 'One', raw: {}, issues: [] },
				{ kind: 'invalid', id: 'same', name: 'Two', raw: {}, issues: [] },
			],
		};

		expect(savedViewTabModels(catalog)).toEqual([]);
	});

	it('builds leaf-scoped panel IDs', () => {
		expect(savedViewPanelId('leaf-42', 'work-board')).toBe(
			'leaf-42-saved-view-panel-work-board',
		);
	});

	it('places an icon-only Add view directly after the tab list', () => {
		const ownerDocument = {
			defaultView: { requestAnimationFrame: vi.fn() },
		} as unknown as Document;
		const container = new MockElement(ownerDocument);
		const view = {
			id: 'calendar',
			name: 'Calendar',
			type: 'calendar' as const,
			layout: 'month' as const,
			weekStartsOn: 'locale' as const,
		};
		const catalog: SavedViewCatalog = {
			source: 'canonical',
			canMutate: true,
			entries: [{ kind: 'valid', definition: view }],
		};
		const onAdd = vi.fn();

		renderSavedViewTabs(
			container as unknown as HTMLElement,
			catalog,
			view.id,
			'leaf-42',
			{
				onActivate: vi.fn(),
				onAdd,
				onEdit: vi.fn(),
				onRename: vi.fn(),
				onDelete: vi.fn(),
			},
		);

		const navigation = container.findByClass('cv-view-navigation');
		const viewList = container.findByClass('cv-view-list');
		const strip = container.findByClass('cv-view-tab-strip');
		const add = container.findByClass('cv-add-view');
		expect(navigation?.children).toHaveLength(1);
		expect(navigation?.children[0]).toBe(viewList);
		expect(viewList?.children).toHaveLength(2);
		expect(viewList?.children[0]).toBe(strip);
		expect(viewList?.children[1]).toBe(add);
		expect(add?.attributes['aria-label']).toBe('Add a new view');
		expect(add?.children).toHaveLength(0);
		expect(add?.disabled).toBe(false);
		expect(menuHarness.tooltips[0]?.element).toBe(add);
		expect(menuHarness.tooltips[0]?.tooltip).toBe('Add a new view');
		expect(menuHarness.tooltips[0]?.options).toEqual({ placement: 'top' });
		add?.emit('click', {});
		expect(onAdd).toHaveBeenCalledOnce();

		const readOnlyContainer = new MockElement(ownerDocument);
		renderSavedViewTabs(
			readOnlyContainer as unknown as HTMLElement,
			{ ...catalog, canMutate: false },
			view.id,
			'leaf-43',
			{
				onActivate: vi.fn(),
				onAdd: vi.fn(),
				onEdit: vi.fn(),
				onRename: vi.fn(),
				onDelete: vi.fn(),
			},
		);
		expect(readOnlyContainer.findByClass('cv-add-view')?.disabled).toBe(true);
		expect(menuHarness.tooltips[1]?.tooltip).toBe(
			'Repair the saved-view configuration before adding a view.',
		);
	});

	it('opens view management only from the tab context menu or keyboard shortcut', () => {
		const ownerDocument = {
			defaultView: { requestAnimationFrame: vi.fn() },
		} as unknown as Document;
		const container = new MockElement(ownerDocument);
		const view = {
			id: 'calendar',
			name: 'Calendar',
			type: 'calendar' as const,
			layout: 'month' as const,
			weekStartsOn: 'locale' as const,
		};
		const catalog: SavedViewCatalog = {
			source: 'canonical',
			canMutate: true,
			entries: [{ kind: 'valid', definition: view }],
		};
		const onEdit = vi.fn();
		const onActivate = vi.fn();

		renderSavedViewTabs(
			container as unknown as HTMLElement,
			catalog,
			view.id,
			'leaf-42',
			{
				onActivate,
				onAdd: vi.fn(),
				onEdit,
				onRename: vi.fn(),
				onDelete: vi.fn(),
			},
		);

		const tab = container.findByClass('cv-view-tab');
		expect(tab).toBeDefined();
		expect(tab?.attributes['aria-haspopup']).toBe('menu');
		expect(tab?.attributes['aria-keyshortcuts']).toBe('Shift+F10');
		expect(container.findByClass('cv-view-tab-menu')).toBeUndefined();
		const contextEvent = {
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		};
		tab?.emit('contextmenu', contextEvent);

		expect(contextEvent.preventDefault).toHaveBeenCalledOnce();
		expect(contextEvent.stopPropagation).toHaveBeenCalledOnce();
		expect(menuHarness.mouseEvents).toEqual([contextEvent]);
		expect(menuHarness.items.map(({ title }) => title)).toEqual([
			'Edit view',
			'Rename',
			'Delete view',
		]);
		expect(menuHarness.items[2]?.disabled).toBe(true);
		expect(onActivate).not.toHaveBeenCalled();
		menuHarness.items[0]?.onClick?.();
		expect(onEdit).toHaveBeenCalledWith(view);

		menuHarness.items.length = 0;
		const keyboardEvent = {
			key: 'ContextMenu',
			preventDefault: vi.fn(),
			shiftKey: false,
		};
		tab?.emit('keydown', keyboardEvent);
		expect(keyboardEvent.preventDefault).toHaveBeenCalledOnce();
		expect(menuHarness.positionCalls).toEqual([
			{
				document: ownerDocument,
				position: { x: 0, y: 30 },
			},
		]);

		const shiftF10Event = {
			key: 'F10',
			preventDefault: vi.fn(),
			shiftKey: true,
		};
		tab?.emit('keydown', shiftF10Event);
		expect(shiftF10Event.preventDefault).toHaveBeenCalledOnce();
		expect(menuHarness.positionCalls).toHaveLength(2);
	});

	it('scrolls the entire active tab item into view', () => {
		const animationFrames: FrameRequestCallback[] = [];
		const ownerDocument = {
			defaultView: {
				requestAnimationFrame: (callback: FrameRequestCallback) => {
					animationFrames.push(callback);
					return animationFrames.length;
				},
			},
		} as unknown as Document;
		const container = new MockElement(ownerDocument);
		const catalog: SavedViewCatalog = {
			source: 'canonical',
			canMutate: true,
			entries: [
				{
					kind: 'valid',
					definition: {
						id: 'calendar',
						name: 'Calendar',
						type: 'calendar',
						layout: 'month',
						weekStartsOn: 'locale',
					},
				},
			],
		};

		renderSavedViewTabs(
			container as unknown as HTMLElement,
			catalog,
			'calendar',
			'leaf-42',
			{
				onActivate: vi.fn(),
				onAdd: vi.fn(),
				onEdit: vi.fn(),
				onRename: vi.fn(),
				onDelete: vi.fn(),
			},
		);

		const strip = container.findByClass('cv-view-tab-strip');
		const item = container.findByClass('cv-view-tab-item');
		const tab = container.findByClass('cv-view-tab');
		expect(strip).toBeDefined();
		expect(item).toBeDefined();
		expect(tab).toBeDefined();
		strip?.setBounds(10, 100);
		tab?.setBounds(90, 30);
		item?.setBounds(90, 30);

		expect(animationFrames).toHaveLength(1);
		animationFrames[0]?.(0);

		expect(strip?.scrollLeft).toBe(10);
	});
});
