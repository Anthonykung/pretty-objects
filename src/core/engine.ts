/*
 * File: engine.ts
 * Project: pretty-objects
 * Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
 * License: Apache-2.0
 */

import { parseJsTsLiteral } from './jsTs';
import { parseJson } from './json';
import { printCompactJson, printValue } from './printer';
import { parsePythonLiteral } from './python';
import { FormatOptions, FormatResult, ParseResult, PrettyValue, SyntaxKind } from './types';

function parseBySyntax(text: string, syntax: SyntaxKind, options: FormatOptions): ParseResult {
	switch (syntax) {
		case 'json':
			return parseJson(text, options.repairMode);
		case 'javascript':
		case 'typescript':
			return parseJsTsLiteral(text, syntax);
		case 'python':
			return parsePythonLiteral(text);
		default:
			return {
				ok: false,
				error: {
					message: `Unsupported syntax "${syntax}"`,
				},
			};
	}
}

function formatJsonlLines(text: string, options: FormatOptions): FormatResult {
	const lines = text.split(/\r?\n/u);
	const formatted = lines.map((line) => {
		const trimmed = line.trim();
		if (trimmed === '') {
			return '';
		}
		const parsed = parseJson(trimmed, 'deterministic');
		if (!parsed.ok) {
			throw new Error(parsed.error.message);
		}
		return printCompactJson(parsed.value);
	});
	return { formattedText: formatted.join(options.lineEnding) };
}

function formatJsonlPrettyView(text: string, options: FormatOptions): FormatResult {
	const values: PrettyValue[] = [];
	for (const rawLine of text.split(/\r?\n/u)) {
		const trimmed = rawLine.trim();
		if (trimmed === '') {
			continue;
		}
		const parsed = parseJson(trimmed, options.repairMode);
		if (!parsed.ok) {
			throw new Error(parsed.error.message);
		}
		values.push(parsed.value);
	}
	return {
		formattedText: printValue({ kind: 'array', items: values }, 'json', options),
	};
}

export function analyzeSyntaxText(text: string, syntax: SyntaxKind, options: FormatOptions): ParseResult {
	if (syntax === 'jsonl') {
		for (const line of text.split(/\r?\n/u).filter((entry) => entry.trim() !== '')) {
			const parsed = parseJson(line, options.repairMode);
			if (!parsed.ok) {
				return parsed;
			}
		}
		return { ok: true, value: { kind: 'array', items: [] } };
	}
	return parseBySyntax(text, syntax, options);
}

export function formatTarget(text: string, syntax: SyntaxKind, options: FormatOptions, modeOverride?: 'prettyView'): FormatResult {
	if (syntax === 'jsonl') {
		return modeOverride === 'prettyView' || options.jsonlMode === 'prettyView'
			? formatJsonlPrettyView(text, options)
			: formatJsonlLines(text, options);
	}

	const parsed = parseBySyntax(text, syntax, options);
	if (!parsed.ok) {
		throw new Error(parsed.error.message);
	}

	return {
		formattedText: printValue(parsed.value, syntax, options),
		repairedText: parsed.repairedText,
	};
}
