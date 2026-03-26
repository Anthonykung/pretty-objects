/*
 * File: folding.ts
 * Project: pretty-objects
 * Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
 * License: Apache-2.0
 */

export interface FoldTarget {
	startLine: number;
	endLine: number;
	depth: number;
	kind: 'object' | 'array';
}

interface ContainerStart {
	char: '{' | '[';
	line: number;
	depth: number;
}

function isEscaped(text: string, index: number): boolean {
	let slashCount = 0;
	let cursor = index - 1;
	while (cursor >= 0 && text[cursor] === '\\') {
		slashCount += 1;
		cursor -= 1;
	}
	return slashCount % 2 === 1;
}

export function computeFoldTargets(text: string): FoldTarget[] {
	const targets: FoldTarget[] = [];
	const stack: ContainerStart[] = [];
	let line = 0;
	let inString = false;
	let stringQuote = '"';

	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char === '\n') {
			line += 1;
			continue;
		}

		if (inString) {
			if (char === stringQuote && !isEscaped(text, index)) {
				inString = false;
			}
			continue;
		}

		if (char === '"' || char === '\'') {
			inString = true;
			stringQuote = char;
			continue;
		}

		if (char === '{' || char === '[') {
			stack.push({
				char,
				line,
				depth: stack.length,
			});
			continue;
		}

		if (char !== '}' && char !== ']') {
			continue;
		}

		const start = stack.pop();
		if (!start) {
			continue;
		}
		if ((start.char === '{' && char !== '}') || (start.char === '[' && char !== ']')) {
			continue;
		}
		if (start.line === line) {
			continue;
		}

		targets.push({
			startLine: start.line,
			endLine: line,
			depth: start.depth,
			kind: start.char === '{' ? 'object' : 'array',
		});
	}

	return targets;
}

export function getDefaultCollapsedDepth(targets: FoldTarget[]): number {
	const root = targets.find((target) => target.depth === 0);
	if (!root) {
		return 1;
	}
	return root.kind === 'array' ? 2 : 1;
}
