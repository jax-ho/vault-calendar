import type CalendarViewPlugin from '../main';
import type { CalendarIndex } from '../services/calendar-index';
import type {
	CalendarConfig,
	CalendarIndexSnapshot,
	ConfigIssue,
	SavedView,
	SavedViewCatalog,
	SavedViewUiState,
	ViewId,
} from '../types';

export interface ViewSurfaceInput<TDefinition extends SavedView = SavedView> {
	definition: TDefinition;
	config: CalendarConfig;
	configIssues: readonly ConfigIssue[];
	snapshot: CalendarIndexSnapshot;
	indexError?: string;
	/** Consumed by mount only. Later updates preserve the surface's live state. */
	state?: SavedViewUiState;
}

export interface ViewSurfaceDependencies {
	plugin: CalendarViewPlugin;
	getActiveIndex(): CalendarIndex | undefined;
	applySavedViewCatalog(catalog: SavedViewCatalog): Promise<void> | void;
	persistUiState(viewId: ViewId, state: SavedViewUiState): Promise<void>;
	editView(view: SavedView): void;
	openProperties(): void;
	retry(): Promise<void>;
}

export interface ViewSurfacePrimaryAction {
	label: string;
	ariaLabel: string;
	run(): void;
}

export interface ViewSurface<
	TDefinition extends SavedView = SavedView,
	TState extends SavedViewUiState = SavedViewUiState,
> {
	mount(container: HTMLElement, input: ViewSurfaceInput<TDefinition>): void;
	update(input: ViewSurfaceInput<TDefinition>): void;
	primaryAction(): ViewSurfacePrimaryAction;
	cancelInteraction(message?: string): void;
	deactivate(): TState;
}

export type ViewSurfaceFactory<
	TDefinition extends SavedView = SavedView,
	TState extends SavedViewUiState = SavedViewUiState,
> = (dependencies: ViewSurfaceDependencies) => ViewSurface<TDefinition, TState>;
