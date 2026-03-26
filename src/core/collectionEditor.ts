/*
 * File: collectionEditor.ts
 * Project: pretty-objects
 * Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
 * License: Apache-2.0
 */

import { parseJsTsLiteral } from './jsTs';
import { parseJson } from './json';
import { printCompactJson, printValue } from './printer';
import { parsePythonLiteral } from './python';
import { FormatOptions, ParseResult, PrettyObjectKey, PrettyValue, SyntaxKind } from './types';

export type EditableCollectionSyntax = SyntaxKind;

export interface EditableCollection {
	syntax: EditableCollectionSyntax;
	items: PrettyValue[];
}

function parseValueBySyntax(text: string, syntax: Exclude<SyntaxKind, 'jsonl'>, options: FormatOptions): ParseResult {
	switch (syntax) {
		case 'json':
			return parseJson(text, options.repairMode);
		case 'javascript':
		case 'typescript':
			return parseJsTsLiteral(text, syntax);
		case 'python':
			return parsePythonLiteral(text);
	}
}

export function getCollectionItemSyntax(syntax: EditableCollectionSyntax): Exclude<SyntaxKind, 'jsonl'> {
	return syntax === 'jsonl' ? 'json' : syntax;
}

export function parseEditableCollection(text: string, syntax: EditableCollectionSyntax, options: FormatOptions): EditableCollection {
	if (syntax === 'jsonl') {
		const items: PrettyValue[] = [];
		for (const rawLine of text.split(/\r?\n/u)) {
			const trimmed = rawLine.trim();
			if (trimmed === '') {
				continue;
			}
			const parsed = parseJson(trimmed, options.repairMode);
			if (!parsed.ok) {
				throw new Error(parsed.error.message);
			}
			items.push(parsed.value);
		}
		return { syntax, items };
	}

	const parsed = parseValueBySyntax(text, syntax, options);
	if (!parsed.ok) {
		throw new Error(parsed.error.message);
	}
	if (parsed.value.kind !== 'array') {
		throw new Error('Object Viewer only supports top-level arrays and JSONL documents.');
	}
	return { syntax, items: parsed.value.items };
}

export function parseEditableCollectionItem(text: string, syntax: EditableCollectionSyntax, options: FormatOptions): PrettyValue {
	const parsed = parseValueBySyntax(text, getCollectionItemSyntax(syntax), options);
	if (!parsed.ok) {
		throw new Error(parsed.error.message);
	}
	return parsed.value;
}

export function printEditableCollectionItem(value: PrettyValue, syntax: EditableCollectionSyntax, options: FormatOptions): string {
	return printValue(value, getCollectionItemSyntax(syntax), options);
}

export function serializeEditableCollection(items: PrettyValue[], syntax: EditableCollectionSyntax, options: FormatOptions): string {
	if (syntax === 'jsonl') {
		return items.map((item) => printCompactJson(item)).join(options.lineEnding);
	}
	return printValue({ kind: 'array', items }, syntax, options);
}

export function createDefaultCollectionItem(reference: PrettyValue | undefined): PrettyValue {
	if (!reference || reference.kind === 'object') {
		return { kind: 'object', entries: [] };
	}
	return { kind: 'null' };
}

function keyName(key: PrettyObjectKey): string | undefined {
	if (key.kind === 'identifier') {
		return key.name;
	}
	if (key.value.kind === 'string') {
		return key.value.value;
	}
	if (key.value.kind === 'number') {
		return key.value.raw;
	}
	return undefined;
}

export function getValueAtPath(value: PrettyValue, path: string): PrettyValue | undefined {
	const segments = path.split('.').map((segment) => segment.trim()).filter((segment) => segment.length > 0);
	if (segments.length === 0) {
		return value;
	}

	let current: PrettyValue | undefined = value;
	for (const segment of segments) {
		if (!current) {
			return undefined;
		}
		if (current.kind === 'object') {
			let next: PrettyValue | undefined;
			for (const candidate of current.entries) {
				if (keyName(candidate.key) === segment) {
					next = candidate.value;
					break;
				}
			}
			current = next;
			continue;
		}
		if (current.kind === 'array' || current.kind === 'tuple' || current.kind === 'set') {
			const index = Number(segment);
			if (!Number.isInteger(index) || index < 0 || index >= current.items.length) {
				return undefined;
			}
			current = current.items[index];
			continue;
		}
		return undefined;
	}

	return current;
}

export function getSearchText(value: PrettyValue): string {
	return printCompactJson(value).toLowerCase();
}

export function getExactValueSignature(value: PrettyValue): string {
	return printCompactJson(value);
}

export function getValueSummary(value: PrettyValue, maxLength = 140): string {
	const compact = printCompactJson(value);
	if (compact.length <= maxLength) {
		return compact;
	}
	return `${compact.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function getGroupLabel(value: PrettyValue | undefined): string {
	if (!value) {
		return '(missing)';
	}
	switch (value.kind) {
		case 'string':
			return value.value;
		case 'number':
			return value.raw;
		case 'boolean':
			return value.value ? 'true' : 'false';
		case 'null':
			return 'null';
		case 'object':
			return '[object]';
		case 'array':
			return `[array:${value.items.length}]`;
		case 'tuple':
			return `[tuple:${value.items.length}]`;
		case 'set':
			return `[set:${value.items.length}]`;
	}
}
