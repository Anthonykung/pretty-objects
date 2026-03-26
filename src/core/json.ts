/*
 * File: json.ts
 * Project: pretty-objects
 * Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
 * License: Apache-2.0
 */

import { parseJsTsLiteral } from './jsTs';
import { ParseResult, PrettyObjectEntry, PrettyValue } from './types';

type JsonInput = null | boolean | number | string | JsonInput[] | { [key: string]: JsonInput };

function normalizeJson(value: JsonInput): PrettyValue {
	if (value === null) {
		return { kind: 'null' };
	}
	if (typeof value === 'string') {
		return { kind: 'string', value };
	}
	if (typeof value === 'number') {
		return { kind: 'number', raw: Number.isFinite(value) ? String(value) : 'null' };
	}
	if (typeof value === 'boolean') {
		return { kind: 'boolean', value };
	}
	if (Array.isArray(value)) {
		return { kind: 'array', items: value.map((item) => normalizeJson(item)) };
	}
	const entries: PrettyObjectEntry[] = Object.entries(value).map(([key, entryValue]) => ({
		key: { kind: 'value', value: { kind: 'string', value: key } },
		value: normalizeJson(entryValue),
	}));
	return { kind: 'object', entries };
}

function stripTrailingCommas(text: string): string {
	return text.replace(/,\s*([}\]])/gu, '$1');
}

function stripComments(text: string): string {
	return text
		.replace(/\/\*[\s\S]*?\*\//gu, '')
		.replace(/^\s*\/\/.*$/gmu, '');
}

type JsonRepairTokenKind =
	| 'whitespace'
	| 'string'
	| 'number'
	| 'identifier'
	| 'openBrace'
	| 'closeBrace'
	| 'openBracket'
	| 'closeBracket'
	| 'colon'
	| 'comma'
	| 'other';

interface JsonRepairToken {
	kind: JsonRepairTokenKind;
	raw: string;
}

interface JsonRepairContext {
	kind: 'object' | 'array';
	mode: 'key_or_end' | 'colon' | 'value' | 'value_or_end' | 'comma_or_end';
}

function tokenizeJsonRepair(text: string): JsonRepairToken[] {
	const tokens: JsonRepairToken[] = [];
	let index = 0;

	while (index < text.length) {
		const char = text[index];
		if (!char) {
			break;
		}

		if (/\s/u.test(char)) {
			let end = index + 1;
			while (end < text.length && /\s/u.test(text[end] ?? '')) {
				end += 1;
			}
			tokens.push({ kind: 'whitespace', raw: text.slice(index, end) });
			index = end;
			continue;
		}

		if (char === '"' || char === '\'') {
			let end = index + 1;
			while (end < text.length) {
				const current = text[end];
				if (current === '\\') {
					end += 2;
					continue;
				}
				if (current === char) {
					end += 1;
					break;
				}
				end += 1;
			}
			tokens.push({ kind: 'string', raw: text.slice(index, end) });
			index = end;
			continue;
		}

		if (char === '{') {
			tokens.push({ kind: 'openBrace', raw: char });
			index += 1;
			continue;
		}
		if (char === '}') {
			tokens.push({ kind: 'closeBrace', raw: char });
			index += 1;
			continue;
		}
		if (char === '[') {
			tokens.push({ kind: 'openBracket', raw: char });
			index += 1;
			continue;
		}
		if (char === ']') {
			tokens.push({ kind: 'closeBracket', raw: char });
			index += 1;
			continue;
		}
		if (char === ':') {
			tokens.push({ kind: 'colon', raw: char });
			index += 1;
			continue;
		}
		if (char === ',') {
			tokens.push({ kind: 'comma', raw: char });
			index += 1;
			continue;
		}

		const numberMatch = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(index));
		if (numberMatch) {
			tokens.push({ kind: 'number', raw: numberMatch[0] });
			index += numberMatch[0].length;
			continue;
		}

		const identifierMatch = /^[A-Za-z_$][\w$]*/u.exec(text.slice(index));
		if (identifierMatch) {
			tokens.push({ kind: 'identifier', raw: identifierMatch[0] });
			index += identifierMatch[0].length;
			continue;
		}

		tokens.push({ kind: 'other', raw: char });
		index += 1;
	}

	return tokens;
}

function isKeyToken(token: JsonRepairToken): boolean {
	return token.kind === 'string' || token.kind === 'identifier' || token.kind === 'number';
}

function isValueToken(token: JsonRepairToken): boolean {
	return token.kind === 'string'
		|| token.kind === 'number'
		|| token.kind === 'identifier'
		|| token.kind === 'openBrace'
		|| token.kind === 'openBracket';
}

function completeParentValue(stack: JsonRepairContext[]): void {
	const parent = stack[stack.length - 1];
	if (!parent) {
		return;
	}
	if (parent.kind === 'object' && parent.mode === 'value') {
		parent.mode = 'comma_or_end';
		return;
	}
	if (parent.kind === 'array' && parent.mode === 'value_or_end') {
		parent.mode = 'comma_or_end';
	}
}

function processJsonRepairToken(stack: JsonRepairContext[], token: JsonRepairToken): void {
	const current = stack[stack.length - 1];
	if (!current) {
		if (token.kind === 'openBrace') {
			stack.push({ kind: 'object', mode: 'key_or_end' });
		} else if (token.kind === 'openBracket') {
			stack.push({ kind: 'array', mode: 'value_or_end' });
		}
		return;
	}

	if (current.kind === 'object') {
		switch (current.mode) {
			case 'key_or_end':
				if (token.kind === 'closeBrace') {
					stack.pop();
					completeParentValue(stack);
				} else if (isKeyToken(token)) {
					current.mode = 'colon';
				}
				return;
			case 'colon':
				if (token.kind === 'colon') {
					current.mode = 'value';
				}
				return;
			case 'value':
				if (token.kind === 'openBrace') {
					current.mode = 'comma_or_end';
					stack.push({ kind: 'object', mode: 'key_or_end' });
				} else if (token.kind === 'openBracket') {
					current.mode = 'comma_or_end';
					stack.push({ kind: 'array', mode: 'value_or_end' });
				} else if (isValueToken(token)) {
					current.mode = 'comma_or_end';
				}
				return;
			case 'comma_or_end':
				if (token.kind === 'comma') {
					current.mode = 'key_or_end';
				} else if (token.kind === 'closeBrace') {
					stack.pop();
					completeParentValue(stack);
				}
				return;
			default:
				return;
		}
	}

	switch (current.mode) {
		case 'value_or_end':
			if (token.kind === 'closeBracket') {
				stack.pop();
				completeParentValue(stack);
			} else if (token.kind === 'openBrace') {
				current.mode = 'comma_or_end';
				stack.push({ kind: 'object', mode: 'key_or_end' });
			} else if (token.kind === 'openBracket') {
				current.mode = 'comma_or_end';
				stack.push({ kind: 'array', mode: 'value_or_end' });
			} else if (isValueToken(token)) {
				current.mode = 'comma_or_end';
			}
			return;
		case 'comma_or_end':
			if (token.kind === 'comma') {
				current.mode = 'value_or_end';
			} else if (token.kind === 'closeBracket') {
				stack.pop();
				completeParentValue(stack);
			}
			return;
		default:
			return;
	}
}

function shouldInsertMissingComma(stack: JsonRepairContext[], token: JsonRepairToken): boolean {
	const current = stack[stack.length - 1];
	if (!current) {
		return false;
	}
	if (current.kind === 'object') {
		return current.mode === 'comma_or_end' && isKeyToken(token);
	}
	return current.mode === 'comma_or_end' && isValueToken(token);
}

function insertMissingCommas(text: string): string {
	const tokens = tokenizeJsonRepair(text);
	const stack: JsonRepairContext[] = [];
	const output: string[] = [];
	let pendingTrivia = '';

		for (const token of tokens) {
			if (token.kind === 'whitespace') {
				pendingTrivia += token.raw;
				continue;
			}

			if (shouldInsertMissingComma(stack, token)) {
				output.push(',', pendingTrivia, token.raw);
				processJsonRepairToken(stack, { kind: 'comma', raw: ',' });
			} else {
				output.push(pendingTrivia, token.raw);
			}
		pendingTrivia = '';
		processJsonRepairToken(stack, token);
	}

	if (pendingTrivia !== '') {
		output.push(pendingTrivia);
	}

	return output.join('');
}

function parseStrictJson(text: string): ParseResult {
	try {
		const parsed = JSON.parse(text) as JsonInput;
		return { ok: true, value: normalizeJson(parsed) };
	} catch (error) {
		return {
			ok: false,
			error: {
				message: error instanceof Error ? error.message : 'Invalid JSON',
			},
		};
	}
}

export function parseJson(text: string, repairMode: 'deterministic' | 'moderate' | 'bestEffort'): ParseResult {
	const strict = parseStrictJson(text);
	if (strict.ok) {
		return strict;
	}

	const deterministic = stripTrailingCommas(text);
	if (deterministic !== text) {
		const repaired = parseStrictJson(deterministic);
		if (repaired.ok) {
			return { ...repaired, repairedText: deterministic };
		}
	}

	if (repairMode === 'moderate' || repairMode === 'bestEffort') {
		const commentStripped = stripComments(text);
		const relaxedText = stripTrailingCommas(commentStripped);
		if (relaxedText !== text) {
			const repairedJson = parseStrictJson(relaxedText);
			if (repairedJson.ok) {
				return { ...repairedJson, repairedText: relaxedText };
			}
		}

		const jsFallback = parseJsTsLiteral(relaxedText, 'javascript');
		if (jsFallback.ok) {
			return { ...jsFallback, repairedText: relaxedText };
		}

		const commaRepairedText = insertMissingCommas(relaxedText);
		if (commaRepairedText !== relaxedText) {
			const commaRepairedJson = parseStrictJson(commaRepairedText);
			if (commaRepairedJson.ok) {
				return { ...commaRepairedJson, repairedText: commaRepairedText };
			}

			const commaRepairedJsFallback = parseJsTsLiteral(commaRepairedText, 'javascript');
			if (commaRepairedJsFallback.ok) {
				return { ...commaRepairedJsFallback, repairedText: commaRepairedText };
			}
		}
	}

	return {
		ok: false,
		error: {
			...strict.error,
			safeRepairLabel: strict.error.safeRepairLabel ?? 'Apply safe JSON repair',
		},
	};
}
