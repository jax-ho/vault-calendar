import { describe, expect, it } from 'vitest';
import { moveDateRange, resizeDateRange } from './interactions';

describe('drag and resize date calculations', () => {
	it('moves a single-day event', () => {
		expect(moveDateRange('2026-08-17', undefined, '2026-08-20')).toEqual({
			start: '2026-08-20',
		});
	});

	it('moves a multi-day event while preserving its duration', () => {
		expect(moveDateRange('2026-08-17', '2026-08-20', '2026-09-01')).toEqual({
			start: '2026-09-01',
			end: '2026-09-04',
		});
	});

	it('extends either edge and collapses back to one day', () => {
		expect(resizeDateRange('2026-08-17', undefined, 'end', '2026-08-20')).toEqual({
			start: '2026-08-17',
			end: '2026-08-20',
		});
		expect(resizeDateRange('2026-08-17', '2026-08-20', 'start', '2026-08-20')).toEqual({
			start: '2026-08-20',
		});
	});

	it('rejects invalid ranges', () => {
		expect(() => resizeDateRange('2026-08-17', '2026-08-20', 'end', '2026-08-16')).toThrow();
		expect(() => resizeDateRange('2026-08-17', '2026-08-20', 'start', '2026-08-21')).toThrow();
	});
});
