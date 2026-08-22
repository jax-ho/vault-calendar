import { describe, expect, it } from 'vitest';
import {
	applyEventEditDraft,
	createEventEditDraft,
	type EventFieldMapping,
} from './event-edit';

const mapping: EventFieldMapping = {
	startDateProperty: 'date',
	endDateProperty: 'date-end',
	visibleProperties: ['status', 'important'],
	propertyDefinitions: {
		status: { type: 'select', options: ['Not started', 'Done'] },
		important: { type: 'checkbox' },
	},
};

describe('event edit draft', () => {
	it('loads configured fields and keeps the Markdown body separate', () => {
		const draft = createEventEditDraft(
			{
				title: 'Launch',
				date: '2026-08-20T09:30:00+08:00',
				'date-end': '2026-08-22',
				status: 'Done',
				important: true,
			},
			'Body text',
			mapping,
			{ title: 'Fallback', start: '2026-08-01' },
		);

		expect(draft).toEqual({
			title: 'Launch',
			start: '2026-08-20',
			end: '2026-08-22',
			properties: { status: 'Done', important: true },
			body: 'Body text',
		});
	});

	it('uses schema defaults when an event has no stored value', () => {
		const draft = createEventEditDraft(
			{ title: 'Launch', date: '2026-08-20' },
			'',
			{
				...mapping,
				propertyDefinitions: {
					status: { type: 'select', options: ['Not started', 'Done'], default: 'Not started' },
					important: { type: 'checkbox', default: false },
				},
			},
			{ title: 'Fallback', start: '2026-08-01' },
		);

		expect(draft.properties).toEqual({ status: 'Not started', important: false });
	});

	it('resolves a deleted select option to None and persists None on the next save', () => {
		const frontmatter: Record<string, unknown> = {
			title: 'Launch',
			date: '2026-08-20',
			status: 'Removed',
		};
		const draft = createEventEditDraft(
			frontmatter,
			'',
			mapping,
			{ title: 'Fallback', start: '2026-08-01' },
		);

		expect(draft.properties.status).toBe('None');
		expect(frontmatter.status).toBe('Removed');
		applyEventEditDraft(frontmatter, draft, mapping);
		expect(frontmatter.status).toBe('None');
	});

	it('includes schema fields in the editor even when they are not shown on cards', () => {
		const draft = createEventEditDraft(
			{ title: 'Launch', date: '2026-08-20', effort: 3 },
			'',
			{
				...mapping,
				propertyDefinitions: {
					...mapping.propertyDefinitions,
					effort: { type: 'number' },
				},
			},
			{ title: 'Fallback', start: '2026-08-01' },
		);

		expect(draft.properties).toEqual({ status: 'None', important: undefined, effort: 3 });
	});

	it('updates only configured fields and preserves authored start times', () => {
		const frontmatter: Record<string, unknown> = {
			title: 'Launch',
			date: '2026-08-20T09:30:00+08:00',
			status: 'In progress',
			keep: { nested: true },
		};

		applyEventEditDraft(
			frontmatter,
			{
				title: 'Launch review',
				start: '2026-08-21',
				end: '2026-08-23',
				properties: { status: 'Done', important: false },
				body: 'Updated body',
			},
			mapping,
		);

		expect(frontmatter).toEqual({
			title: 'Launch review',
			date: '2026-08-21T09:30:00+08:00',
			'date-end': '2026-08-23T09:30:00+08:00',
			status: 'Done',
			important: false,
			keep: { nested: true },
		});
	});

	it('persists None as a real select value', () => {
		const frontmatter: Record<string, unknown> = {
			title: 'Launch',
			date: '2026-08-20',
			status: 'Done',
		};

		applyEventEditDraft(
			frontmatter,
			{
				title: 'Launch',
				start: '2026-08-20',
				end: '',
				properties: { status: 'None', important: false },
				body: '',
			},
			mapping,
		);

		expect(frontmatter.status).toBe('None');
	});

	it('rejects an invalid range without mutating frontmatter', () => {
		const frontmatter: Record<string, unknown> = {
			title: 'Launch',
			date: '2026-08-20',
		};

		expect(() =>
			applyEventEditDraft(
				frontmatter,
				{
					title: 'Launch',
					start: '2026-08-22',
					end: '2026-08-21',
					properties: {},
					body: '',
				},
				mapping,
			),
		).toThrow('End date cannot be earlier than start date.');
		expect(frontmatter).toEqual({ title: 'Launch', date: '2026-08-20' });
	});
});
