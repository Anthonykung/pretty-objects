/*
 * File: textToValue.ts
 * Project: pretty-objects
 * Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
 * License: Apache-2.0
 */

import { PrettyObjectEntry, PrettyValue } from './types';

interface ParsedLine {
	indent: number;
	trimmed: string;
}

function sanitizeKey(value: string): string {
	return value.trim().replace(/\s+/g, ' ');
}

function parseScalar(value: string): string | number | boolean | null {
	const trimmed = value.trim();
	if (trimmed === '') {
		return '';
	}
	if (/^null$/iu.test(trimmed)) {
		return null;
	}
	if (/^yes$/iu.test(trimmed)) {
		return true;
	}
	if (/^no$/iu.test(trimmed)) {
		return false;
	}
	if (/^\$?-?\d+(?:\.\d+)?$/u.test(trimmed.replace(/,/g, ''))) {
		return Number(trimmed.replace(/\$/g, '').replace(/,/g, ''));
	}
	return trimmed;
}

function plainToPrettyValue(value: unknown): PrettyValue {
	if (value === null) {
		return { kind: 'null' };
	}
	if (typeof value === 'string') {
		return { kind: 'string', value };
	}
	if (typeof value === 'number') {
		return { kind: 'number', raw: String(value) };
	}
	if (typeof value === 'boolean') {
		return { kind: 'boolean', value };
	}
	if (Array.isArray(value)) {
		return { kind: 'array', items: value.map((item) => plainToPrettyValue(item)) };
	}
	const entries: PrettyObjectEntry[] = [];
	for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
		entries.push({
			key: { kind: 'value', value: { kind: 'string', value: key } },
			value: plainToPrettyValue(entryValue),
		});
	}
	return { kind: 'object', entries };
}

function parsePair(line: string): { key: string; remainder: string } | undefined {
	const pair = /^([^:=]+?)\s*[:=]\s*(.*)$/u.exec(line);
	if (!pair) {
		return undefined;
	}
	return {
		key: sanitizeKey(pair[1]),
		remainder: pair[2].trim(),
	};
}

function parseBullet(line: string): string | undefined {
	const match = /^[-*]\s+(.+)$/u.exec(line);
	return match?.[1]?.trim();
}

function appendValue(target: Record<string, unknown>, key: string, value: unknown): void {
	const existing = target[key];
	if (existing === undefined) {
		target[key] = value;
		return;
	}
	if (Array.isArray(existing)) {
		existing.push(value);
		return;
	}
	target[key] = [existing, value];
}

function nextContentIndex(lines: ParsedLine[], startIndex: number): number {
	let index = startIndex;
	while (index < lines.length && lines[index]?.trimmed === '') {
		index += 1;
	}
	return index;
}

function collectBlock(lines: ParsedLine[], startIndex: number, parentIndent: number): { start: number; end: number; indent: number } | undefined {
	const start = nextContentIndex(lines, startIndex);
	if (start >= lines.length) {
		return undefined;
	}
	const first = lines[start];
	if (!first || first.indent <= parentIndent) {
		return undefined;
	}
	let end = start;
	while (end < lines.length) {
		const current = lines[end];
		if (!current) {
			break;
		}
		if (current.trimmed !== '' && current.indent <= parentIndent) {
			break;
		}
		end += 1;
	}
	return { start, end, indent: first.indent };
}

function collectFlatSiblingBlock(lines: ParsedLine[], startIndex: number, indent: number): { start: number; end: number } | undefined {
	const start = nextContentIndex(lines, startIndex);
	if (start >= lines.length) {
		return undefined;
	}
	const first = lines[start];
	if (!first || first.indent !== indent) {
		return undefined;
	}

	const firstPair = parsePair(first.trimmed);
	let end = start;
	while (end < lines.length) {
		const current = lines[end];
		if (!current) {
			break;
		}
		if (current.trimmed === '') {
			end += 1;
			continue;
		}
		if (current.indent !== indent) {
			break;
		}

		const pair = parsePair(current.trimmed);
		if (firstPair) {
			if (!pair || pair.remainder === '') {
				break;
			}
		} else if (pair) {
			break;
		}
		end += 1;
	}
	return start < end ? { start, end } : undefined;
}

function parseTextBlock(lines: ParsedLine[], startIndex: number, endIndex: number): string {
	return lines
		.slice(startIndex, endIndex)
		.map((line) => line.trimmed)
		.filter((line) => line !== '')
		.join('\n');
}

function parseList(lines: ParsedLine[], startIndex: number, minIndent: number): { value: unknown[]; nextIndex: number } {
	const items: unknown[] = [];
	let index = startIndex;

	while (index < lines.length) {
		const line = lines[index];
		if (!line) {
			break;
		}
		if (line.trimmed === '') {
			index += 1;
			continue;
		}
		if (line.indent < minIndent) {
			break;
		}
		if (line.indent > minIndent) {
			index += 1;
			continue;
		}
		const bullet = parseBullet(line.trimmed);
		if (!bullet) {
			break;
		}

		const nestedBlock = collectBlock(lines, index + 1, minIndent);
		const inlinePair = parsePair(bullet);
		if (inlinePair) {
			const objectValue: Record<string, unknown> = {};
			appendValue(objectValue, inlinePair.key, inlinePair.remainder === '' ? '' : parseScalar(inlinePair.remainder));
				if (nestedBlock) {
					const nested = parseStructuredBlock(lines, nestedBlock.start, minIndent);
					if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
						for (const [key, value] of Object.entries(nested as Record<string, unknown>)) {
							appendValue(objectValue, key, value);
						}
					}
				index = nestedBlock.end;
			} else {
				index += 1;
			}
			items.push(objectValue);
			continue;
		}

		if (nestedBlock) {
			items.push(parseStructuredBlock(lines, nestedBlock.start, minIndent));
			index = nestedBlock.end;
			continue;
		}

		items.push(parseScalar(bullet));
		index += 1;
	}

	return { value: items, nextIndex: index };
}

function parseObject(lines: ParsedLine[], startIndex: number, minIndent: number): { value: Record<string, unknown>; nextIndex: number } {
	const result: Record<string, unknown> = {};
	let index = startIndex;
	let introCount = 0;

	while (index < lines.length) {
		const line = lines[index];
		if (!line) {
			break;
		}
		if (line.trimmed === '') {
			index += 1;
			continue;
		}
		if (line.indent < minIndent) {
			break;
		}
		if (line.indent > minIndent) {
			index += 1;
			continue;
		}

		const pair = parsePair(line.trimmed);
		if (!pair) {
			const key = introCount === 0 ? 'title' : introCount === 1 ? 'summary' : `note${introCount - 1}`;
			result[key] = line.trimmed;
			introCount += 1;
			index += 1;
			continue;
		}

		if (pair.remainder !== '') {
			appendValue(result, pair.key, parseScalar(pair.remainder));
			index += 1;
			continue;
		}

		const nestedBlock = collectBlock(lines, index + 1, minIndent);
		if (nestedBlock) {
			appendValue(result, pair.key, parseStructuredBlock(lines, nestedBlock.start, minIndent));
			index = nestedBlock.end;
			continue;
		}

		const flatBlock = collectFlatSiblingBlock(lines, index + 1, minIndent);
		if (flatBlock) {
			const firstFlat = lines[flatBlock.start];
			appendValue(
				result,
				pair.key,
				firstFlat && parsePair(firstFlat.trimmed)
					? parseObject(lines.slice(flatBlock.start, flatBlock.end), 0, minIndent).value
					: parseTextBlock(lines, flatBlock.start, flatBlock.end),
			);
			index = flatBlock.end;
			continue;
		}

		if (!nestedBlock) {
			appendValue(result, pair.key, '');
			index += 1;
			continue;
		}
	}

	return { value: result, nextIndex: index };
}

function parseStructuredBlock(lines: ParsedLine[], startIndex: number, parentIndent: number): unknown {
	const block = collectBlock(lines, startIndex, parentIndent);
	if (!block) {
		return '';
	}
	const firstLine = lines[block.start];
	if (!firstLine) {
		return '';
	}
	const firstTrimmed = firstLine.trimmed;
	if (parseBullet(firstTrimmed)) {
		return parseList(lines, block.start, block.indent).value;
	}
	if (parsePair(firstTrimmed)) {
		return parseObject(lines, block.start, block.indent).value;
	}
	return parseTextBlock(lines, block.start, block.end);
}

export function bestEffortTextToValue(text: string): PrettyValue | undefined {
	const trimmed = text.trim();
	if (trimmed === '') {
		return undefined;
	}

	const lines = trimmed.split(/\r?\n/u).map((line) => ({
		indent: (/^\s*/u.exec(line)?.[0].length ?? 0),
		trimmed: line.trim(),
	}));

	const structuredPairs = lines.filter((line) => parsePair(line.trimmed)).length;
	const bullets = lines.filter((line) => parseBullet(line.trimmed)).length;
	if (structuredPairs === 0 && bullets === 0) {
		return undefined;
	}

	const topLevelIndex = nextContentIndex(lines, 0);
	if (topLevelIndex >= lines.length) {
		return undefined;
	}

	const topLevel = lines[topLevelIndex];
	if (!topLevel) {
		return undefined;
	}

	const parsed = parseBullet(topLevel.trimmed)
		? parseList(lines, topLevelIndex, topLevel.indent).value
		: parseObject(lines, topLevelIndex, topLevel.indent).value;

	if ((Array.isArray(parsed) && parsed.length === 0) || (!Array.isArray(parsed) && Object.keys(parsed).length === 0)) {
		return undefined;
	}

	return plainToPrettyValue(parsed);
}
