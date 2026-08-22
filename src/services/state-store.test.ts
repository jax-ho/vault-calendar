import { describe, expect, it } from 'vitest';
import { CalendarStateStore } from './state-store';

describe('per-calendar UI state', () => {
	it('isolates multiple calendars and leaves', async () => {
		const store = new CalendarStateStore(undefined, async () => undefined);
		await store.set('Work.md', 'leaf-a', { focusDate: '2026-08-17' });
		await store.set('Learning.md', 'leaf-b', { focusDate: '2026-09-01' });
		await store.set('Work.md', 'leaf-c', { focusDate: '2026-10-10' });

		expect(store.get('Work.md', 'leaf-a')?.focusDate).toBe('2026-08-17');
		expect(store.get('Work.md', 'leaf-c')?.focusDate).toBe('2026-10-10');
		expect(store.get('Learning.md', 'leaf-b')?.focusDate).toBe('2026-09-01');
	});

	it('does not give a copied calendar the original UI state', async () => {
		const store = new CalendarStateStore(undefined, async () => undefined);
		await store.set('Work.md', 'leaf-a', { focusDate: '2026-08-17' });

		expect(store.get('Work copy.md', 'leaf-new')).toBeUndefined();
	});

	it('migrates state on move or rename and cleans it on deletion', async () => {
		const saved: unknown[] = [];
		const store = new CalendarStateStore(undefined, async (data) => {
			saved.push(data);
		});
		await store.set('Life/Work/_calendar.md', 'leaf-a', { focusDate: '2026-08-17' });
		await store.migrate('Life/Work/_calendar.md', 'Archive/Work/_calendar.md');

		expect(store.get('Life/Work/_calendar.md', 'leaf-a')).toBeUndefined();
		expect(store.get('Archive/Work/_calendar.md', 'leaf-a')?.focusDate).toBe('2026-08-17');
		await store.delete('Archive/Work/_calendar.md');
		expect(store.get('Archive/Work/_calendar.md', 'leaf-a')).toBeUndefined();
		expect(saved.length).toBeGreaterThanOrEqual(3);
	});

	it('ignores malformed persisted state instead of breaking calendar startup', () => {
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
