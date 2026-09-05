import { describe, expect, it } from 'vitest';
import type { SavedView } from '../types';
import { parseCalendarConfig } from '../domain/config';
import { CalendarConfigMutationCoordinator } from './calendar-config-mutation-coordinator';
import {
	SavedViewMutationError,
	SavedViewStore,
	type SavedViewDocument,
	type SavedViewStorePort,
} from './saved-view-store';

type FakeFile = SavedViewDocument;

function legacyFrontmatter(): Record<string, unknown> {
	return {
		'calendar-view': true,
		title: 'Work',
		'calendar-start-property': 'date',
		'calendar-properties': {
			status: {
				type: 'select',
				options: ['None', 'Todo', 'Doing', 'Done'],
				default: 'Todo',
			},
			type: { type: 'select', options: ['None', 'Task', 'Idea'] },
		},
		'calendar-visible-properties': ['status'],
		'calendar-layout': 'month',
		'calendar-week-starts-on': 'locale',
	};
}

function createStore(
	frontmatter: Record<string, unknown>,
	coordinator = new CalendarConfigMutationCoordinator(),
): {
	store: SavedViewStore<FakeFile>;
	port: SavedViewStorePort<FakeFile>;
} {
	const file = { path: 'Work/_calendar.md' };
	const port: SavedViewStorePort<FakeFile> = {
		getFileByPath: (path) => (path === file.path ? file : null),
		processFrontMatter: async (_file, mutate) => mutate(frontmatter),
	};
	return { store: new SavedViewStore(port, coordinator), port };
}

function board(id: string, name: string, groupBy = 'status'): SavedView {
	return { id, name, type: 'board', groupBy };
}

describe('saved-view store', () => {
	it('canonicalizes a legacy document when adding a Board', async () => {
		const frontmatter = legacyFrontmatter();
		const { store } = createStore(frontmatter);

		const catalog = await store.commit('Work/_calendar.md', {
			kind: 'add',
			view: board('work-board', 'Work board'),
		});

		expect(catalog.source).toBe('canonical');
		expect(catalog.entries).toHaveLength(2);
		expect(frontmatter['calendar-views-version']).toBe(1);
		expect(frontmatter['calendar-views']).toEqual([
			{
				id: 'calendar',
				name: 'Calendar view',
				type: 'calendar',
				layout: 'month',
				'week-starts-on': 'locale',
			},
			{
				id: 'work-board',
				name: 'Work board',
				type: 'board',
				'group-by': 'status',
			},
		]);
		expect(frontmatter).not.toHaveProperty('calendar-layout');
		expect(frontmatter).not.toHaveProperty('calendar-week-starts-on');
	});

	it('applies concurrent commands to the latest frontmatter instead of losing one', async () => {
		const frontmatter = legacyFrontmatter();
		const coordinator = new CalendarConfigMutationCoordinator();
		const first = createStore(frontmatter, coordinator).store;
		const second = createStore(frontmatter, coordinator).store;

		await Promise.all([
			first.commit('Work/_calendar.md', {
				kind: 'add',
				view: board('status-board', 'Status board'),
			}),
			second.commit('Work/_calendar.md', {
				kind: 'add',
				view: board('type-board', 'Type board', 'type'),
			}),
		]);

		const views = frontmatter['calendar-views'] as Array<Record<string, unknown>>;
		expect(views.map(({ id }) => id)).toEqual([
			'calendar',
			'status-board',
			'type-board',
		]);
	});

	it('rejects duplicate names using the latest catalog', async () => {
		const frontmatter = legacyFrontmatter();
		const { store } = createStore(frontmatter);
		await store.commit('Work/_calendar.md', {
			kind: 'add',
			view: board('work-board', 'Work board'),
		});

		await expect(
			store.commit('Work/_calendar.md', {
				kind: 'add',
				view: board('another-board', ' work BOARD '),
			}),
		).rejects.toBeInstanceOf(SavedViewMutationError);
	});

	it('updates by stable ID and preserves identity and type', async () => {
		const frontmatter = legacyFrontmatter();
		const { store } = createStore(frontmatter);
		await store.commit('Work/_calendar.md', {
			kind: 'add',
			view: board('work-board', 'Work board'),
		});

		await store.commit('Work/_calendar.md', {
			kind: 'rename',
			viewId: 'work-board',
			name: 'Pipeline',
		});
		const result = await store.commit('Work/_calendar.md', {
			kind: 'configure-board',
			viewId: 'work-board',
			groupBy: 'type',
		});

		expect(result.entries.at(-1)).toMatchObject({
			kind: 'valid',
			definition: {
				id: 'work-board',
				name: 'Pipeline',
				type: 'board',
				groupBy: 'type',
			},
		});
	});

	it('returns the canonical warnings and indexes produced by reparsing the write', async () => {
		const frontmatter = legacyFrontmatter();
		const { store } = createStore(frontmatter);
		await store.commit('Work/_calendar.md', {
			kind: 'add',
			view: board('work-board', 'Work board'),
		});

		const setup = await store.commit('Work/_calendar.md', {
			kind: 'configure-board',
			viewId: 'work-board',
			groupBy: undefined,
		});
		expect(setup.entries[1]).toMatchObject({
			kind: 'valid',
			warnings: [
				{
					field: 'calendar-views[1].group-by',
					message: 'Choose a Select property to group this Board.',
					viewId: 'work-board',
				},
			],
		});

		const renamed = await store.commit('Work/_calendar.md', {
			kind: 'rename',
			viewId: 'work-board',
			name: 'Pipeline',
		});
		expect(renamed.entries[1]).toMatchObject({
			kind: 'valid',
			definition: { id: 'work-board', name: 'Pipeline' },
			warnings: [expect.objectContaining({ field: 'calendar-views[1].group-by' })],
		});

		const removed = await store.commit('Work/_calendar.md', {
			kind: 'remove',
			viewId: 'calendar',
		});
		expect(removed.entries).toHaveLength(1);
		expect(removed.entries[0]).toMatchObject({
			kind: 'valid',
			definition: { id: 'work-board', name: 'Pipeline' },
			warnings: [
				{
					field: 'calendar-views[0].group-by',
					message: 'Choose a Select property to group this Board.',
					viewId: 'work-board',
				},
			],
		});
		expect(removed).toEqual(
			parseCalendarConfig('Work/_calendar.md', frontmatter).config?.viewCatalog,
		);
	});

	it('does not remove the last view', async () => {
		const frontmatter = legacyFrontmatter();
		const { store } = createStore(frontmatter);

		await expect(
			store.commit('Work/_calendar.md', {
				kind: 'remove',
				viewId: 'calendar',
			}),
		).rejects.toThrow('at least one view');
		expect(frontmatter).not.toHaveProperty('calendar-views');
	});

	it('fails closed for malformed canonical catalogs', async () => {
		const frontmatter = {
			...legacyFrontmatter(),
			'calendar-views-version': 1,
			'calendar-views': [
				{ id: 'same', name: 'One', type: 'calendar' },
				{ id: 'same', name: 'Two', type: 'board', 'group-by': 'status' },
			],
		};
		const original = structuredClone(frontmatter['calendar-views']);
		const { store } = createStore(frontmatter);

		await expect(
			store.commit('Work/_calendar.md', {
				kind: 'add',
				view: board('safe-board', 'Safe board'),
			}),
		).rejects.toBeInstanceOf(SavedViewMutationError);
		expect(frontmatter['calendar-views']).toEqual(original);
	});
});
