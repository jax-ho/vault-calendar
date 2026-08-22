import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync('styles.css', 'utf8');

function declarationsFor(selector: string): string {
	const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`).exec(styles);
	return match?.[1] ?? '';
}

describe('calendar theme styles', () => {
	it('uses a dark surface for event color tokens in dark mode', () => {
		const declarations = declarationsFor('.theme-dark .cv-color-token');

		expect(declarations).toContain('--cv-color-bg:');
		expect(declarations).toContain('--cv-color-chip-bg:');
		expect(declarations).toContain('var(--background-primary)');
		expect(declarations).toContain('--cv-color-text: var(--text-normal)');
	});
});
