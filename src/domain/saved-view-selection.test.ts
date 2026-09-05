import { describe, expect, it } from 'vitest';
import type { SavedView, SavedViewCatalog } from '../types';
import {
	fallbackAfterViewRemoval,
	findSavedView,
	resolveActiveSavedView,
} from './saved-view-selection';

function calendar(id: string): SavedView {
	return {
		id,
		name: id,
		type: 'calendar',
		layout: 'month',
		weekStartsOn: 'locale',
	};
}

function catalog(ids: string[]): SavedViewCatalog {
	return {
		source: 'canonical',
		canMutate: true,
		entries: ids.map((id) => ({ kind: 'valid', definition: calendar(id) })),
	};
}

describe('saved-view selection', () => {
	it('keeps a valid preferred ID and otherwise selects the first valid view', () => {
		const value = catalog(['calendar', 'board']);
		expect(findSavedView(value, 'board')?.id).toBe('board');
		expect(resolveActiveSavedView(value, 'board')?.id).toBe('board');
		expect(resolveActiveSavedView(value, 'missing')?.id).toBe('calendar');
	});

	it('skips unavailable entries while resolving a fallback', () => {
		const value: SavedViewCatalog = {
			source: 'canonical',
			canMutate: false,
			entries: [
				{
					kind: 'unsupported',
					id: 'future',
					name: 'Timeline',
					viewType: 'timeline',
					raw: {},
				},
				{ kind: 'valid', definition: calendar('calendar') },
			],
		};
		expect(resolveActiveSavedView(value)?.id).toBe('calendar');
	});

	it('chooses the nearest valid view to the right, then to the left', () => {
		const before = catalog(['left', 'removed', 'right', 'later']);
		expect(
			fallbackAfterViewRemoval(before, 'removed', catalog(['left', 'right', 'later']))?.id,
		).toBe('right');
		expect(
			fallbackAfterViewRemoval(before, 'right', catalog(['left', 'removed']))?.id,
		).toBe('removed');
	});
});
