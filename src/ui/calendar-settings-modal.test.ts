import { describe, expect, it, vi } from 'vitest';

const modalHarness = vi.hoisted(() => ({
	notices: [] as string[],
}));

class MockElement {
	empty(): void {}

	setText(_text: string): void {}
}

vi.mock('obsidian', () => ({
	Modal: class {
		contentEl = new MockElement();
		modalEl = new MockElement();

		constructor(_app: unknown) {}

		setTitle(_title: string): void {}
	},
	Notice: class {
		constructor(message: string) {
			modalHarness.notices.push(message);
		}
	},
	Setting: class {},
	setIcon: vi.fn(),
}));

vi.mock('./property-editor-modal', () => ({ PropertyEditorModal: class {} }));
vi.mock('./property-manager', () => ({ renderPropertyManager: vi.fn() }));
vi.mock('./ui-locale', () => ({ applyUiLocale: vi.fn() }));

import type CalendarViewPlugin from '../main';
import type {
	CalendarPropertyMutation,
	CalendarSharedConfigField,
	SaveCalendarOptions,
} from '../services/calendar-document';
import type { CalendarConfig } from '../types';
import { CalendarSettingsModal } from './calendar-settings-modal';

function config(): CalendarConfig {
	return {
		documentPath: 'Projects/Work/_calendar.md',
		name: 'Work',
		sourceFolder: 'Projects/Work',
		recursive: true,
		startDateProperty: 'date',
		visibleProperties: [],
		propertyDefinitions: {},
		viewCatalog: {
			source: 'canonical',
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
			canMutate: true,
		},
		weekStartsOn: 'locale',
		layout: 'month',
		openBehavior: 'same-leaf',
		createFolder: 'Projects/Work',
		excludePaths: [],
	};
}

function deferred<T>(): {
	promise: Promise<T>;
	reject: (reason: Error) => void;
} {
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((_resolve, rejectPromise) => {
		reject = rejectPromise;
	});
	return { promise, reject };
}

interface TestableSettingsModal {
	commit(): Promise<void>;
	dirtyFields: Set<CalendarSharedConfigField>;
	draft: CalendarConfig;
	onClose(): void;
	propertyMutations: CalendarPropertyMutation[];
	revalidateBoardGroups: Set<string>;
	saveQueue: Promise<void>;
}

function createModal() {
	const firstAttempt = deferred<CalendarConfig>();
	let attempts = 0;
	const save = vi.fn((draft: CalendarConfig, _options: SaveCalendarOptions = {}) => {
		attempts += 1;
		return attempts === 1 ? firstAttempt.promise : Promise.resolve(draft);
	});
	const onApplied = vi.fn(async () => undefined);
	const plugin = {
		app: {},
		documents: { save },
	} as unknown as CalendarViewPlugin;
	const modal = new CalendarSettingsModal(plugin, config(), onApplied);
	return {
		api: modal as unknown as TestableSettingsModal,
		firstAttempt,
		onApplied,
		save,
	};
}

describe('Calendar settings save queue', () => {
	it('takes queued snapshots after earlier failures restore their dirty fields', async () => {
		const { api, firstAttempt, onApplied, save } = createModal();
		api.draft.name = 'Renamed work';
		api.dirtyFields.add('name');
		const firstCommit = api.commit();
		await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

		api.draft.recursive = false;
		api.dirtyFields.add('recursive');
		const secondCommit = api.commit();
		firstAttempt.reject(new Error('First write failed.'));
		await Promise.all([firstCommit, secondCommit]);

		expect(save).toHaveBeenCalledTimes(2);
		expect(save.mock.calls[1]?.[0]).toMatchObject({
			name: 'Renamed work',
			recursive: false,
		});
		expect(new Set(save.mock.calls[1]?.[1]?.changedFields ?? [])).toEqual(
			new Set(['name', 'recursive']),
		);
		expect(onApplied).toHaveBeenCalledOnce();
	});

	it('queues a final retry behind an in-flight save when the modal closes', async () => {
		const { api, firstAttempt, save } = createModal();
		api.draft.name = 'Renamed work';
		api.dirtyFields.add('name');
		void api.commit();
		await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

		api.onClose();
		firstAttempt.reject(new Error('First write failed.'));
		await api.saveQueue;

		expect(save).toHaveBeenCalledTimes(2);
		expect(save.mock.calls[1]?.[1]?.changedFields).toEqual(['name']);
	});

	it('restores property and Board intents before the next queued drain', async () => {
		const { api, firstAttempt, save } = createModal();
		api.propertyMutations.push({
			kind: 'add',
			property: 'owner',
			definition: { type: 'text' },
		});
		api.revalidateBoardGroups.add('status');
		const firstCommit = api.commit();
		await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

		const secondCommit = api.commit();
		firstAttempt.reject(new Error('First write failed.'));
		await Promise.all([firstCommit, secondCommit]);

		expect(save).toHaveBeenCalledTimes(2);
		expect(save.mock.calls[1]?.[1]).toMatchObject({
			propertyMutations: [
				{
					kind: 'add',
					property: 'owner',
					definition: { type: 'text' },
				},
			],
			revalidateBoardGroups: ['status'],
		});
	});
});
