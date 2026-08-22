import { beforeEach, describe, expect, it, vi } from 'vitest';

const modalMocks = vi.hoisted(() => ({
	openCreateModal: vi.fn(),
	openPickerModal: vi.fn(),
}));

vi.mock('obsidian', () => ({
	FuzzySuggestModal: class {
		constructor(_app: unknown) {}

		setPlaceholder(_placeholder: string): void {}

		open(): void {
			modalMocks.openPickerModal();
		}
	},
}));

vi.mock('./create-calendar-modal', () => ({
	CreateCalendarModal: class {
		constructor(_plugin: unknown) {}

		open(): void {
			modalMocks.openCreateModal();
		}
	},
}));

import type CalendarViewPlugin from '../main';
import { CalendarPickerModal } from './calendar-picker-modal';

function pluginWithCalendars(calendars: unknown[]): CalendarViewPlugin {
	return {
		app: {},
		documents: {
			list: () => calendars,
		},
	} as unknown as CalendarViewPlugin;
}

describe('calendar picker first-run routing', () => {
	beforeEach(() => {
		modalMocks.openCreateModal.mockClear();
		modalMocks.openPickerModal.mockClear();
	});

	it('opens calendar creation instead of an empty picker when no calendars exist', () => {
		new CalendarPickerModal(pluginWithCalendars([])).open();

		expect(modalMocks.openCreateModal).toHaveBeenCalledOnce();
		expect(modalMocks.openPickerModal).not.toHaveBeenCalled();
	});

	it('keeps the picker when at least one calendar exists', () => {
		const calendar = { path: 'Life/Work/_calendar.md' };

		new CalendarPickerModal(pluginWithCalendars([calendar])).open();

		expect(modalMocks.openPickerModal).toHaveBeenCalledOnce();
		expect(modalMocks.openCreateModal).not.toHaveBeenCalled();
	});
});
