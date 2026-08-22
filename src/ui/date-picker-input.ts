const PICKER_KEYS = new Set(['Enter', ' ', 'ArrowDown']);

function showPicker(input: HTMLInputElement): void {
	try {
		input.showPicker();
	} catch {
		// The native picker may reject when the browser has no user activation.
	}
}

export function configurePickerOnlyDateInput(input: HTMLInputElement): void {
	input.addEventListener('pointerdown', (event) => {
		if (event.button !== 0 || typeof input.showPicker !== 'function') return;
		event.preventDefault();
		input.focus({ preventScroll: true });
		showPicker(input);
	});

	input.addEventListener('keydown', (event) => {
		if (event.key === 'Tab' || event.key === 'Escape') return;
		event.preventDefault();
		if (PICKER_KEYS.has(event.key)) showPicker(input);
	});

	for (const eventName of ['beforeinput', 'paste', 'drop']) {
		input.addEventListener(eventName, (event) => event.preventDefault());
	}
}
