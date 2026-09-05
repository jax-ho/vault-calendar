import { describe, expect, it, vi } from 'vitest';
import type {
	BoardSavedView,
	CalendarConfig,
	CalendarSavedView,
} from '../types';
import {
	BoardCardMover,
	BoardMoveRejectedError,
	type BoardPropertyWriter,
	type BoardViewResolver,
	type ResolvedBoardView,
} from './board-card-mover';

const board: BoardSavedView = {
	id: 'work-board',
	name: 'Work board',
	type: 'board',
	groupBy: 'status',
};

function config(overrides: Partial<CalendarConfig> = {}): CalendarConfig {
	return {
		documentPath: 'Calendars/Work/_calendar.md',
		name: 'Work',
		sourceFolder: 'Calendars/Work',
		recursive: true,
		startDateProperty: 'date',
		endDateProperty: 'date-end',
		visibleProperties: ['status'],
		propertyDefinitions: {
			status: {
				type: 'select',
				options: ['None', 'Todo', 'Doing', 'Done'],
				default: 'Todo',
			},
		},
		weekStartsOn: 'locale',
		layout: 'month',
		openBehavior: 'same-leaf',
		createFolder: 'Calendars/Work',
		excludePaths: [],
		viewCatalog: {
			source: 'canonical',
			entries: [{ kind: 'valid', definition: board }],
			canMutate: true,
		},
		...overrides,
	};
}

function harness(resolution: ResolvedBoardView | null = { view: board, config: config() }) {
	const resolveView = vi.fn<BoardViewResolver>(async () => resolution ?? undefined);
	const updateProperty = vi.fn<BoardPropertyWriter['updateProperty']>(async () => undefined);
	return {
		mover: new BoardCardMover(resolveView, { updateProperty }),
		resolveView,
		updateProperty,
	};
}

const move = {
	viewId: 'work-board',
	path: 'Tasks/Launch.md',
	expectedMtime: 42,
	groupBy: 'status',
	sourceValue: 'Doing',
	targetValue: 'Done',
};

describe('Board card mover', () => {
	it('resolves the latest view by ID and writes only its current group property', async () => {
		const { mover, resolveView, updateProperty } = harness();

		await expect(mover.move(move)).resolves.toBe('moved');

		expect(resolveView).toHaveBeenCalledExactlyOnceWith('work-board');
		expect(updateProperty).toHaveBeenCalledExactlyOnceWith(
			'Tasks/Launch.md',
			42,
			'status',
			'Done',
			undefined,
		);
	});

	it('writes the literal None option instead of deleting the property', async () => {
		const { mover, updateProperty } = harness();

		await mover.move({ ...move, targetValue: 'None' });

		expect(updateProperty).toHaveBeenCalledExactlyOnceWith(
			'Tasks/Launch.md',
			42,
			'status',
			'None',
			undefined,
		);
	});

	it('returns unchanged for a same-column move without resolving or writing', async () => {
		const { mover, resolveView, updateProperty } = harness();

		await expect(
			mover.move({ ...move, targetValue: move.sourceValue }),
		).resolves.toBe('unchanged');

		expect(resolveView).not.toHaveBeenCalled();
		expect(updateProperty).not.toHaveBeenCalled();
	});

	it('rejects the move if the view was deleted or changed type', async () => {
		const deleted = harness(null);
		await expect(deleted.mover.move(move)).rejects.toBeInstanceOf(
			BoardMoveRejectedError,
		);
		expect(deleted.updateProperty).not.toHaveBeenCalled();

		const calendarView: CalendarSavedView = {
			id: board.id,
			name: 'Calendar',
			type: 'calendar',
			layout: 'month',
			weekStartsOn: 'locale',
		};
		const changedType = harness({ view: calendarView, config: config() });
		await expect(changedType.mover.move(move)).rejects.toBeInstanceOf(
			BoardMoveRejectedError,
		);
		expect(changedType.updateProperty).not.toHaveBeenCalled();
	});

	it('rejects the move if groupBy changed after dragging started', async () => {
		const changedBoard: BoardSavedView = { ...board, groupBy: 'type' };
		const { mover, updateProperty } = harness({
			view: changedBoard,
			config: config({
				propertyDefinitions: {
					type: { type: 'select', options: ['None', 'Task'] },
				},
			}),
		});

		await expect(mover.move(move)).rejects.toThrow('group property changed');
		expect(updateProperty).not.toHaveBeenCalled();
	});

	it('rejects a removed target option against the latest schema', async () => {
		const { mover, updateProperty } = harness({
			view: board,
			config: config({
				propertyDefinitions: {
					status: { type: 'select', options: ['None', 'Todo', 'Doing'] },
				},
			}),
		});

		await expect(mover.move(move)).rejects.toThrow('option is no longer available');
		expect(updateProperty).not.toHaveBeenCalled();
	});

	it('rejects a group property that is no longer writable', async () => {
		const { mover, updateProperty } = harness({
			view: board,
			config: config({
				propertyDefinitions: { status: { type: 'text' } },
			}),
		});

		await expect(mover.move(move)).rejects.toThrow('no longer writable');
		expect(updateProperty).not.toHaveBeenCalled();
	});

	it('stops before writing when the move is aborted while resolving the view', async () => {
		let finishResolution: ((value: ResolvedBoardView) => void) | undefined;
		const resolveView = vi.fn<BoardViewResolver>(
			() =>
				new Promise((resolve) => {
					finishResolution = resolve;
				}),
		);
		const updateProperty = vi.fn<BoardPropertyWriter['updateProperty']>(
			async () => undefined,
		);
		const mover = new BoardCardMover(resolveView, { updateProperty });
		const controller = new AbortController();

		const moving = mover.move({ ...move, signal: controller.signal });
		controller.abort();
		finishResolution?.({ view: board, config: config() });

		await expect(moving).rejects.toThrow('cancelled');
		expect(updateProperty).not.toHaveBeenCalled();
	});

	it('passes the cancellation signal through to the frontmatter writer', async () => {
		const { mover, updateProperty } = harness();
		const controller = new AbortController();

		await mover.move({ ...move, signal: controller.signal });

		expect(updateProperty).toHaveBeenCalledExactlyOnceWith(
			'Tasks/Launch.md',
			42,
			'status',
			'Done',
			controller.signal,
		);
	});
});
