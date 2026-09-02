import { describe, expect, it, vi } from 'vitest';
import {
	buildItemRelationGraph,
	normalizeParentItemLink,
	parentItemLinkPath,
	type ItemRelationSeed,
} from './item-relations';

function seed(
	path: string,
	title: string,
	rawParent?: unknown,
): ItemRelationSeed {
	return { path, title, rawParent };
}

function resolver(destinations: Record<string, string>) {
	return vi.fn((linkPath: string) => destinations[linkPath]);
}

describe('item relation graph', () => {
	it('normalizes the writable parent value and rejects other property shapes', () => {
		expect(normalizeParentItemLink('  [[Tasks/Parent|Parent]]  ')).toBe(
			'[[Tasks/Parent|Parent]]',
		);
		expect(normalizeParentItemLink('   ')).toBeUndefined();
		expect(parentItemLinkPath('[[Tasks/Parent|Parent]]')).toBe(
			'Tasks/Parent',
		);
		expect(() => normalizeParentItemLink('Tasks/Parent')).toThrow(
			'Parent item must be one Obsidian wikilink.',
		);
		expect(() => normalizeParentItemLink(['[[Tasks/Parent]]'])).toThrow(
			'Parent item must be one Obsidian wikilink.',
		);
	});

	it('uses a strict single wikilink and derives sub-items by path identity', () => {
		const resolveLink = resolver({ Parent: 'Tasks/Parent.md' });
		const graph = buildItemRelationGraph(
			[
				seed('Tasks/Parent.md', 'Parent'),
				seed('Tasks/Z.md', 'Same', '[[Parent|Project parent]]'),
				seed('Tasks/A.md', 'same', '[[Parent]]'),
				seed('Tasks/Beta.md', 'Beta', '[[Parent]]'),
			],
			resolveLink,
		);

		expect(graph.nodes.get('Tasks/Z.md')?.parent).toEqual({
			state: 'resolved',
			raw: '[[Parent|Project parent]]',
			linkPath: 'Parent',
			path: 'Tasks/Parent.md',
		});
		expect(graph.nodes.get('Tasks/Parent.md')?.subItemPaths).toEqual([
			'Tasks/Beta.md',
			'Tasks/A.md',
			'Tasks/Z.md',
		]);
		expect(resolveLink).toHaveBeenCalledWith('Parent', 'Tasks/Z.md');
	});

	it('keeps outside, unresolved, and malformed parents distinct', () => {
		const graph = buildItemRelationGraph(
			[
				seed('Tasks/Outside.md', 'Outside', '[[Elsewhere]]'),
				seed('Tasks/Missing.md', 'Missing', '[[Missing target]]'),
				seed('Tasks/Plain.md', 'Plain', 'Parent'),
				seed('Tasks/Many.md', 'Many', ['[[A]]', '[[B]]']),
				seed('Tasks/Heading.md', 'Heading', '[[Parent#Heading]]'),
			],
			resolver({ Elsewhere: 'Archive/Elsewhere.md' }),
		);

		expect(graph.nodes.get('Tasks/Outside.md')?.parent).toMatchObject({
			state: 'outside',
			path: 'Archive/Elsewhere.md',
		});
		expect(graph.nodes.get('Tasks/Missing.md')?.parent).toMatchObject({
			state: 'unresolved',
			linkPath: 'Missing target',
		});
		for (const path of ['Tasks/Plain.md', 'Tasks/Many.md', 'Tasks/Heading.md']) {
			expect(graph.nodes.get(path)?.parent).toMatchObject({
				state: 'invalid',
				reason: 'malformed',
			});
		}
	});

	it('excludes self references and every edge participating in a cycle', () => {
		const graph = buildItemRelationGraph(
			[
				seed('Tasks/Self.md', 'Self', '[[Self]]'),
				seed('Tasks/A.md', 'A', '[[B]]'),
				seed('Tasks/B.md', 'B', '[[C]]'),
				seed('Tasks/C.md', 'C', '[[A]]'),
				seed('Tasks/Incoming.md', 'Incoming', '[[A]]'),
			],
			resolver({
				Self: 'Tasks/Self.md',
				A: 'Tasks/A.md',
				B: 'Tasks/B.md',
				C: 'Tasks/C.md',
			}),
		);

		expect(graph.nodes.get('Tasks/Self.md')?.parent).toMatchObject({
			state: 'invalid',
			reason: 'self',
		});
		for (const path of ['Tasks/A.md', 'Tasks/B.md', 'Tasks/C.md']) {
			expect(graph.nodes.get(path)?.parent).toMatchObject({
				state: 'invalid',
				reason: 'cycle',
			});
		}
		expect(graph.nodes.get('Tasks/A.md')?.subItemPaths).toEqual([
			'Tasks/Incoming.md',
		]);
		expect(graph.nodes.get('Tasks/B.md')?.subItemPaths).toEqual([]);
		expect(graph.nodes.get('Tasks/C.md')?.subItemPaths).toEqual([]);
	});

	it('enumerates valid parents in stable title and path order', () => {
		const graph = buildItemRelationGraph(
			[
				seed('Tasks/Root.md', 'Root'),
				seed('Tasks/Child.md', 'Child', '[[Root]]'),
				seed('Tasks/Grandchild.md', 'Grandchild', '[[Child]]'),
				seed('Tasks/Z.md', 'Same'),
				seed('Tasks/A.md', 'same'),
			],
			resolver({ Root: 'Tasks/Root.md', Child: 'Tasks/Child.md' }),
		);

		expect(graph.parentCandidatesFor('Tasks/Root.md')).toEqual([
			{ path: 'Tasks/A.md', title: 'same' },
			{ path: 'Tasks/Z.md', title: 'Same' },
		]);
		expect(graph.parentCandidatesFor('Tasks/Child.md')).toEqual([
			{ path: 'Tasks/Root.md', title: 'Root' },
			{ path: 'Tasks/A.md', title: 'same' },
			{ path: 'Tasks/Z.md', title: 'Same' },
		]);
		expect(graph.validateParent('Tasks/Root.md', 'Tasks/Root.md')).toEqual({
			ok: false,
			reason: 'self',
		});
		expect(graph.validateParent('Tasks/Root.md', 'Tasks/Grandchild.md')).toEqual({
			ok: false,
			reason: 'cycle',
		});
		expect(graph.validateParent('Tasks/Root.md', 'Tasks/A.md')).toEqual({ ok: true });
		expect(graph.validateParent('Tasks/Root.md')).toEqual({ ok: true });
		expect(graph.validateParent('Tasks/Unknown.md', 'Tasks/A.md')).toEqual({
			ok: false,
			reason: 'unknown',
		});
	});

	it('keeps duplicate titles distinct and resolves only the selected path', () => {
		const graph = buildItemRelationGraph(
			[
				seed('Tasks/Same A.md', 'Same'),
				seed('Tasks/Same B.md', 'Same'),
				seed('Tasks/Child.md', 'Child', '[[Exact B]]'),
			],
			resolver({ 'Exact B': 'Tasks/Same B.md' }),
		);

		expect(graph.nodes.get('Tasks/Same A.md')?.subItemPaths).toEqual([]);
		expect(graph.nodes.get('Tasks/Same B.md')?.subItemPaths).toEqual([
			'Tasks/Child.md',
		]);
		expect(graph.nodes.get('Tasks/Child.md')?.parent).toMatchObject({
			state: 'resolved',
			path: 'Tasks/Same B.md',
		});
	});

	it('uses tentative cycle edges when filtering candidates from an invalid graph', () => {
		const graph = buildItemRelationGraph(
			[
				seed('Tasks/A.md', 'A', '[[B]]'),
				seed('Tasks/B.md', 'B', '[[A]]'),
				seed('Tasks/Incoming.md', 'Incoming', '[[A]]'),
				seed('Tasks/Other.md', 'Other'),
			],
			resolver({ A: 'Tasks/A.md', B: 'Tasks/B.md' }),
		);

		expect(graph.parentCandidatesFor('Tasks/A.md')).toEqual([
			{ path: 'Tasks/Other.md', title: 'Other' },
		]);
		expect(graph.validateParent('Tasks/A.md', 'Tasks/B.md')).toEqual({
			ok: false,
			reason: 'cycle',
		});
	});
});
