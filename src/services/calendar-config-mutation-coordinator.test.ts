import { describe, expect, it, vi } from 'vitest';
import { CalendarConfigMutationCoordinator } from './calendar-config-mutation-coordinator';

describe('CalendarConfigMutationCoordinator', () => {
	it('serializes mutations for the same calendar document', async () => {
		const coordinator = new CalendarConfigMutationCoordinator();
		let releaseFirst: (() => void) | undefined;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const order: string[] = [];

		const first = coordinator.run('Work/_calendar.md', async () => {
			order.push('first:start');
			await firstGate;
			order.push('first:end');
			return 1;
		});
		const second = coordinator.run('Work/_calendar.md', async () => {
			order.push('second');
			return 2;
		});

		await vi.waitFor(() => expect(order).toEqual(['first:start']));
		releaseFirst?.();

		await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
		expect(order).toEqual(['first:start', 'first:end', 'second']);
	});

	it('allows different calendar documents to mutate independently', async () => {
		const coordinator = new CalendarConfigMutationCoordinator();
		let releaseWork: (() => void) | undefined;
		const workGate = new Promise<void>((resolve) => {
			releaseWork = resolve;
		});
		const personal = vi.fn().mockResolvedValue('personal');

		const work = coordinator.run('Work/_calendar.md', async () => {
			await workGate;
			return 'work';
		});
		const other = coordinator.run('Personal/_calendar.md', personal);

		await expect(other).resolves.toBe('personal');
		expect(personal).toHaveBeenCalledOnce();
		releaseWork?.();
		await expect(work).resolves.toBe('work');
	});

	it('continues the queue after a failed mutation', async () => {
		const coordinator = new CalendarConfigMutationCoordinator();
		const failure = coordinator.run('Work/_calendar.md', async () => {
			throw new Error('save failed');
		});
		const success = coordinator.run('Work/_calendar.md', async () => 'saved');

		await expect(failure).rejects.toThrow('save failed');
		await expect(success).resolves.toBe('saved');
	});
});
