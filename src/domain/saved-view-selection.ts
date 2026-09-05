import type { SavedView, SavedViewCatalog, ViewId } from '../types';

function validDefinition(
	entry: SavedViewCatalog['entries'][number] | undefined,
): SavedView | undefined {
	return entry?.kind === 'valid' ? entry.definition : undefined;
}

export function findSavedView(
	catalog: SavedViewCatalog,
	viewId: ViewId | undefined,
): SavedView | undefined {
	if (!viewId) return undefined;
	return catalog.entries
		.map(validDefinition)
		.find((view) => view?.id === viewId);
}

export function resolveActiveSavedView(
	catalog: SavedViewCatalog,
	preferredViewId?: ViewId,
): SavedView | undefined {
	return (
		findSavedView(catalog, preferredViewId) ??
		catalog.entries.map(validDefinition).find((view) => view !== undefined)
	);
}

export function fallbackAfterViewRemoval(
	previousCatalog: SavedViewCatalog,
	removedViewId: ViewId,
	nextCatalog: SavedViewCatalog,
): SavedView | undefined {
	const removedIndex = previousCatalog.entries.findIndex((entry) => {
		const id = entry.kind === 'valid' ? entry.definition.id : entry.id;
		return id === removedViewId;
	});
	if (removedIndex < 0) return resolveActiveSavedView(nextCatalog);

	const nextById = new Map(
		nextCatalog.entries.flatMap((entry) =>
			entry.kind === 'valid' ? [[entry.definition.id, entry.definition] as const] : [],
		),
	);
	for (let index = removedIndex + 1; index < previousCatalog.entries.length; index += 1) {
		const entry = previousCatalog.entries[index];
		const id = entry?.kind === 'valid' ? entry.definition.id : entry?.id;
		if (id && nextById.has(id)) return nextById.get(id);
	}
	for (let index = removedIndex - 1; index >= 0; index -= 1) {
		const entry = previousCatalog.entries[index];
		const id = entry?.kind === 'valid' ? entry.definition.id : entry?.id;
		if (id && nextById.has(id)) return nextById.get(id);
	}
	return resolveActiveSavedView(nextCatalog);
}
