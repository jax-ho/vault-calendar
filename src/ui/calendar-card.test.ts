import { afterEach, describe, expect, it, vi } from 'vitest';

const obsidianMocks = vi.hoisted(() => ({ setIcon: vi.fn() }));

vi.mock('obsidian', () => ({ setIcon: obsidianMocks.setIcon }));

import type { CalendarItem } from '../types';
import {
	calendarRelationshipAccessibleSummary,
	calendarRelationshipRowCount,
	renderCardRelationships,
} from './calendar-card';

interface ElementOptions {
	cls?: string;
	text?: string;
}

class MockElement {
	readonly attributes = new Map<string, string>();
	readonly children: MockElement[] = [];
	readonly classes = new Set<string>();
	readonly dataset: Record<string, string> = {};
	readonly text: string;

	constructor(options?: ElementOptions) {
		this.text = options?.text ?? '';
		for (const className of options?.cls?.split(/\s+/u) ?? []) {
			if (className) this.classes.add(className);
		}
	}

	addClass(className: string): void {
		this.classes.add(className);
	}

	createDiv(options?: ElementOptions): MockElement {
		return this.create(options);
	}

	createSpan(options?: ElementOptions): MockElement {
		return this.create(options);
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}

	private create(options?: ElementOptions): MockElement {
		const child = new MockElement(options);
		this.children.push(child);
		return child;
	}
}

function item(
	parentItem?: { path: string; title: string },
	subItems: Array<{ path: string; title: string }> = [],
): CalendarItem {
	return {
		path: 'Tasks/Current.md',
		title: 'Current',
		start: '2026-08-31',
		startTimeSort: 0,
		allDay: true,
		properties: {},
		mtime: 1,
		parentItem,
		subItems,
	};
}

function childWithClass(root: MockElement, className: string): MockElement | undefined {
	return root.children.find((child) => child.classes.has(className));
}

describe('calendar card relationships', () => {
	afterEach(() => vi.clearAllMocks());

	it('summarizes relationship rows for assistive output and layout', () => {
		expect(calendarRelationshipRowCount(item())).toBe(0);
		expect(calendarRelationshipAccessibleSummary(item())).toBe('');

		const related = item(
			{ path: 'Tasks/Parent.md', title: 'Parent' },
			[
				{ path: 'Tasks/Child A.md', title: 'Child A' },
				{ path: 'Tasks/Child B.md', title: 'Child B' },
			],
		);
		expect(calendarRelationshipRowCount(related)).toBe(2);
		expect(calendarRelationshipAccessibleSummary(related)).toBe(
			'Parent item: Parent, 2 sub-items',
		);
	});

	it('renders passive parent and derived sub-item rows', () => {
		const card = new MockElement();
		renderCardRelationships(
			card as unknown as HTMLElement,
			item(
				{ path: 'Tasks/Parent.md', title: 'Parent' },
				[{ path: 'Tasks/Child.md', title: 'Child' }],
			),
		);

		expect(card.classes).toEqual(new Set(['has-parent', 'has-sub-items']));
		const relationships = childWithClass(card, 'cv-card-relationships');
		expect(relationships?.children).toHaveLength(2);
		const parent = relationships?.children[0];
		const subItems = relationships?.children[1];
		expect(parent?.dataset.path).toBe('Tasks/Parent.md');
		expect(parent?.children[1]?.text).toBe('Parent: Parent');
		expect(subItems?.dataset.count).toBe('1');
		expect(subItems?.children[1]?.text).toBe('1 sub-item');
		expect(obsidianMocks.setIcon).toHaveBeenNthCalledWith(1, parent?.children[0], 'corner-down-right');
		expect(obsidianMocks.setIcon).toHaveBeenNthCalledWith(2, subItems?.children[0], 'list-tree');
		expect(parent?.children[0]?.attributes.get('aria-hidden')).toBe('true');
	});

	it('does not add empty relationship markup', () => {
		const card = new MockElement();
		renderCardRelationships(card as unknown as HTMLElement, item());

		expect(card.children).toHaveLength(0);
		expect(obsidianMocks.setIcon).not.toHaveBeenCalled();
	});
});
