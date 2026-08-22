import { describe, expect, it } from 'vitest';
import {
	resolvedPropertyValue,
	resolvedSelectValue,
	selectPropertyOptions,
} from './property-values';

const status = {
	type: 'select' as const,
	options: ['None', 'Not started', 'Done'],
	default: 'Not started',
};

describe('schema property values', () => {
	it('keeps configured select values and applies defaults to missing values', () => {
		expect(resolvedPropertyValue(status, 'Done')).toBe('Done');
		expect(resolvedPropertyValue(status, undefined)).toBe('Not started');
	});

	it('resolves deleted select options to None', () => {
		expect(resolvedSelectValue(status, 'Removed')).toBe('None');
		expect(resolvedPropertyValue(status, 'Removed')).toBe('None');
	});

	it('keeps None mandatory and first', () => {
		expect(
			selectPropertyOptions({ type: 'select', options: ['Todo', 'None', 'Done'] }),
		).toEqual(['None', 'Todo', 'Done']);
	});
});
