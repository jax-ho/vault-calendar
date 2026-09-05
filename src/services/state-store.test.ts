import { describe, expect, it } from 'vitest';
import type { CalendarUiState } from '../types';
import { CalendarStateStore } from './state-store';

function uiState(
	focusDate: string,
	options: { activeViewId?: string; scrollTop?: number } = {},
): CalendarUiState {
	const calendarState: CalendarUiState['viewStates'][string] = {
		type: 'calendar',
		focusDate,
	};
	if (options.scrollTop !== undefined) calendarState.scrollTop = options.scrollTop;
	return {
		activeViewId: options.activeViewId ?? 'calendar',
		viewStates: { calendar: calendarState },
	};
}

describe('per-calendar UI state', () => {
	it('isolates multiple calendars and leaves', async () => {
		const store = new CalendarStateStore(undefined, async () => undefined);
		await store.set('Work.md', 'leaf-a', uiState('2026-08-17'));
		await store.set('Learning.md', 'leaf-b', uiState('2026-09-01'));
		await store.set('Work.md', 'leaf-c', uiState('2026-10-10'));

		expect(store.get('Work.md', 'leaf-a')).toEqual(uiState('2026-08-17'));
		expect(store.get('Work.md', 'leaf-c')).toEqual(uiState('2026-10-10'));
		expect(store.get('Work.md', 'leaf-new')).toEqual(uiState('2026-10-10'));
		expect(store.get('Learning.md', 'leaf-b')).toEqual(uiState('2026-09-01'));
	});

	it('does not give a copied calendar the original UI state', async () => {
		const store = new CalendarStateStore(undefined, async () => undefined);
		await store.set('Work.md', 'leaf-a', uiState('2026-08-17'));

		expect(store.get('Work copy.md', 'leaf-new')).toBeUndefined();
	});

	it('migrates state on move or rename and cleans it on deletion', async () => {
		const saved: unknown[] = [];
		const store = new CalendarStateStore(undefined, async (data) => {
			saved.push(data);
		});
		await store.set('Life/Work/_calendar.md', 'leaf-a', uiState('2026-08-17'));
		await store.migrate('Life/Work/_calendar.md', 'Archive/Work/_calendar.md');

		expect(store.get('Life/Work/_calendar.md', 'leaf-a')).toBeUndefined();
		expect(store.get('Archive/Work/_calendar.md', 'leaf-a')).toEqual(
			uiState('2026-08-17'),
		);
		await store.delete('Archive/Work/_calendar.md');
		expect(store.get('Archive/Work/_calendar.md', 'leaf-a')).toBeUndefined();
		expect(saved.length).toBeGreaterThanOrEqual(3);
	});

	it('migrates legacy calendar state into the stable calendar view ID', () => {
		const store = new CalendarStateStore(
			{
				calendarStates: {
					'Legacy.md': {
						leaves: {
							legacy: {
								focusDate: '2026-08-17',
								layout: 'week',
								scrollTop: 42,
							},
						},
					},
				},
			},
			async () => undefined,
		);

		expect(store.get('Legacy.md', 'legacy')).toEqual(uiState('2026-08-17', {
			scrollTop: 42,
		}));
		const migrated = store.snapshot().calendarStates['Legacy.md']?.leaves.legacy;
		expect(migrated).not.toHaveProperty('layout');
	});

	it('normalizes each saved view state and ignores malformed entries', () => {
		const persisted = {
			calendarStates: {
				'Work.md': {
					leaves: {
						'leaf-a': {
							activeViewId: 'board-a',
							viewStates: {
								calendar: {
									type: 'calendar',
									focusDate: '2026-09-01',
									scrollTop: -10,
								},
								'board-a': {
									type: 'board',
									scrollLeft: 120,
									scrollTop: Number.POSITIVE_INFINITY,
								},
								broken: { type: 'calendar', focusDate: 'tomorrow' },
								},
							},
						},
					},
				},
		};
		const store = new CalendarStateStore(persisted, async () => undefined);
		persisted.calendarStates['Work.md'].leaves['leaf-a'].viewStates['board-a'].scrollLeft = 999;

		expect(store.get('Work.md', 'leaf-a')).toEqual({
			activeViewId: 'board-a',
			viewStates: {
				calendar: {
					type: 'calendar',
					focusDate: '2026-09-01',
					scrollTop: 0,
				},
				'board-a': { type: 'board', scrollLeft: 120 },
			},
		});
	});

	it('deeply isolates set input, leaf/shared fallback, get results, and snapshots', async () => {
		const store = new CalendarStateStore(undefined, async () => undefined);
		const input: CalendarUiState = {
			activeViewId: 'board-a',
			viewStates: {
				calendar: { type: 'calendar', focusDate: '2026-08-17', scrollTop: 10 },
				'board-a': { type: 'board', scrollLeft: 20, scrollTop: 30 },
			},
		};
		await store.set('Work.md', 'leaf-a', input);

		input.viewStates.calendar = { type: 'calendar', focusDate: '2030-01-01' };
		const firstRead = store.get('Work.md', 'leaf-a');
		expect(firstRead).toEqual({
			activeViewId: 'board-a',
			viewStates: {
				calendar: { type: 'calendar', focusDate: '2026-08-17', scrollTop: 10 },
				'board-a': { type: 'board', scrollLeft: 20, scrollTop: 30 },
			},
		});

		if (!firstRead) throw new Error('Expected stored state.');
		firstRead.viewStates['board-a'] = { type: 'board', scrollLeft: 999 };
		expect(store.get('Work.md', 'leaf-a')?.viewStates['board-a']).toEqual({
			type: 'board',
			scrollLeft: 20,
			scrollTop: 30,
		});

		const snapshot = store.snapshot();
		const documentState = snapshot.calendarStates['Work.md'];
		if (!documentState?.shared) throw new Error('Expected leaf and shared state.');
		documentState.leaves['leaf-a']!.viewStates.calendar = {
			type: 'calendar',
			focusDate: '2040-01-01',
		};
		expect(documentState.shared.viewStates.calendar).toEqual({
			type: 'calendar',
			focusDate: '2026-08-17',
			scrollTop: 10,
		});
		expect(store.get('Work.md', 'leaf-a')?.viewStates.calendar).toEqual({
			type: 'calendar',
			focusDate: '2026-08-17',
			scrollTop: 10,
		});
	});

	it('ignores malformed legacy state instead of breaking calendar startup', () => {
		const store = new CalendarStateStore(
			{
				calendarStates: {
					'Broken.md': { leaves: { bad: { focusDate: 'tomorrow' } } },
				},
			},
			async () => undefined,
		);

		expect(store.get('Broken.md', 'bad')).toBeUndefined();
	});
});
