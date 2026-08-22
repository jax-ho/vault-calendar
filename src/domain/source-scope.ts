import type { CalendarConfig } from '../types';
import { normalizeVaultPath } from './config';

function isPathWithin(path: string, folder: string): boolean {
	return folder.length === 0 || path === folder || path.startsWith(`${folder}/`);
}

export function isBuiltInExcludedPath(path: string, configDirectory: string): boolean {
	const normalized = normalizeVaultPath(path);
	const normalizedConfigDirectory = normalizeVaultPath(configDirectory);
	if (
		normalizedConfigDirectory.length > 0 &&
		(normalized === normalizedConfigDirectory ||
			normalized.startsWith(`${normalizedConfigDirectory}/`))
	) {
		return true;
	}
	const segments = normalized.split('/');
	return segments.some((segment) => {
		const lowered = segment.toLocaleLowerCase();
		return lowered === '.trash' || lowered === 'trash';
	});
}

export function isUserExcludedPath(path: string, excludedPaths: string[]): boolean {
	const normalized = normalizeVaultPath(path);
	return excludedPaths.some((excludedPath) => {
		const normalizedExcluded = normalizeVaultPath(excludedPath);
		return normalizedExcluded.length > 0 && isPathWithin(normalized, normalizedExcluded);
	});
}

export function isPathInCalendarSource(
	path: string,
	config: CalendarConfig,
	configDirectory: string,
): boolean {
	const normalized = normalizeVaultPath(path);
	if (!normalized.toLocaleLowerCase().endsWith('.md')) return false;
	if (normalized === config.documentPath) return false;
	if (isBuiltInExcludedPath(normalized, configDirectory)) return false;
	if (isUserExcludedPath(normalized, config.excludePaths)) return false;
	if (!isPathWithin(normalized, config.sourceFolder)) return false;
	if (!config.recursive && config.sourceFolder.length > 0) {
		const relativePath = normalized.slice(config.sourceFolder.length + 1);
		if (relativePath.includes('/')) return false;
	}
	if (!config.recursive && config.sourceFolder.length === 0 && normalized.includes('/')) {
		return false;
	}
	return true;
}
