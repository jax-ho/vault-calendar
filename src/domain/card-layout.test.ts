import { describe, expect, it } from 'vitest';
import { calendarCardMetrics } from './card-layout';

describe('calendar card metrics', () => {
	it('keeps compact cards for the default two properties', () => {
		expect(calendarCardMetrics(2)).toEqual({ height: 108, step: 114 });
	});

	it('grows the card and track when more properties are visible', () => {
		expect(calendarCardMetrics(5)).toEqual({ height: 150, step: 156 });
	});

	it('uses the existing minimum height for one relationship row', () => {
		expect(calendarCardMetrics(2, 1)).toEqual({ height: 108, step: 114 });
	});

	it('reserves a shared track height for parent and sub-item rows', () => {
		expect(calendarCardMetrics(2, 2)).toEqual({ height: 128, step: 134 });
		expect(calendarCardMetrics(5, 1)).toEqual({ height: 172, step: 178 });
	});

	it('normalizes invalid row counts', () => {
		expect(calendarCardMetrics(-1, -2)).toEqual({ height: 108, step: 114 });
		expect(calendarCardMetrics(2.9, 2.9)).toEqual({ height: 128, step: 134 });
	});
});
