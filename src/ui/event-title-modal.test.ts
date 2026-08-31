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
	notices: [] as string[],
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
				(this as unknown as { onClose?: () => void }).onClose?.();
			}

			setTitle(_title: string): void {}
		},
		Notice: class {
			constructor(message: string) {
				modalHarness.notices.push(message);
			}
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
		modalHarness.notices.length = 0;
		modalHarness.propertyControls.length = 0;
	});

	it('renders a compact property form and creates the event once when closed', async () => {
		const config = calendarConfig();
		const file = { path: 'Life/Work/planning--7f3a9c00.md' };
		const createEvent = vi.fn().mockResolvedValue(file);
		const openMarkdownFile = vi.fn().mockResolvedValue(undefined);
		const plugin = {
			app: {},
			documents: { createEvent },
			openAdapter: { openMarkdownFile },
		} as unknown as CalendarViewPlugin;

		const modal = new EventTitleModal(plugin, config, '2026-08-21');
		modal.onOpen();

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

		expect(
			modalHarness.elements.some(
				({ tag, options }) => tag === 'button' && options?.text === 'Create',
			),
		).toBe(false);

		modal.close();
		await vi.waitFor(() => {
			expect(createEvent).toHaveBeenCalledOnce();
			expect(modalHarness.closeCalls).toBe(1);
		});
		modal.close();
		await Promise.resolve();

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

	it('keeps the form open without creating when Enter is pressed in the title', async () => {
		const createEvent = vi.fn().mockResolvedValue({
			path: 'Life/Work/planning--7f3a9c00.md',
		});
		const plugin = {
			app: {},
			documents: { createEvent },
			openAdapter: { openMarkdownFile: vi.fn() },
		} as unknown as CalendarViewPlugin;

		new EventTitleModal(plugin, calendarConfig(), '2026-08-21').onOpen();

		const title = findElement(
			({ options }) => options?.attr?.['aria-label'] === 'Event title',
		);
		title.value = 'Planning';
		title.emit('input');
		title.emit('keydown', { key: 'Enter', preventDefault: vi.fn() });
		await Promise.resolve();

		expect(createEvent).not.toHaveBeenCalled();
		expect(modalHarness.closeCalls).toBe(0);
	});

	it('keeps the form open and allows another close attempt when creation fails', async () => {
		const createEvent = vi
			.fn()
			.mockRejectedValueOnce(new Error('Unable to write event.'))
			.mockResolvedValueOnce({ path: 'Life/Work/planning--7f3a9c00.md' });
		const plugin = {
			app: {},
			documents: { createEvent },
			openAdapter: { openMarkdownFile: vi.fn() },
		} as unknown as CalendarViewPlugin;
		const modal = new EventTitleModal(plugin, calendarConfig(), '2026-08-21');
		modal.onOpen();

		const title = findElement(
			({ options }) => options?.attr?.['aria-label'] === 'Event title',
		);
		title.value = 'Planning';
		title.emit('input');

		modal.close();
		await vi.waitFor(() =>
			expect(modalHarness.notices).toEqual(['Unable to write event.']),
		);
		expect(modalHarness.closeCalls).toBe(0);

		modal.close();
		await vi.waitFor(() => {
			expect(createEvent).toHaveBeenCalledTimes(2);
			expect(modalHarness.closeCalls).toBe(1);
		});
	});

	it('creates from the draft snapshot captured when closing starts', async () => {
		let finishCreation: ((file: { path: string }) => void) | undefined;
		const createEvent = vi.fn().mockImplementation(
			() =>
				new Promise<{ path: string }>((resolve) => {
					finishCreation = resolve;
				}),
		);
		const plugin = {
			app: {},
			documents: { createEvent },
			openAdapter: { openMarkdownFile: vi.fn() },
		} as unknown as CalendarViewPlugin;
		const modal = new EventTitleModal(plugin, calendarConfig(), '2026-08-21');
		modal.onOpen();

		modal.close();
		modalHarness.propertyControls.find(({ property }) => property === 'status')?.onChange('Done');

		const capturedProperties = createEvent.mock.calls[0]?.[3] as Record<string, unknown>;
		expect(capturedProperties.status).toBe('Not started');

		finishCreation?.({ path: 'Life/Work/untitled--7f3a9c00.md' });
		await vi.waitFor(() => expect(modalHarness.closeCalls).toBe(1));
	});
});
