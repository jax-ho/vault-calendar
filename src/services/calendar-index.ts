import type { App, CachedMetadata } from 'obsidian';
import {
	isCalendarDocumentPath,
} from '../domain/config';
import { projectCalendarFile, sortCalendarItems } from '../domain/projection';
import { isPathInCalendarSource } from '../domain/source-scope';
import type {
	CalendarConfig,
	CalendarIndexSnapshot,
	CalendarItem,
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
}

export function createObsidianCalendarIndexPort(app: App): CalendarIndexPort {
	return {
		configDirectory: app.vault.configDir,
		getMarkdownFiles: () => app.vault.getMarkdownFiles(),
		getFrontmatter: (file) => {
			const vaultFile = app.vault.getFileByPath(file.path);
			return vaultFile ? app.metadataCache.getFileCache(vaultFile)?.frontmatter : undefined;
		},
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
		this.items = new Map<string, CalendarItem>();
		this.issues = new Map<string, ProjectionIssue>();
		this.candidatePaths = new Set<string>();
		try {
			for (const file of this.port.getMarkdownFiles()) this.project(file);
			this.built = true;
			this.emit();
		} catch (error) {
			this.items = previousItems;
			this.issues = previousIssues;
			this.candidatePaths = previousCandidates;
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
		if (notify) this.emit();
	}

	renameFile(file: CalendarIndexFile, oldPath: string): void {
		this.remove(oldPath, false);
		this.remove(file.path, false);
		this.project(file);
		this.emit();
	}

	subscribe(subscriber: Subscriber): () => void {
		this.subscribers.add(subscriber);
		subscriber(this.snapshot());
		return () => this.subscribers.delete(subscriber);
	}

	snapshot(): CalendarIndexSnapshot {
		return {
			items: sortCalendarItems([...this.items.values()]),
			issues: [...this.issues.values()].sort((left, right) => left.path.localeCompare(right.path)),
			indexedCount: this.candidatePaths.size,
		};
	}

	private project(file: CalendarIndexFile): void {
		if (!isPathInCalendarSource(file.path, this.config, this.port.configDirectory)) return;
		if (isCalendarDocumentPath(file.path)) return;
		const frontmatter = this.port.getFrontmatter(file);
		this.candidatePaths.add(file.path);
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

	renameCalendar(oldPath: string, newPath: string): void {
		const managed = this.indexes.get(oldPath);
		if (!managed) return;
		this.indexes.delete(oldPath);
		managed.index.renameCalendarDocument(newPath);
		this.indexes.set(newPath, managed);
	}
}
