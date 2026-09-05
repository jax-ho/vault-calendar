import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ElementOptions {
	attr?: Record<string, string>;
	cls?: string;
	text?: string;
	type?: string;
}

interface ElementRecord {
	tag: string;
	options?: ElementOptions;
	element: MockElement;
}

class MockElement {
	disabled = false;
	value = '';
	ownerDocument = {
		defaultView: null,
	};
	private readonly listeners = new Map<string, (event: Record<string, unknown>) => void>();

	addClass(_name: string): void {}

	addEventListener(
		event: string,
		listener: (event: Record<string, unknown>) => void,
	): void {
		this.listeners.set(event, listener);
	}

	createDiv(options?: ElementOptions): MockElement {
		return this.create('div', options);
	}

	createEl(tag: string, options?: ElementOptions): MockElement {
		return this.create(tag, options);
	}

	empty(): void {}

	emit(event: string, detail: Record<string, unknown> = {}): void {
		this.listeners.get(event)?.(detail);
	}

	focus(): void {}

	select(): void {}

	setText(message: string): void {
		modalHarness.errors.push(message);
	}

	private create(tag: string, options?: ElementOptions): MockElement {
		const element = new MockElement();
		modalHarness.elements.push({ tag, options, element });
		return element;
	}
}

const modalHarness = vi.hoisted(() => ({
	buttons: new Map<string, { disabled: boolean; click: () => Promise<void> | void }>(),
	closeCalls: 0,
	dropdownChanges: new Map<string, (value: string) => void>(),
	elements: [] as ElementRecord[],
	errors: [] as string[],
	notices: [] as string[],
	settingNames: [] as string[],
	textChanges: new Map<string, (value: string) => void>(),
}));

vi.mock('obsidian', () => ({
	Modal: class {
		contentEl = new MockElement();
		modalEl = new MockElement();

		constructor(_app: unknown) {}

		close(): void {
			modalHarness.closeCalls += 1;
		}

		setTitle(_title: string): void {}
	},
	Notice: class {
		constructor(message: string) {
			modalHarness.notices.push(message);
		}
	},
	Setting: class {
		private name = '';

		constructor(_container: unknown) {}

		setName(name: string): this {
			this.name = name;
			modalHarness.settingNames.push(name);
			return this;
		}

		setDesc(_description: string): this {
			return this;
		}

		addText(callback: (component: unknown) => void): this {
			const inputEl = new MockElement();
			modalHarness.elements.push({ tag: 'input', element: inputEl });
			const component = {
				inputEl,
				setValue: (value: string) => {
					inputEl.value = value;
					return component;
				},
				onChange: (listener: (value: string) => void) => {
					modalHarness.textChanges.set(this.name, listener);
					return component;
				},
			};
			callback(component);
			return this;
		}

		addDropdown(callback: (component: unknown) => void): this {
			const component = {
				addOption: (_value: string, _label: string) => component,
				setValue: (_value: string) => component,
				onChange: (listener: (value: string) => void) => {
					modalHarness.dropdownChanges.set(this.name, listener);
					return component;
				},
			};
			callback(component);
			return this;
		}

		addButton(callback: (component: unknown) => void): this {
			let label = '';
			const record: {
				disabled: boolean;
				click: () => Promise<void> | void;
			} = {
				disabled: false,
				click: () => undefined,
			};
			const component = {
				setButtonText: (value: string) => {
					label = value;
					return component;
				},
				onClick: (listener: () => Promise<void> | void) => {
					record.click = listener;
					modalHarness.buttons.set(label, record);
					return component;
				},
				setDisabled: (value: boolean) => {
					record.disabled = value;
					return component;
				},
			};
			callback(component);
			return this;
		}
	},
}));

import type CalendarViewPlugin from '../main';
import type { CalendarConfig, SavedViewCatalog } from '../types';
import {
	AddSavedViewModal,
	DeleteSavedViewModal,
	RenameSavedViewModal,
} from './saved-view-modals';

function catalog(): SavedViewCatalog {
	return {
		source: 'canonical',
		canMutate: true,
		entries: [
			{
				kind: 'valid',
				definition: {
					id: 'calendar',
					name: 'Calendar view',
					type: 'calendar',
					layout: 'month',
					weekStartsOn: 'locale',
				},
			},
		],
	};
}

function config(withSelect = true): CalendarConfig {
	return {
		documentPath: 'Work/_calendar.md',
		name: 'Work',
		sourceFolder: 'Work',
		recursive: true,
		startDateProperty: 'date',
		visibleProperties: [],
		propertyDefinitions: withSelect
			? { status: { type: 'select', options: ['None', 'Todo'] } }
			: { owner: { type: 'text' } },
		viewCatalog: catalog(),
		layout: 'month',
		weekStartsOn: 'locale',
		openBehavior: 'same-leaf',
		createFolder: 'Work',
		excludePaths: [],
	};
}

function plugin(commit = vi.fn()): CalendarViewPlugin {
	return {
		app: {},
		savedViews: { commit },
	} as unknown as CalendarViewPlugin;
}

function button(text: string): MockElement {
	let match: ElementRecord | undefined;
	for (const record of modalHarness.elements) {
		if (record.tag === 'button' && record.options?.text === text) match = record;
	}
	if (!match) throw new Error(`Button not found: ${text}`);
	return match.element;
}

describe('saved-view modals', () => {
	beforeEach(() => {
		modalHarness.buttons.clear();
		modalHarness.closeCalls = 0;
		modalHarness.dropdownChanges.clear();
		modalHarness.elements.length = 0;
		modalHarness.errors.length = 0;
		modalHarness.notices.length = 0;
		modalHarness.settingNames.length = 0;
		modalHarness.textChanges.clear();
	});

	it('creates a Board with the preferred status grouping', async () => {
		const next = catalog();
		const commit = vi.fn().mockResolvedValue(next);
		const onSaved = vi.fn();
		const modal = new AddSavedViewModal(
			plugin(commit),
			config(),
			catalog(),
			'calendar',
			onSaved,
			vi.fn(),
			() => 'work-board',
		);
		modal.onOpen();
		modalHarness.dropdownChanges.get('View type')?.('board');

		button('Create').emit('click');
		await vi.waitFor(() => expect(modalHarness.closeCalls).toBe(1));

		expect(commit).toHaveBeenCalledWith('Work/_calendar.md', {
			kind: 'add',
			view: {
				id: 'work-board',
				name: 'Board',
				type: 'board',
				groupBy: 'status',
			},
		});
		expect(onSaved).toHaveBeenCalledWith(next, 'work-board');
	});

	it('offers Properties instead of creating an unconfigured Board', () => {
		const openProperties = vi.fn();
		const modal = new AddSavedViewModal(
			plugin(),
			config(false),
			catalog(),
			'calendar',
			vi.fn(),
			openProperties,
			() => 'work-board',
		);
		modal.onOpen();
		modalHarness.dropdownChanges.get('View type')?.('board');

		expect(button('Create').disabled).toBe(true);
		void modalHarness.buttons.get('Open properties')?.click();
		expect(openProperties).toHaveBeenCalledOnce();
	});

	it('renames by stable ID when Enter is pressed', async () => {
		const next = catalog();
		const commit = vi.fn().mockResolvedValue(next);
		const view = (catalog().entries[0] as { kind: 'valid'; definition: never })
			.definition;
		const modal = new RenameSavedViewModal(
			plugin(commit),
			'Work/_calendar.md',
			catalog(),
			view,
			vi.fn(),
		);
		modal.onOpen();
		modalHarness.textChanges.get('Name')?.('Schedule');
		const nameInput = modalHarness.elements.find(
			(record) => record.tag === 'input',
		)?.element;
		nameInput?.emit('keydown', {
			key: 'Enter',
			isComposing: false,
			preventDefault: vi.fn(),
		});

		await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce());
		expect(commit).toHaveBeenCalledWith('Work/_calendar.md', {
			kind: 'rename',
			viewId: 'calendar',
			name: 'Schedule',
		});
	});

	it('confirms that deleting a view never deletes event notes', async () => {
		const next = catalog();
		const commit = vi.fn().mockResolvedValue(next);
		const view = (catalog().entries[0] as { kind: 'valid'; definition: never })
			.definition;
		const modal = new DeleteSavedViewModal(
			plugin(commit),
			'Work/_calendar.md',
			view,
			vi.fn(),
		);
		modal.onOpen();

		button('Delete view').emit('click');
		await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce());
		expect(commit).toHaveBeenCalledWith('Work/_calendar.md', {
			kind: 'remove',
			viewId: 'calendar',
		});
		expect(
			modalHarness.elements.some((record) =>
				record.options?.text?.includes('Event notes will not be deleted'),
			),
		).toBe(true);
	});
});
