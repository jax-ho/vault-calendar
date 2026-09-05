import { describe, expect, it } from 'vitest';
import type {
	BoardSavedView,
	CalendarItem,
	CalendarPropertyDefinition,
} from '../types';
import { projectBoardColumns } from './board-projection';

const view: BoardSavedView = {
	id: 'work-board',
	name: 'Work board',
	type: 'board',
	groupBy: 'status',
};

const definition: CalendarPropertyDefinition = {
	type: 'select',
	options: ['Todo', 'None', 'Doing', 'Done'],
	default: 'Todo',
};

function item(
	path: string,
	properties: Record<string, unknown>,
	overrides: Partial<CalendarItem> = {},
): CalendarItem {
	return {
		path,
		title: path.replace(/\.md$/u, ''),
		start: '2026-09-04',
		startTimeSort: 0,
		allDay: true,
		properties,
		mtime: 1,
		subItems: [],
		...overrides,
	};
}

describe('board projection', () => {
	it('creates every Select option in canonical order, including empty columns', () => {
		const columns = projectBoardColumns(
			[item('Doing.md', { status: 'Doing' })],
			view,
			definition,
		);

		expect(columns.map((column) => column.value)).toEqual([
			'None',
			'Todo',
			'Doing',
			'Done',
		]);
		expect(columns.map((column) => column.items.length)).toEqual([0, 0, 1, 0]);
	});

	it('buckets effective defaults while missing, explicit None, and unknown values use None', () => {
		const columns = projectBoardColumns(
			[
				item('Effective default.md', { status: 'Todo' }),
				item('Missing.md', {}),
				item('Explicit none.md', { status: 'None' }),
				item('Deleted option.md', { status: 'Blocked' }),
			],
			view,
			definition,
		);

		expect(columns.find((column) => column.value === 'Todo')?.items.map(({ path }) => path))
			.toEqual(['Effective default.md']);
		expect(columns.find((column) => column.value === 'None')?.items.map(({ path }) => path))
			.toEqual(['Deleted option.md', 'Explicit none.md', 'Missing.md']);
		expect(columns.flatMap((column) => column.items)).toHaveLength(4);
	});

	it('sorts each column by date, start time, title, and path without mutating input', () => {
		const items = [
			item('Later day.md', { status: 'Doing' }, { start: '2026-09-05' }),
			item('Z.md', { status: 'Doing' }, { title: 'Same', startTimeSort: 900 }),
			item('B.md', { status: 'Doing' }, { title: 'Same', startTimeSort: 800 }),
			item('A.md', { status: 'Doing' }, { title: 'Same', startTimeSort: 800 }),
		];

		const columns = projectBoardColumns(items, view, definition);

		expect(columns.find((column) => column.value === 'Doing')?.items.map(({ path }) => path))
			.toEqual(['A.md', 'B.md', 'Z.md', 'Later day.md']);
		expect(items.map(({ path }) => path)).toEqual([
			'Later day.md',
			'Z.md',
			'B.md',
			'A.md',
		]);
	});

	it('rejects a Board that is not ready for projection', () => {
		expect(() =>
			projectBoardColumns([], { ...view, groupBy: undefined }, definition),
		).toThrow('does not have a group property');
		expect(() =>
			projectBoardColumns([], view, { type: 'text' }),
		).toThrow('must be a Select property');
	});
});
