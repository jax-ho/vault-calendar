import type { App, CachedMetadata } from 'obsidian';
import {
	isCalendarDocumentPath,
} from '../domain/config';
import {
	buildItemRelationGraph,
	parentItemLinkPath,
	type ItemRelationGraph,
	type ItemRelationSeed,
} from '../domain/item-relations';
import {
	calendarItemTitle,
	projectCalendarFile,
	sortCalendarItems,
} from '../domain/projection';
import { EVENT_PARENT_ITEM_PROPERTY, EVENT_TITLE_PROPERTY } from '../domain/reserved-properties';
import { isPathInCalendarSource } from '../domain/source-scope';
import type {
	CalendarConfig,
	CalendarIndexSnapshot,
	CalendarItem,
	CalendarItemReference,
	ProjectionIssue,
} from '../types';

type Subscriber = (snapshot: CalendarIndexSnapshot) => void;

export interface CalendarIndexFile {
	path: string;
	basename: string;
	stat: { mtime: number };
}

export interface CalendarIndexPort {
	configDirectory: string;
	getMarkdownFiles(): CalendarIndexFile[];
	getFrontmatter(file: CalendarIndexFile): Record<string, unknown> | undefined;
	resolveLink?(linkPath: string, sourcePath: string): string | undefined;
}

export function createObsidianCalendarIndexPort(app: App): CalendarIndexPort {
	return {
		configDirectory: app.vault.configDir,
		getMarkdownFiles: () => app.vault.getMarkdownFiles(),
		getFrontmatter: (file) => {
			const vaultFile = app.vault.getFileByPath(file.path);
			return vaultFile ? app.metadataCache.getFileCache(vaultFile)?.frontmatter : undefined;
		},
		resolveLink: (linkPath, sourcePath) =>
			app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath)?.path,
	};
}

function indexingSignature(config: CalendarConfig): string {
	return JSON.stringify({
		documentPath: config.documentPath,
		sourceFolder: config.sourceFolder,
		recursive: config.recursive,
		startDateProperty: config.startDateProperty,
		endDateProperty: config.endDateProperty,
		excludePaths: config.excludePaths,
		propertyDefinitions: config.propertyDefinitions,
		cardColorProperty: config.cardColorProperty,
	});
}

export class CalendarIndex {
	private items = new Map<string, CalendarItem>();
	private issues = new Map<string, ProjectionIssue>();
	private candidatePaths = new Set<string>();
	private relationSeeds = new Map<string, ItemRelationSeed>();
	private relationGraphCache?: ItemRelationGraph;
	private subscribers = new Set<Subscriber>();
	private built = false;

	constructor(
		private readonly port: CalendarIndexPort,
		private config: CalendarConfig,
	) {}

	async build(): Promise<void> {
		const previousItems = this.items;
		const previousIssues = this.issues;
		const previousCandidates = this.candidatePaths;
		const previousRelationSeeds = this.relationSeeds;
		const previousRelationGraph = this.relationGraphCache;
		this.items = new Map<string, CalendarItem>();
		this.issues = new Map<string, ProjectionIssue>();
		this.candidatePaths = new Set<string>();
		this.relationSeeds = new Map<string, ItemRelationSeed>();
		this.relationGraphCache = undefined;
		try {
			for (const file of this.port.getMarkdownFiles()) this.project(file);
			this.built = true;
			this.emit();
		} catch (error) {
			this.items = previousItems;
			this.issues = previousIssues;
			this.candidatePaths = previousCandidates;
			this.relationSeeds = previousRelationSeeds;
			this.relationGraphCache = previousRelationGraph;
			throw error;
		}
	}

	async setConfig(config: CalendarConfig): Promise<void> {
		const needsRebuild = indexingSignature(config) !== indexingSignature(this.config);
		if (needsRebuild || !this.built) {
			const previousConfig = this.config;
			this.config = config;
			try {
				await this.build();
			} catch (error) {
				this.config = previousConfig;
				throw error;
			}
		} else {
			this.config = config;
			this.emit();
		}
	}

	renameCalendarDocument(newPath: string): void {
		this.config = { ...this.config, documentPath: newPath };
		this.items.delete(newPath);
		this.issues.delete(newPath);
		this.relationSeeds.delete(newPath);
		this.relationGraphCache = undefined;
	}

	updateFile(file: CalendarIndexFile): void {
		this.remove(file.path, false);
		this.project(file);
		this.emit();
	}

	remove(path: string, notify = true): void {
		this.items.delete(path);
		this.issues.delete(path);
		this.candidatePaths.delete(path);
		this.relationSeeds.delete(path);
		this.relationGraphCache = undefined;
		if (notify) this.emit();
	}

	renameFile(file: CalendarIndexFile, oldPath: string): void {
		this.remove(oldPath, false);
		this.remove(file.path, false);
		this.project(file);
		this.emit();
	}

	refreshItemRelations(): void {
		this.relationGraphCache = undefined;
		this.emit();
	}

	subscribe(subscriber: Subscriber): () => void {
		this.subscribers.add(subscriber);
		subscriber(this.snapshot());
		return () => this.subscribers.delete(subscriber);
	}

	snapshot(): CalendarIndexSnapshot {
		const graph = this.itemRelationGraph();
		return {
			items: sortCalendarItems(
				[...this.items.values()].map((item) =>
					this.withItemRelations(item, graph),
				),
			),
			issues: [
				...this.issues.values(),
				...this.itemRelationIssues(graph),
			].sort((left, right) => {
				const pathOrder = left.path.localeCompare(right.path);
				return pathOrder !== 0 ? pathOrder : left.kind.localeCompare(right.kind);
			}),
			indexedCount: this.candidatePaths.size,
		};
	}

	parentCandidatesFor(itemPath?: string): CalendarItemReference[] {
		const graph = this.itemRelationGraph();
		if (itemPath) return [...graph.parentCandidatesFor(itemPath)];
		return [...graph.nodes.values()].map(({ path, title }) => ({ path, title }));
	}

	validateParentItem(itemPath: string, value: unknown): void {
		const linkPath = parentItemLinkPath(value);
		if (!linkPath) return;
		const parentPath = this.port.resolveLink?.(linkPath, itemPath);
		if (!parentPath) return;
		const graph = this.itemRelationGraph();
		if (!graph.nodes.has(parentPath)) return;
		const validation = graph.validateParent(itemPath, parentPath);
		if (validation.ok) return;
		if (validation.reason === 'self') {
			throw new Error('An item cannot be its own parent.');
		}
		if (validation.reason === 'cycle') {
			throw new Error('A parent item cannot be one of its sub-items.');
		}
		throw new Error('The item relationship changed. Reopen the editor and try again.');
	}

	private project(file: CalendarIndexFile): void {
		if (!isPathInCalendarSource(file.path, this.config, this.port.configDirectory)) return;
		if (isCalendarDocumentPath(file.path)) return;
		const frontmatter = this.port.getFrontmatter(file);
		this.candidatePaths.add(file.path);
		this.relationSeeds.set(file.path, {
			path: file.path,
			title: calendarItemTitle(
				frontmatter?.[EVENT_TITLE_PROPERTY],
				file.basename,
			),
			rawParent: frontmatter?.[EVENT_PARENT_ITEM_PROPERTY],
		});
		this.relationGraphCache = undefined;
		try {
			const result = projectCalendarFile(
				{
					path: file.path,
					basename: file.basename,
					mtime: file.stat.mtime,
					frontmatter,
				},
				this.config,
			);
			if (result.item) this.items.set(file.path, result.item);
			if (result.issue) this.issues.set(file.path, result.issue);
		} catch (error) {
			this.issues.set(file.path, {
				path: file.path,
				kind: 'parse-error',
				message: error instanceof Error ? error.message : 'Unable to parse metadata.',
			});
		}
	}

	private itemRelationGraph(): ItemRelationGraph {
		this.relationGraphCache ??= buildItemRelationGraph(
			[...this.relationSeeds.values()],
			(linkPath, sourcePath) => this.port.resolveLink?.(linkPath, sourcePath),
		);
		return this.relationGraphCache;
	}

	private itemRelationIssues(graph: ItemRelationGraph): ProjectionIssue[] {
		const issues: ProjectionIssue[] = [];
		for (const node of graph.nodes.values()) {
			if (node.parent.state !== 'invalid') continue;
			let message: string;
			switch (node.parent.reason) {
				case 'malformed':
					message = 'Parent item must be one Obsidian wikilink.';
					break;
				case 'self':
					message = 'An item cannot be its own parent.';
					break;
				case 'cycle':
					message = 'Parent item relationships cannot form a cycle.';
			}
			issues.push({
				path: node.path,
				kind: 'invalid-parent-item',
				message,
			});
		}
		return issues;
	}

	private withItemRelations(
		item: CalendarItem,
		graph: ItemRelationGraph,
	): CalendarItem {
		const node = graph.nodes.get(item.path);
		if (!node) return { ...item, subItems: [] };
		const subItems = node.subItemPaths.map((path) =>
			this.itemReference(path, graph),
		);
		const result: CalendarItem = { ...item, subItems };
		if (node.parent.state === 'resolved') {
			result.parentItem = this.itemReference(node.parent.path, graph);
		} else if (node.parent.state === 'outside') {
			result.parentItem = {
				path: node.parent.path,
				title: this.linkTitle(node.parent.linkPath),
			};
		}
		return result;
	}

	private itemReference(
		path: string,
		graph: ItemRelationGraph,
	): CalendarItemReference {
		const node = graph.nodes.get(path);
		return { path, title: node?.title ?? this.linkTitle(path) };
	}

	private linkTitle(path: string): string {
		return path.split('/').at(-1)?.replace(/\.md$/u, '') || path;
	}

	private emit(): void {
		const snapshot = this.snapshot();
		for (const subscriber of this.subscribers) subscriber(snapshot);
	}
}

export function isCalendarDocument(path: string, cache: CachedMetadata | null): boolean {
	return isCalendarDocumentPath(path) && cache?.frontmatter?.['calendar-view'] === true;
}

interface ManagedIndex {
	index: CalendarIndex;
	references: number;
}

export class CalendarIndexManager {
	private indexes = new Map<string, ManagedIndex>();

	constructor(private readonly port: CalendarIndexPort) {}

	async acquire(config: CalendarConfig): Promise<CalendarIndex> {
		const existing = this.indexes.get(config.documentPath);
		if (existing) {
			existing.references += 1;
			try {
				await existing.index.setConfig(config);
				return existing.index;
			} catch (error) {
				existing.references -= 1;
				throw error;
			}
		}
		const index = new CalendarIndex(this.port, config);
		this.indexes.set(config.documentPath, { index, references: 1 });
		try {
			await index.build();
		} catch (error) {
			this.indexes.delete(config.documentPath);
			throw error;
		}
		return index;
	}

	release(calendarPath: string): void {
		const managed = this.indexes.get(calendarPath);
		if (!managed) return;
		managed.references -= 1;
		if (managed.references <= 0) this.indexes.delete(calendarPath);
	}

	async updateConfig(config: CalendarConfig): Promise<void> {
		await this.indexes.get(config.documentPath)?.index.setConfig(config);
	}

	handleFileChanged(file: CalendarIndexFile): void {
		for (const managed of this.indexes.values()) managed.index.updateFile(file);
	}

	handleFileDeleted(path: string): void {
		for (const managed of this.indexes.values()) managed.index.remove(path);
	}

	handleFileRenamed(file: CalendarIndexFile, oldPath: string): void {
		for (const managed of this.indexes.values()) managed.index.renameFile(file, oldPath);
	}

	handleLinksResolved(): void {
		for (const managed of this.indexes.values()) {
			managed.index.refreshItemRelations();
		}
	}

	renameCalendar(oldPath: string, newPath: string): void {
		const managed = this.indexes.get(oldPath);
		if (!managed) return;
		this.indexes.delete(oldPath);
		managed.index.renameCalendarDocument(newPath);
		this.indexes.set(newPath, managed);
	}
}
