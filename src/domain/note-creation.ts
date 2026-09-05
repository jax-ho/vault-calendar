import { normalizeVaultPath } from './config';

const EVENT_ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const EVENT_ID_LENGTH = 4;
const UNBIASED_BYTE_LIMIT = 256 - (256 % EVENT_ID_ALPHABET.length);

export class FileAlreadyExistsError extends Error {
	constructor(path: string) {
		super(`${path} already exists. Choose another name or folder.`);
		this.name = 'FileAlreadyExistsError';
	}
}

function sanitizedNoteName(name: string): string {
	const withoutControls = [...name]
		.filter((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code >= 32 && code !== 127;
		})
		.join('');
	return withoutControls
		.replace(/[\\/:*?"<>|#^]/gu, ' ')
		.replaceAll('[', ' ')
		.replaceAll(']', ' ')
		.replace(/\s+/gu, ' ')
		.trim()
		.replace(/[. ]+$/u, '');
}

export function sanitizeNoteName(name: string): string {
	const sanitized = sanitizedNoteName(name);
	if (!sanitized) throw new Error('Enter a valid note name.');
	return sanitized;
}

export function calendarFolderPath(name: string, parentFolder: string): string {
	const folderName = sanitizeNoteName(name);
	const normalizedParent = normalizeVaultPath(parentFolder);
	return normalizedParent ? `${normalizedParent}/${folderName}` : folderName;
}

function createShortEventId(): string {
	const cryptoApi = typeof window === 'undefined' ? undefined : window.crypto;
	if (cryptoApi?.getRandomValues) {
		let id = '';
		const bytes = new Uint8Array(EVENT_ID_LENGTH * 2);
		while (id.length < EVENT_ID_LENGTH) {
			cryptoApi.getRandomValues(bytes);
			for (const byte of bytes) {
				if (byte >= UNBIASED_BYTE_LIMIT) continue;
				id += EVENT_ID_ALPHABET.charAt(byte % EVENT_ID_ALPHABET.length);
				if (id.length === EVENT_ID_LENGTH) break;
			}
		}
		return id;
	}
	return Array.from({ length: EVENT_ID_LENGTH }, () =>
		EVENT_ID_ALPHABET.charAt(Math.floor(Math.random() * EVENT_ID_ALPHABET.length)),
	).join('');
}

export function uniqueEventMarkdownPath(
	title: string,
	folder: string,
	exists: (path: string) => boolean,
	createId: () => string = createShortEventId,
): string {
	const safeTitle = sanitizedNoteName(title);
	const normalizedFolder = normalizeVaultPath(folder);
	for (let attempt = 0; attempt < 16; attempt += 1) {
		const id = createId().replace(/[^A-Za-z0-9]/gu, '').slice(0, EVENT_ID_LENGTH);
		if (!id) continue;
		const fileName = `${safeTitle}--${id}.md`;
		const path = normalizedFolder ? `${normalizedFolder}/${fileName}` : fileName;
		if (!exists(path)) return path;
	}
	throw new Error('Unable to create a unique event filename. Try again.');
}

export function uniqueMarkdownPath(
	name: string,
	folder: string,
	exists: (path: string) => boolean,
): string {
	const fileName = `${sanitizeNoteName(name)}.md`;
	const normalizedFolder = normalizeVaultPath(folder);
	const path = normalizedFolder ? `${normalizedFolder}/${fileName}` : fileName;
	if (exists(path)) throw new FileAlreadyExistsError(path);
	return path;
}
