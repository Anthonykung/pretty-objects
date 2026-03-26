/*
 * File: split.ts
 * Project: pretty-objects
 * Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
 * License: Apache-2.0
 */

import { parseEditableCollection, serializeEditableCollection } from './collectionEditor';
import { FormatOptions, SyntaxKind } from './types';

const encoder = new TextEncoder();

export function getByteLength(text: string): number {
	return encoder.encode(text).byteLength;
}

function splitOversizedText(text: string, maxBytes: number): string[] {
	const chunks: string[] = [];
	let current = '';
	for (const char of Array.from(text)) {
		if (current !== '' && getByteLength(current + char) > maxBytes) {
			chunks.push(current);
			current = char;
			continue;
		}
		current += char;
	}
	if (current !== '') {
		chunks.push(current);
	}
	return chunks.length > 0 ? chunks : [''];
}

function splitPreservingLineEndings(text: string): string[] {
	const segments = text.match(/[^\r\n]*(?:\r\n|\n|$)/gu) ?? [];
	if (segments.length > 0 && segments[segments.length - 1] === '') {
		segments.pop();
	}
	return segments;
}

export function splitTextByMaxBytes(text: string, maxBytes: number): string[] {
	if (maxBytes <= 0) {
		throw new Error('maxBytes must be greater than 0.');
	}
	if (getByteLength(text) <= maxBytes) {
		return [text];
	}

	const chunks: string[] = [];
	let current = '';
	for (const segment of splitPreservingLineEndings(text)) {
		const segmentBytes = getByteLength(segment);
		if (segmentBytes > maxBytes) {
			if (current !== '') {
				chunks.push(current);
				current = '';
			}
			chunks.push(...splitOversizedText(segment, maxBytes));
			continue;
		}
		if (current !== '' && getByteLength(current + segment) > maxBytes) {
			chunks.push(current);
			current = segment;
			continue;
		}
		current += segment;
	}
	if (current !== '') {
		chunks.push(current);
	}
	return chunks.length > 0 ? chunks : [''];
}

export function splitJsonlByMaxBytes(text: string, maxBytes: number): string[] {
	if (maxBytes <= 0) {
		throw new Error('maxBytes must be greater than 0.');
	}
	if (getByteLength(text) <= maxBytes) {
		return [text];
	}

	const lines = text.split(/\r?\n/u).filter((line) => line.trim() !== '');
	if (lines.length === 0) {
		return [text];
	}

	const chunks: string[] = [];
	let currentLines: string[] = [];
	for (const line of lines) {
		const candidateLines = [...currentLines, line];
		const candidate = candidateLines.join('\n');
		if (currentLines.length > 0 && getByteLength(candidate) > maxBytes) {
			chunks.push(currentLines.join('\n'));
			currentLines = [line];
			continue;
		}
		if (currentLines.length === 0 && getByteLength(line) > maxBytes) {
			chunks.push(line);
			continue;
		}
		currentLines = candidateLines;
	}
	if (currentLines.length > 0) {
		chunks.push(currentLines.join('\n'));
	}
	return chunks;
}

export function splitJsonArrayByMaxBytes(text: string, maxBytes: number, options: FormatOptions): string[] {
	if (maxBytes <= 0) {
		throw new Error('maxBytes must be greater than 0.');
	}
	const collection = parseEditableCollection(text, 'json', options);
	const singleChunk = serializeEditableCollection(collection.items, 'json', options);
	if (getByteLength(singleChunk) <= maxBytes) {
		return [singleChunk];
	}

	const chunks: string[] = [];
	let currentItems: typeof collection.items = [];
	for (const item of collection.items) {
		const candidateItems = [...currentItems, item];
		const candidate = serializeEditableCollection(candidateItems, 'json', options);
		if (currentItems.length > 0 && getByteLength(candidate) > maxBytes) {
			chunks.push(serializeEditableCollection(currentItems, 'json', options));
			currentItems = [item];
			continue;
		}
		if (currentItems.length === 0 && getByteLength(candidate) > maxBytes) {
			chunks.push(candidate);
			continue;
		}
		currentItems = candidateItems;
	}
	if (currentItems.length > 0) {
		chunks.push(serializeEditableCollection(currentItems, 'json', options));
	}
	return chunks;
}

export function splitDocumentByMaxBytes(
	text: string,
	syntax: SyntaxKind | undefined,
	maxBytes: number,
	options: FormatOptions,
): string[] {
	if (syntax === 'jsonl') {
		return splitJsonlByMaxBytes(text, maxBytes);
	}
	if (syntax === 'json') {
		try {
			return splitJsonArrayByMaxBytes(text, maxBytes, options);
		} catch {
			return splitTextByMaxBytes(text, maxBytes);
		}
	}
	return splitTextByMaxBytes(text, maxBytes);
}
