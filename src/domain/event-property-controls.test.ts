import { describe, expect, it } from 'vitest';
import { eventPropertyControl } from './event-property-controls';

describe('schema-driven event property controls', () => {
	it('renders configured select options without depending on the property name', () => {
		expect(
			eventPropertyControl({
				type: 'select',
				options: ['Not started', 'Blocked', 'In progress', 'Abandoned', 'Done'],
				default: 'Not started',
			}),
		).toEqual({
			kind: 'select',
			options: ['None', 'Not started', 'Blocked', 'In progress', 'Abandoned', 'Done'],
		});
	});

	it('supports all schema types and leaves undefined fields inferred', () => {
		expect(eventPropertyControl({ type: 'checkbox' })).toEqual({ kind: 'checkbox' });
		expect(eventPropertyControl({ type: 'text' })).toEqual({ kind: 'text' });
		expect(eventPropertyControl({ type: 'number' })).toEqual({ kind: 'number' });
		expect(eventPropertyControl(undefined)).toEqual({ kind: 'inferred' });
	});
});
