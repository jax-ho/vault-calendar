import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockElementRecord {
	tag: string;
	options?: {
		attr?: Record<string, string>;
		cls?: string;
		text?: string;
		type?: string;
	};
	element: {
		disabled: boolean;
		value: string;
		emit: (event: string, detail?: Record<string, unknown>) => void;
	};
}

const modalHarness = vi.hoisted(() => ({
	closeCalls: 0,
	elements: [] as MockElementRecord[],
	icons: [] as string[],
	propertyControls: [] as Array<{
		property: string;
		value: unknown;
		onChange: (value: unknown) => void;
	}>,
}));

vi.mock('./event-property-input', () => ({
	renderEventPropertyInput: (
		_container: unknown,
		property: string,
		_definition: unknown,
		value: unknown,
		onChange: (value: unknown) => void,
	) => {
		modalHarness.propertyControls.push({ property, value, onChange });
	},
}));

vi.mock('obsidian', () => {
	class MockElement {
		disabled = false;
		htmlFor = '';
		id = '';
		value = '';
		private readonly listeners = new Map<string, (event: Record<string, unknown>) => void>();

		addClass(_className: string): void {}

		addEventListener(
			event: string,
			handler: (detail: Record<string, unknown>) => void,
		): void {
			this.listeners.set(event, handler);
		}

		createDiv(options?: MockElementRecord['options']): MockElement {
			const element = new MockElement();
			modalHarness.elements.push({ tag: 'div', options, element });
			return element;
		}

		createEl(tag: string, options?: MockElementRecord['options']): MockElement {
			const element = new MockElement();
			modalHarness.elements.push({ tag, options, element });
			return element;
		}

		createSpan(options?: MockElementRecord['options']): MockElement {
			const element = new MockElement();
			modalHarness.elements.push({ tag: 'span', options, element });
			return element;
		}

		emit(event: string, detail: Record<string, unknown> = {}): void {
			this.listeners.get(event)?.(detail);
		}

		empty(): void {}

		focus(): void {}

		setAttribute(_name: string, _value: string): void {}

		setText(_text: string): void {}
	}

	return {
		setIcon: (_element: unknown, icon: string) => {
			modalHarness.icons.push(icon);
		},
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
			constructor(_message: string) {}
		},
	};
});

import type CalendarViewPlugin from '../main';
import type { CalendarConfig } from '../types';
import { EventTitleModal } from './event-title-modal';

function calendarConfig(): CalendarConfig {
	return {
		documentPath: 'Life/Work/_calendar.md',
		name: 'Work',
		sourceFolder: 'Life/Work',
		recursive: true,
		startDateProperty: 'date',
		endDateProperty: 'date-end',
		visibleProperties: ['status', 'type', 'important'],
		propertyDefinitions: {
			status: {
				type: 'select',
				options: ['None', 'Not started', 'Done'],
				default: 'Not started',
			},
			type: {
				type: 'select',
				options: ['None', 'Task', 'Idea'],
				default: 'Task',
			},
			important: { type: 'checkbox', default: false },
			estimate: { type: 'number', default: 2 },
		},
		weekStartsOn: 'monday',
		layout: 'month',
		openBehavior: 'same-leaf',
		createFolder: 'Life/Work',
		excludePaths: [],
	};
}

function findElement(
	predicate: (record: MockElementRecord) => boolean,
): MockElementRecord['element'] {
	const record = modalHarness.elements.find(predicate);
	if (!record) throw new Error('Expected element was not rendered.');
	return record.element;
}

describe('new event form', () => {
	beforeEach(() => {
		modalHarness.closeCalls = 0;
		modalHarness.elements.length = 0;
		modalHarness.icons.length = 0;
		modalHarness.propertyControls.length = 0;
	});

	it('renders a compact property form and saves the Markdown body', async () => {
		const config = calendarConfig();
		const file = { path: 'Life/Work/planning--7f3a9c00.md' };
		const createEvent = vi.fn().mockResolvedValue(file);
		const openMarkdownFile = vi.fn().mockResolvedValue(undefined);
		const plugin = {
			app: {},
			documents: { createEvent },
			openAdapter: { openMarkdownFile },
		} as unknown as CalendarViewPlugin;

		new EventTitleModal(plugin, config, '2026-08-21').onOpen();

		expect(modalHarness.propertyControls.map(({ property }) => property)).toEqual([
			'status',
			'type',
			'important',
			'estimate',
		]);
		expect(modalHarness.propertyControls.map(({ value }) => value)).toEqual([
			'Not started',
			'Task',
			false,
			2,
		]);
		expect(modalHarness.icons).toEqual([
			'calendar-days',
			'circle-chevron-down',
			'circle-chevron-down',
			'square-check-big',
			'hash',
		]);

		const title = findElement(
			({ options }) => options?.attr?.['aria-label'] === 'Event title',
		);
		title.value = 'Planning';
		title.emit('input');

		const notes = findElement(
			({ options }) => options?.attr?.['aria-label'] === 'Event notes',
		);
		notes.value = '## Agenda\n\n- Review roadmap';
		notes.emit('input');

		modalHarness.propertyControls.find(({ property }) => property === 'status')?.onChange('Done');
		modalHarness.propertyControls.find(({ property }) => property === 'type')?.onChange('Idea');
		modalHarness.propertyControls.find(({ property }) => property === 'important')?.onChange(true);
		modalHarness.propertyControls.find(({ property }) => property === 'estimate')?.onChange(3);

		const createButton = findElement(
			({ tag, options }) => tag === 'button' && options?.text === 'Create',
		);
		createButton.emit('click');
		await vi.waitFor(() => expect(createEvent).toHaveBeenCalledOnce());

		expect(createEvent).toHaveBeenCalledWith(
			config,
			'Planning',
			'2026-08-21',
			{
				status: 'Done',
				type: 'Idea',
				important: true,
				estimate: 3,
			},
			'## Agenda\n\n- Review roadmap',
		);
		expect(modalHarness.closeCalls).toBe(1);
		expect(openMarkdownFile).not.toHaveBeenCalled();
	});
});
