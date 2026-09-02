import { describe, expect, it } from 'vitest';
import { propertyTypeIcon, resolvedPropertyType } from './property-type-icons';

describe('property type icons', () => {
	it('maps each supported field type to one stable icon', () => {
		expect(propertyTypeIcon('date')).toBe('calendar-days');
		expect(propertyTypeIcon('select')).toBe('circle-chevron-down');
		expect(propertyTypeIcon('checkbox')).toBe('square-check-big');
		expect(propertyTypeIcon('text')).toBe('type');
		expect(propertyTypeIcon('number')).toBe('hash');
		expect(propertyTypeIcon('relation')).toBe('corner-down-right');
		expect(propertyTypeIcon('relations')).toBe('list-tree');
	});

	it('uses schema types first and infers unconfigured values', () => {
		expect(resolvedPropertyType({ type: 'select' }, true)).toBe('select');
		expect(resolvedPropertyType(undefined, false)).toBe('checkbox');
		expect(resolvedPropertyType(undefined, 3)).toBe('number');
		expect(resolvedPropertyType(undefined, 'Draft')).toBe('text');
	});
});
