import { isWritableBoardGroupProperty } from '../domain/saved-views';
import { selectPropertyOptions } from '../domain/property-values';
import type { CalendarConfig, SavedView, ViewId } from '../types';

export interface BoardCardMoveRequest {
	viewId: ViewId;
	path: string;
	expectedMtime: number;
	groupBy: string;
	sourceValue: string;
	targetValue: string;
	signal?: AbortSignal;
}

export interface ResolvedBoardView {
	view: SavedView;
	config: CalendarConfig;
}

export type BoardViewResolver = (
	viewId: ViewId,
) => Promise<ResolvedBoardView | undefined>;

export interface BoardPropertyWriter {
	updateProperty(
		path: string,
		expectedMtime: number,
		property: string,
		value: unknown,
		signal?: AbortSignal,
	): Promise<void>;
}

export type BoardCardMoveResult = 'moved' | 'unchanged';

export class BoardMoveRejectedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BoardMoveRejectedError';
	}
}

function assertMoveActive(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new BoardMoveRejectedError('The Board move was cancelled.');
	}
}

export class BoardCardMover {
	constructor(
		private readonly resolveView: BoardViewResolver,
		private readonly writer: BoardPropertyWriter,
	) {}

	async move(request: BoardCardMoveRequest): Promise<BoardCardMoveResult> {
		if (request.sourceValue === request.targetValue) return 'unchanged';
		assertMoveActive(request.signal);

		const resolved = await this.resolveView(request.viewId);
		assertMoveActive(request.signal);
		if (
			!resolved ||
			resolved.view.id !== request.viewId ||
			resolved.view.type !== 'board'
		) {
			throw new BoardMoveRejectedError(
				'The Board view is no longer available. Try again.',
			);
		}

		const currentGroupBy = resolved.view.groupBy;
		if (currentGroupBy !== request.groupBy) {
			throw new BoardMoveRejectedError(
				'The Board group property changed after dragging started. Try again.',
			);
		}
		if (!isWritableBoardGroupProperty(resolved.config, currentGroupBy)) {
			throw new BoardMoveRejectedError(
				'The Board group property is no longer writable. Try again.',
			);
		}

		const definition = resolved.config.propertyDefinitions[currentGroupBy];
		if (!definition || !selectPropertyOptions(definition).includes(request.targetValue)) {
			throw new BoardMoveRejectedError(
				`The Board option is no longer available: ${request.targetValue}`,
			);
		}

		await this.writer.updateProperty(
			request.path,
			request.expectedMtime,
			currentGroupBy,
			request.targetValue,
			request.signal,
		);
		return 'moved';
	}
}
