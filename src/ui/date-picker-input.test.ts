import { describe, expect, it, vi } from 'vitest';
import { configurePickerOnlyDateInput } from './date-picker-input';

type Listener = (event: {
	button?: number;
	key?: string;
	preventDefault: () => void;
}) => void;

function harness() {
	const listeners = new Map<string, Listener>();
	const focus = vi.fn();
	const showPicker = vi.fn();
	const input = {
		addEventListener: (eventName: string, listener: Listener) => {
			listeners.set(eventName, listener);
		},
		focus,
		showPicker,
	} as unknown as HTMLInputElement;
	configurePickerOnlyDateInput(input);
	return { focus, listeners, showPicker };
}

describe('picker-only date input', () => {
	it('opens the picker from any primary pointer interaction', () => {
		const { focus, listeners, showPicker } = harness();
		const preventDefault = vi.fn();

		listeners.get('pointerdown')?.({ button: 0, preventDefault });

		expect(preventDefault).toHaveBeenCalledOnce();
		expect(focus).toHaveBeenCalledWith({ preventScroll: true });
		expect(showPicker).toHaveBeenCalledOnce();
	});

	it('blocks manual input while preserving picker and navigation keys', () => {
		const { listeners, showPicker } = harness();
		const digitDefault = vi.fn();
		const enterDefault = vi.fn();
		const tabDefault = vi.fn();

		listeners.get('keydown')?.({ key: '2', preventDefault: digitDefault });
		listeners.get('keydown')?.({ key: 'Enter', preventDefault: enterDefault });
		listeners.get('keydown')?.({ key: 'Tab', preventDefault: tabDefault });

		expect(digitDefault).toHaveBeenCalledOnce();
		expect(enterDefault).toHaveBeenCalledOnce();
		expect(tabDefault).not.toHaveBeenCalled();
		expect(showPicker).toHaveBeenCalledOnce();
	});

	it.each(['beforeinput', 'paste', 'drop'])('blocks %s edits', (eventName) => {
		const { listeners } = harness();
		const preventDefault = vi.fn();

		listeners.get(eventName)?.({ preventDefault });

		expect(preventDefault).toHaveBeenCalledOnce();
	});
});
