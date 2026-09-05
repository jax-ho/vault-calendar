import { eventDisplayTitle } from './event-title';

export interface ItemRelationSeed {
	path: string;
	title: string;
	rawParent: unknown;
}

export type ResolveItemLink = (
	linkPath: string,
	sourcePath: string,
) => string | undefined;

interface ParentLinkDetails {
	raw: string;
	linkPath: string;
}

export type ParentItemRelation =
	| { state: 'none' }
	| ({ state: 'resolved'; path: string } & ParentLinkDetails)
	| ({ state: 'outside'; path: string } & ParentLinkDetails)
	| ({ state: 'unresolved' } & ParentLinkDetails)
	| { state: 'invalid'; reason: 'malformed'; raw: unknown }
	| ({ state: 'invalid'; reason: 'self' | 'cycle'; path: string } & ParentLinkDetails);

export interface ItemRelationNode {
	path: string;
	title: string;
	parent: ParentItemRelation;
	subItemPaths: readonly string[];
}

export interface ParentItemCandidate {
	path: string;
	title: string;
}

export type ParentSelectionValidation =
	| { ok: true }
	| { ok: false; reason: 'unknown' | 'self' | 'cycle' };

export interface ItemRelationGraph {
	readonly nodes: ReadonlyMap<string, ItemRelationNode>;
	parentCandidatesFor(childPath: string): readonly ParentItemCandidate[];
	validateParent(
		childPath: string,
		parentPath?: string,
	): ParentSelectionValidation;
}

const ITEM_LINK_PATTERN = /^\[\[([^\]\r\n|#]+?)(?:\|([^\]\r\n|]+))?\]\]$/u;

type ParsedParent =
	| { kind: 'none' }
	| { kind: 'invalid'; raw: unknown }
	| ({ kind: 'link' } & ParentLinkDetails);

function parseParent(value: unknown): ParsedParent {
	if (value === undefined || value === null || value === '') return { kind: 'none' };
	if (typeof value !== 'string') return { kind: 'invalid', raw: value };
	const raw = value.trim();
	if (!raw) return { kind: 'none' };
	const match = ITEM_LINK_PATTERN.exec(raw);
	const linkPath = match?.[1]?.trim();
	const alias = match?.[2];
	if (
		!linkPath ||
		linkPath.includes('[') ||
		(alias !== undefined && (!alias.trim() || alias.includes('[')))
	) {
		return { kind: 'invalid', raw: value };
	}
	return { kind: 'link', raw, linkPath };
}

export function normalizeParentItemLink(value: unknown): string | undefined {
	const parsed = parseParent(value);
	if (parsed.kind === 'none') return undefined;
	if (parsed.kind === 'invalid') {
		throw new Error('Parent item must be one Obsidian wikilink.');
	}
	return parsed.raw;
}

export function parentItemLinkPath(value: unknown): string | undefined {
	const parsed = parseParent(value);
	if (parsed.kind === 'none') return undefined;
	if (parsed.kind === 'invalid') {
		throw new Error('Parent item must be one Obsidian wikilink.');
	}
	return parsed.linkPath;
}

function compareIdentity(
	left: Pick<ItemRelationSeed, 'path' | 'title'>,
	right: Pick<ItemRelationSeed, 'path' | 'title'>,
): number {
	const titleOrder = eventDisplayTitle(left.title).localeCompare(
		eventDisplayTitle(right.title),
		undefined,
		{
			numeric: true,
			sensitivity: 'base',
		},
	);
	if (titleOrder !== 0) return titleOrder;
	return left.path.localeCompare(right.path, undefined, {
		numeric: true,
		sensitivity: 'base',
	});
}

function pathsInCycles(parentByChild: ReadonlyMap<string, string>): Set<string> {
	const completed = new Set<string>();
	const cycles = new Set<string>();

	for (const start of parentByChild.keys()) {
		if (completed.has(start)) continue;
		const walk: string[] = [];
		const walkIndexes = new Map<string, number>();
		let current: string | undefined = start;

		while (
			current !== undefined &&
			parentByChild.has(current) &&
			!completed.has(current) &&
			!walkIndexes.has(current)
		) {
			walkIndexes.set(current, walk.length);
			walk.push(current);
			current = parentByChild.get(current);
		}

		if (current !== undefined) {
			const cycleStart = walkIndexes.get(current);
			if (cycleStart !== undefined) {
				for (const path of walk.slice(cycleStart)) cycles.add(path);
			}
		}
		for (const path of walk) completed.add(path);
	}

	return cycles;
}

function reverseEdges(parentByChild: ReadonlyMap<string, string>): Map<string, Set<string>> {
	const childrenByParent = new Map<string, Set<string>>();
	for (const [childPath, parentPath] of parentByChild) {
		const children = childrenByParent.get(parentPath) ?? new Set<string>();
		children.add(childPath);
		childrenByParent.set(parentPath, children);
	}
	return childrenByParent;
}

class ResolvedItemRelationGraph implements ItemRelationGraph {
	constructor(
		readonly nodes: ReadonlyMap<string, ItemRelationNode>,
		private readonly identities: readonly ParentItemCandidate[],
		private readonly tentativeChildrenByParent: ReadonlyMap<string, ReadonlySet<string>>,
	) {}

	parentCandidatesFor(childPath: string): readonly ParentItemCandidate[] {
		if (!this.nodes.has(childPath)) return [];
		const excluded = this.selfAndDescendants(childPath);
		return this.identities.filter((candidate) => !excluded.has(candidate.path));
	}

	validateParent(
		childPath: string,
		parentPath?: string,
	): ParentSelectionValidation {
		if (!this.nodes.has(childPath)) return { ok: false, reason: 'unknown' };
		if (parentPath === undefined) return { ok: true };
		if (!this.nodes.has(parentPath)) return { ok: false, reason: 'unknown' };
		if (childPath === parentPath) return { ok: false, reason: 'self' };
		if (this.selfAndDescendants(childPath).has(parentPath)) {
			return { ok: false, reason: 'cycle' };
		}
		return { ok: true };
	}

	private selfAndDescendants(path: string): Set<string> {
		const result = new Set<string>([path]);
		const pending = [path];
		while (pending.length > 0) {
			const parentPath = pending.pop();
			if (!parentPath) continue;
			for (const childPath of this.tentativeChildrenByParent.get(parentPath) ?? []) {
				if (result.has(childPath)) continue;
				result.add(childPath);
				pending.push(childPath);
			}
		}
		return result;
	}
}

export function buildItemRelationGraph(
	seeds: readonly ItemRelationSeed[],
	resolveLink: ResolveItemLink,
): ItemRelationGraph {
	const sortedSeeds = [...seeds].sort(compareIdentity);
	const seedsByPath = new Map<string, ItemRelationSeed>();
	for (const seed of sortedSeeds) {
		if (seedsByPath.has(seed.path)) {
			throw new Error(`Duplicate item relation path: ${seed.path}`);
		}
		seedsByPath.set(seed.path, seed);
	}

	const parents = new Map<string, ParentItemRelation>();
	const tentativeParentByChild = new Map<string, string>();
	for (const seed of sortedSeeds) {
		const parsed = parseParent(seed.rawParent);
		if (parsed.kind === 'none') {
			parents.set(seed.path, { state: 'none' });
			continue;
		}
		if (parsed.kind === 'invalid') {
			parents.set(seed.path, {
				state: 'invalid',
				reason: 'malformed',
				raw: parsed.raw,
			});
			continue;
		}

		let targetPath: string | undefined;
		try {
			targetPath = resolveLink(parsed.linkPath, seed.path);
		} catch {
			targetPath = undefined;
		}
		if (!targetPath) {
			parents.set(seed.path, {
				state: 'unresolved',
				raw: parsed.raw,
				linkPath: parsed.linkPath,
			});
			continue;
		}
		if (targetPath === seed.path) {
			parents.set(seed.path, {
				state: 'invalid',
				reason: 'self',
				raw: parsed.raw,
				linkPath: parsed.linkPath,
				path: targetPath,
			});
			continue;
		}
		if (!seedsByPath.has(targetPath)) {
			parents.set(seed.path, {
				state: 'outside',
				raw: parsed.raw,
				linkPath: parsed.linkPath,
				path: targetPath,
			});
			continue;
		}

		parents.set(seed.path, {
			state: 'resolved',
			raw: parsed.raw,
			linkPath: parsed.linkPath,
			path: targetPath,
		});
		tentativeParentByChild.set(seed.path, targetPath);
	}

	const cyclePaths = pathsInCycles(tentativeParentByChild);
	for (const path of cyclePaths) {
		const parent = parents.get(path);
		if (parent?.state !== 'resolved') continue;
		parents.set(path, {
			...parent,
			state: 'invalid',
			reason: 'cycle',
		});
	}

	const activeParentByChild = new Map<string, string>();
	for (const [path, parent] of parents) {
		if (parent.state === 'resolved') activeParentByChild.set(path, parent.path);
	}
	const activeChildrenByParent = reverseEdges(activeParentByChild);
	const tentativeChildrenByParent = reverseEdges(tentativeParentByChild);

	const nodes = new Map<string, ItemRelationNode>();
	for (const seed of sortedSeeds) {
		const parent = parents.get(seed.path) ?? { state: 'none' as const };
		const childPaths = [...(activeChildrenByParent.get(seed.path) ?? [])]
			.map((path) => seedsByPath.get(path))
			.filter((child): child is ItemRelationSeed => child !== undefined)
			.sort(compareIdentity)
			.map((child) => child.path);
		nodes.set(seed.path, {
			path: seed.path,
			title: seed.title,
			parent,
			subItemPaths: childPaths,
		});
	}

	const identities = sortedSeeds.map(({ path, title }) => ({ path, title }));
	return new ResolvedItemRelationGraph(
		nodes,
		identities,
		tentativeChildrenByParent,
	);
}
