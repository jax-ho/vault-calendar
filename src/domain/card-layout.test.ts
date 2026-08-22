import { describe, expect, it } from 'vitest';
import { calendarCardMetrics } from './card-layout';

describe('calendar card metrics', () => {
	it('keeps compact cards for the default two properties', () => {
		expect(calendarCardMetrics(2)).toEqual({ height: 108, step: 114 });
	});

	it('grows the card and track when more properties are visible', () => {
		expect(calendarCardMetrics(5)).toEqual({ height: 150, step: 156 });
	});
});
