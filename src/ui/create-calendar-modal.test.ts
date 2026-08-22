import { beforeEach, describe, expect, it, vi } from 'vitest';

const modalHarness = vi.hoisted(() => ({
	buttonClick: undefined as (() => Promise<void> | void) | undefined,
	dropdownChanges: new Map<string, (value: string) => void>(),
	settingNames: [] as string[],
	textChanges: new Map<string, (value: string) => void>(),
}));

vi.mock('obsidian', () => ({
	Modal: class {
		contentEl = {
			addClass: vi.fn(),
			createDiv: vi.fn(() => ({ empty: vi.fn(), setText: vi.fn() })),
			empty: vi.fn(),
		};

		constructor(_app: unknown) {}

		close(): void {}

		setTitle(_title: string): void {}
	},
	Notice: class {
		constructor(_message: string) {}
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

		addText(callback: (text: unknown) => void): this {
			const text = {
				inputEl: { focus: vi.fn() },
				onChange: (handler: (value: string) => void) => {
					modalHarness.textChanges.set(this.name, handler);
					return text;
				},
				setPlaceholder: (_placeholder: string) => text,
				setValue: (_value: string) => text,
			};
			callback(text);
			return this;
		}

		addDropdown(callback: (dropdown: unknown) => void): this {
			const dropdown = {
				addOption: (_value: string, _label: string) => dropdown,
				onChange: (handler: (value: string) => void) => {
					modalHarness.dropdownChanges.set(this.name, handler);
					return dropdown;
				},
			};
			callback(dropdown);
			return this;
		}

		addButton(callback: (button: unknown) => void): this {
			const button = {
				onClick: (handler: () => Promise<void> | void) => {
					modalHarness.buttonClick = handler;
					return button;
				},
				setButtonText: (_label: string) => button,
				setCta: () => button,
				setDisabled: (_disabled: boolean) => button,
			};
			callback(button);
			return this;
		}
	},
}));

import type CalendarViewPlugin from '../main';
import { CreateCalendarModal } from './create-calendar-modal';

describe('create calendar first-run form', () => {
	beforeEach(() => {
		modalHarness.buttonClick = undefined;
		modalHarness.dropdownChanges.clear();
		modalHarness.settingNames.length = 0;
		modalHarness.textChanges.clear();
	});

	it('asks only for a name and event folder, then derives the remaining configuration', async () => {
		const create = vi.fn().mockResolvedValue({ path: 'Life/Work/_calendar.md' });
		const openCalendar = vi.fn().mockResolvedValue(undefined);
		const plugin = {
			app: {
				vault: {
					getAllFolders: () => [{ path: 'Life' }, { path: 'Tech' }],
				},
			},
			documents: { create },
			openAdapter: { openCalendar },
		} as unknown as CalendarViewPlugin;

		new CreateCalendarModal(plugin).onOpen();

		expect(modalHarness.settingNames).toEqual(['Calendar name', 'Calendar location']);
		modalHarness.textChanges.get('Calendar name')?.('Work');
		modalHarness.dropdownChanges.get('Calendar location')?.('Life');
		await modalHarness.buttonClick?.();

		expect(create).toHaveBeenCalledWith({
			name: 'Work',
			documentFolder: 'Life/Work',
			startDateProperty: 'date',
			endDateProperty: 'date-end',
		});
		expect(openCalendar).toHaveBeenCalledOnce();
	});
});
