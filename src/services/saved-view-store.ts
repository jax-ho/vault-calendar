import { parseCalendarConfig } from '../domain/config';
import {
	applySavedViewCatalogToFrontmatter,
	isValidViewId,
	isWritableBoardGroupProperty,
	validSavedViews,
} from '../domain/saved-views';
import type {
	CalendarLayout,
	SavedView,
	SavedViewCatalog,
	ViewId,
	WeekStartsOn,
} from '../types';
import { CalendarConfigMutationCoordinator } from './calendar-config-mutation-coordinator';

export interface SavedViewDocument {
	path: string;
}

export interface SavedViewStorePort<TFile extends SavedViewDocument> {
	getFileByPath(path: string): TFile | null;
	processFrontMatter(
		file: TFile,
		mutate: (frontmatter: Record<string, unknown>) => void,
	): Promise<void>;
}

export type SavedViewCommand =
	| { kind: 'add'; view: SavedView }
	| { kind: 'rename'; viewId: ViewId; name: string }
	| {
			kind: 'configure-calendar';
			viewId: ViewId;
			layout: CalendarLayout;
			weekStartsOn: WeekStartsOn;
	  }
	| { kind: 'configure-board'; viewId: ViewId; groupBy?: string }
	| { kind: 'remove'; viewId: ViewId };

export class SavedViewMutationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SavedViewMutationError';
	}
}

function normalizedName(name: string): string {
	return name.trim().toLocaleLowerCase();
}

function entryId(entry: SavedViewCatalog['entries'][number]): string | undefined {
	return entry.kind === 'valid' ? entry.definition.id : entry.id;
}

function entryName(entry: SavedViewCatalog['entries'][number]): string | undefined {
	return entry.kind === 'valid' ? entry.definition.name : entry.name;
}

function assertUniqueName(
	catalog: SavedViewCatalog,
	name: string,
	exceptViewId?: ViewId,
): string {
	const trimmed = name.trim();
	if (!trimmed) throw new SavedViewMutationError('Enter a view name.');
	const candidate = normalizedName(trimmed);
	const conflict = catalog.entries.some((entry) => {
		if (entryId(entry) === exceptViewId) return false;
		const existingName = entryName(entry);
		return existingName !== undefined && normalizedName(existingName) === candidate;
	});
	if (conflict) {
		throw new SavedViewMutationError(`A view named “${trimmed}” already exists.`);
	}
	return trimmed;
}

function assertCatalogCanMutate(catalog: SavedViewCatalog): void {
	if (!catalog.canMutate) {
		throw new SavedViewMutationError(
			'The saved-view configuration needs to be repaired in the source document first.',
		);
	}
}

function applyCommand(
	catalog: SavedViewCatalog,
	command: SavedViewCommand,
	config: NonNullable<ReturnType<typeof parseCalendarConfig>['config']>,
): SavedViewCatalog {
	assertCatalogCanMutate(catalog);
	const entries = structuredClone(catalog.entries);

	if (command.kind === 'add') {
		if (!isValidViewId(command.view.id)) {
			throw new SavedViewMutationError('The new view ID is invalid.');
		}
		if (entries.some((entry) => entryId(entry) === command.view.id)) {
			throw new SavedViewMutationError('The new view ID already exists.');
		}
		const name = assertUniqueName(catalog, command.view.name);
		if (
			command.view.type === 'board' &&
			(!command.view.groupBy ||
				!isWritableBoardGroupProperty(config, command.view.groupBy))
		) {
			throw new SavedViewMutationError('Choose a writable Select property for the Board.');
		}
		entries.push({
			kind: 'valid',
			definition: { ...command.view, name },
		});
		return { source: 'canonical', entries, canMutate: true };
	}

	const index = entries.findIndex((entry) => entryId(entry) === command.viewId);
	if (index < 0) {
		throw new SavedViewMutationError('The view no longer exists. Refresh and try again.');
	}
	const entry = entries[index];
	if (!entry || entry.kind !== 'valid') {
		throw new SavedViewMutationError('This unavailable view cannot be changed here.');
	}

	if (command.kind === 'remove') {
		if (validSavedViews(catalog).length <= 1) {
			throw new SavedViewMutationError('A calendar must keep at least one view.');
		}
		entries.splice(index, 1);
		return { source: 'canonical', entries, canMutate: true };
	}

	if (command.kind === 'rename') {
		const name = assertUniqueName(catalog, command.name, command.viewId);
		entries[index] = {
			kind: 'valid',
			definition: { ...entry.definition, name },
		};
		return { source: 'canonical', entries, canMutate: true };
	}

	if (command.kind === 'configure-calendar') {
		if (entry.definition.type !== 'calendar') {
			throw new SavedViewMutationError('The selected view is not a Calendar view.');
		}
		entries[index] = {
			kind: 'valid',
			definition: {
				...entry.definition,
				layout: command.layout,
				weekStartsOn: command.weekStartsOn,
			},
		};
		return { source: 'canonical', entries, canMutate: true };
	}

	if (entry.definition.type !== 'board') {
		throw new SavedViewMutationError('The selected view is not a Board view.');
	}
	if (
		command.groupBy !== undefined &&
		!isWritableBoardGroupProperty(config, command.groupBy)
	) {
		throw new SavedViewMutationError('Choose a writable Select property for the Board.');
	}
	entries[index] = {
		kind: 'valid',
		definition: { ...entry.definition, groupBy: command.groupBy },
	};
	return { source: 'canonical', entries, canMutate: true };
}

export class SavedViewStore<TFile extends SavedViewDocument> {
	constructor(
		private readonly port: SavedViewStorePort<TFile>,
		private readonly coordinator: CalendarConfigMutationCoordinator,
	) {}

	async commit(
		documentPath: string,
		command: SavedViewCommand,
	): Promise<SavedViewCatalog> {
		return this.coordinator.run(documentPath, async () => {
			const file = this.port.getFileByPath(documentPath);
			if (!file) {
				throw new SavedViewMutationError(`Calendar document not found: ${documentPath}`);
			}

			let committed: SavedViewCatalog | undefined;
			await this.port.processFrontMatter(file, (frontmatter) => {
				const parsed = parseCalendarConfig(documentPath, frontmatter);
				if (!parsed.config) {
					throw new SavedViewMutationError(
						'The calendar configuration needs to be repaired before changing views.',
					);
				}
				const current = parsed.config.viewCatalog;
				if (!current) {
					throw new SavedViewMutationError(
						'The calendar did not provide a saved-view catalog.',
					);
				}
				const next = applyCommand(current, command, parsed.config);
				if (!applySavedViewCatalogToFrontmatter(frontmatter, next)) {
					throw new SavedViewMutationError(
						'The saved-view configuration could not be written safely.',
					);
				}
				const reparsed = parseCalendarConfig(documentPath, frontmatter);
				if (!reparsed.config?.viewCatalog) {
					throw new SavedViewMutationError(
						'The saved-view configuration could not be verified after writing.',
					);
				}
				committed = structuredClone(reparsed.config.viewCatalog);
			});

			if (!committed) {
				throw new SavedViewMutationError('The saved-view update did not complete.');
			}
			return committed;
		});
	}
}
