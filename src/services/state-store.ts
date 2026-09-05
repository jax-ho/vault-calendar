import type {
	CalendarDocumentState,
	CalendarPluginData,
	CalendarUiState,
	SavedViewUiState,
} from '../types';
import { isPlainDate } from '../domain/dates';

export const DEFAULT_PLUGIN_DATA: CalendarPluginData = {
	calendarStates: {},
};

function cloneUiState(state: CalendarUiState): CalendarUiState {
	const cloned: CalendarUiState = {
		viewStates: Object.fromEntries(
			Object.entries(state.viewStates).map(([viewId, viewState]) => [
				viewId,
				{ ...viewState },
			]),
		),
	};
	if (state.activeViewId !== undefined) cloned.activeViewId = state.activeViewId;
	return cloned;
}

function cloneDocumentState(state: CalendarDocumentState): CalendarDocumentState {
	const cloned: CalendarDocumentState = {
		leaves: Object.fromEntries(
			Object.entries(state.leaves).map(([key, value]) => [key, cloneUiState(value)]),
		),
	};
	if (state.shared) cloned.shared = cloneUiState(state.shared);
	return cloned;
}

export function normalizePluginData(value: unknown): CalendarPluginData {
	if (!value || typeof value !== 'object') return structuredClone(DEFAULT_PLUGIN_DATA);
	const candidate = value as Partial<CalendarPluginData>;
	const calendarStates: Record<string, CalendarDocumentState> = {};
	if (candidate.calendarStates && typeof candidate.calendarStates === 'object') {
		for (const [path, rawDocumentState] of Object.entries(candidate.calendarStates)) {
			if (!rawDocumentState || typeof rawDocumentState !== 'object') continue;
			const documentCandidate = rawDocumentState as Partial<CalendarDocumentState>;
			const leaves: Record<string, CalendarUiState> = {};
			if (documentCandidate.leaves && typeof documentCandidate.leaves === 'object') {
				for (const [leafId, rawState] of Object.entries(documentCandidate.leaves)) {
					const state = normalizeUiState(rawState);
					if (state) leaves[leafId] = state;
				}
			}
			const documentState: CalendarDocumentState = { leaves };
			const shared = normalizeUiState(documentCandidate.shared);
			if (shared) documentState.shared = shared;
			calendarStates[path] = documentState;
		}
	}
	const normalized: CalendarPluginData = { calendarStates };
	if (typeof candidate.recentCalendarPath === 'string') {
		normalized.recentCalendarPath = candidate.recentCalendarPath;
	}
	return normalized;
}

function normalizeUiState(value: unknown): CalendarUiState | undefined {
	if (!isRecord(value)) return undefined;

	if (isRecord(value.viewStates)) {
		const viewStates: Record<string, SavedViewUiState> = {};
		for (const [viewId, rawViewState] of Object.entries(value.viewStates)) {
			const viewState = normalizeSavedViewUiState(rawViewState);
			if (viewState) viewStates[viewId] = viewState;
		}
		const state: CalendarUiState = { viewStates };
		if (typeof value.activeViewId === 'string' && value.activeViewId.length > 0) {
			state.activeViewId = value.activeViewId;
		}
		return state;
	}

	return normalizeLegacyUiState(value);
}

function normalizeSavedViewUiState(value: unknown): SavedViewUiState | undefined {
	if (!isRecord(value)) return undefined;
	if (value.type === 'calendar') {
		if (typeof value.focusDate !== 'string' || !isPlainDate(value.focusDate)) {
			return undefined;
		}
		const state: SavedViewUiState = {
			type: 'calendar',
			focusDate: value.focusDate,
		};
		const scrollTop = normalizeScrollOffset(value.scrollTop);
		if (scrollTop !== undefined) state.scrollTop = scrollTop;
		return state;
	}
	if (value.type === 'board') {
		const state: SavedViewUiState = { type: 'board' };
		const scrollLeft = normalizeScrollOffset(value.scrollLeft);
		if (scrollLeft !== undefined) state.scrollLeft = scrollLeft;
		const scrollTop = normalizeScrollOffset(value.scrollTop);
		if (scrollTop !== undefined) state.scrollTop = scrollTop;
		return state;
	}
	return undefined;
}

function normalizeLegacyUiState(value: Record<string, unknown>): CalendarUiState | undefined {
	if (typeof value.focusDate !== 'string' || !isPlainDate(value.focusDate)) {
		return undefined;
	}
	const calendarState: SavedViewUiState = {
		type: 'calendar',
		focusDate: value.focusDate,
	};
	const scrollTop = normalizeScrollOffset(value.scrollTop);
	if (scrollTop !== undefined) calendarState.scrollTop = scrollTop;
	return {
		activeViewId: 'calendar',
		viewStates: { calendar: calendarState },
	};
}

function normalizeScrollOffset(value: unknown): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
	return Math.max(0, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export class CalendarStateStore {
	private data: CalendarPluginData;
	private saveQueue: Promise<void> = Promise.resolve();

	constructor(
		initialData: unknown,
		private readonly persist: (data: CalendarPluginData) => Promise<void>,
	) {
		this.data = normalizePluginData(initialData);
	}

	get recentCalendarPath(): string | undefined {
		return this.data.recentCalendarPath;
	}

	has(calendarPath: string): boolean {
		return calendarPath in this.data.calendarStates;
	}

	get(calendarPath: string, leafId: string): CalendarUiState | undefined {
		const documentState = this.data.calendarStates[calendarPath];
		const state = documentState?.leaves[leafId] ?? documentState?.shared;
		return state ? cloneUiState(state) : undefined;
	}

	async set(
		calendarPath: string,
		leafId: string,
		state: CalendarUiState,
	): Promise<void> {
		const documentState = this.data.calendarStates[calendarPath] ?? { leaves: {} };
		documentState.leaves[leafId] = cloneUiState(state);
		documentState.shared = cloneUiState(state);
		this.data.calendarStates[calendarPath] = documentState;
		this.data.recentCalendarPath = calendarPath;
		await this.queueSave();
	}

	async markRecent(calendarPath: string): Promise<void> {
		this.data.recentCalendarPath = calendarPath;
		await this.queueSave();
	}

	async migrate(oldPath: string, newPath: string): Promise<void> {
		const previous = this.data.calendarStates[oldPath];
		if (previous) {
			this.data.calendarStates[newPath] = cloneDocumentState(previous);
			delete this.data.calendarStates[oldPath];
		}
		if (this.data.recentCalendarPath === oldPath) this.data.recentCalendarPath = newPath;
		await this.queueSave();
	}

	async delete(calendarPath: string): Promise<void> {
		delete this.data.calendarStates[calendarPath];
		if (this.data.recentCalendarPath === calendarPath) {
			delete this.data.recentCalendarPath;
		}
		await this.queueSave();
	}

	snapshot(): CalendarPluginData {
		return structuredClone(this.data);
	}

	private async queueSave(): Promise<void> {
		const snapshot = this.snapshot();
		this.saveQueue = this.saveQueue
			.catch(() => undefined)
			.then(() => this.persist(snapshot));
		await this.saveQueue;
	}
}
