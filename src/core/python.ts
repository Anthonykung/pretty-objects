/*
 * File: python.ts
 * Project: pretty-objects
 * Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
 * License: Apache-2.0
 */

import { ParseResult, PrettyObjectEntry, PrettyValue } from './types';

interface Token {
	type: 'brace' | 'bracket' | 'paren' | 'comma' | 'colon' | 'string' | 'number' | 'name' | 'eof';
	value: string;
	start: number;
	end: number;
}

class PythonTokenizer {
	private readonly text: string;
	private index = 0;

	constructor(text: string) {
		this.text = text;
	}

	next(): Token {
		this.skipWhitespace();
		const start = this.index;
		if (start >= this.text.length) {
			return { type: 'eof', value: '', start, end: start };
		}

		const char = this.text[start];
		if (char === '{' || char === '}') {
			this.index += 1;
			return { type: 'brace', value: char, start, end: this.index };
		}
		if (char === '[' || char === ']') {
			this.index += 1;
			return { type: 'bracket', value: char, start, end: this.index };
		}
		if (char === '(' || char === ')') {
			this.index += 1;
			return { type: 'paren', value: char, start, end: this.index };
		}
		if (char === ',') {
			this.index += 1;
			return { type: 'comma', value: char, start, end: this.index };
		}
		if (char === ':') {
			this.index += 1;
			return { type: 'colon', value: char, start, end: this.index };
		}
		if (char === '\'' || char === '"') {
			return this.readString(char);
		}
		if (char === '-' || /\d/u.test(char)) {
			return this.readNumber();
		}
		if (/[A-Za-z_]/u.test(char)) {
			return this.readName();
		}

		throw new Error(`Unexpected token "${char}"`);
	}

	private skipWhitespace(): void {
		while (this.index < this.text.length && /\s/u.test(this.text[this.index])) {
			this.index += 1;
		}
	}

	private readString(quote: string): Token {
		const start = this.index;
		this.index += 1;
		let value = '';

		while (this.index < this.text.length) {
			const char = this.text[this.index];
			if (char === '\\') {
				this.index += 1;
				if (this.index >= this.text.length) {
					throw new Error('Unterminated escape sequence');
				}
				const escaped = this.text[this.index];
				switch (escaped) {
					case 'n':
						value += '\n';
						break;
					case 'r':
						value += '\r';
						break;
					case 't':
						value += '\t';
						break;
					case '\'':
					case '"':
					case '\\':
						value += escaped;
						break;
					default:
						value += escaped;
						break;
				}
				this.index += 1;
				continue;
			}
			if (char === quote) {
				this.index += 1;
				return { type: 'string', value, start, end: this.index };
			}
			value += char;
			this.index += 1;
		}

		throw new Error('Unterminated string literal');
	}

	private readNumber(): Token {
		const start = this.index;
		if (this.text[this.index] === '-') {
			this.index += 1;
		}
		while (this.index < this.text.length && /\d/u.test(this.text[this.index])) {
			this.index += 1;
		}
		if (this.text[this.index] === '.') {
			this.index += 1;
			while (this.index < this.text.length && /\d/u.test(this.text[this.index])) {
				this.index += 1;
			}
		}
		if (this.text[this.index] === 'e' || this.text[this.index] === 'E') {
			this.index += 1;
			if (this.text[this.index] === '+' || this.text[this.index] === '-') {
				this.index += 1;
			}
			while (this.index < this.text.length && /\d/u.test(this.text[this.index])) {
				this.index += 1;
			}
		}
		return { type: 'number', value: this.text.slice(start, this.index), start, end: this.index };
	}

	private readName(): Token {
		const start = this.index;
		while (this.index < this.text.length && /[A-Za-z0-9_]/u.test(this.text[this.index])) {
			this.index += 1;
		}
		return { type: 'name', value: this.text.slice(start, this.index), start, end: this.index };
	}
}

class PythonParser {
	private readonly tokenizer: PythonTokenizer;
	private current: Token;

	constructor(text: string) {
		this.tokenizer = new PythonTokenizer(text);
		this.current = this.tokenizer.next();
	}

	parse(): PrettyValue {
		const value = this.parseValue();
		if (this.current.type !== 'eof') {
			throw new Error(`Unexpected trailing token "${this.current.value}"`);
		}
		return value;
	}

	private advance(): void {
		this.current = this.tokenizer.next();
	}

	private expect(type: Token['type'], value?: string): Token {
		const token = this.current;
		if (token.type !== type || (value !== undefined && token.value !== value)) {
			throw new Error(`Expected ${value ?? type}`);
		}
		this.advance();
		return token;
	}

	private isToken(type: Token['type'], value?: string): boolean {
		return this.current.type === type && (value === undefined || this.current.value === value);
	}

	private parseValue(): PrettyValue {
		switch (this.current.type) {
			case 'string': {
				const token = this.current;
				this.advance();
				return { kind: 'string', value: token.value };
			}
			case 'number': {
				const token = this.current;
				this.advance();
				return { kind: 'number', raw: token.value };
			}
			case 'name': {
				const token = this.current;
				this.advance();
				if (token.value === 'True') {
					return { kind: 'boolean', value: true };
				}
				if (token.value === 'False') {
					return { kind: 'boolean', value: false };
				}
				if (token.value === 'None') {
					return { kind: 'null' };
				}
					if (token.value === 'set' && this.isToken('paren', '(')) {
						this.advance();
						this.expect('paren', ')');
						return { kind: 'set', items: [] };
				}
				throw new Error(`Unsupported name "${token.value}"`);
			}
			case 'bracket':
				return this.parseList();
			case 'paren':
				return this.parseTuple();
			case 'brace':
				return this.parseBrace();
			default:
				throw new Error(`Unexpected token "${this.current.value}"`);
		}
	}

	private parseList(): PrettyValue {
		this.expect('bracket', '[');
		const items: PrettyValue[] = [];
		while (!this.isToken('bracket', ']')) {
			items.push(this.parseValue());
			if (this.isToken('comma')) {
				this.advance();
				if (this.isToken('bracket', ']')) {
					break;
				}
				continue;
			}
			break;
		}
		this.expect('bracket', ']');
		return { kind: 'array', items };
	}

	private parseTuple(): PrettyValue {
		this.expect('paren', '(');
		const items: PrettyValue[] = [];
		let sawComma = false;
		while (!this.isToken('paren', ')')) {
			items.push(this.parseValue());
			if (this.isToken('comma')) {
				sawComma = true;
				this.advance();
				if (this.isToken('paren', ')')) {
					break;
				}
				continue;
			}
			break;
		}
		this.expect('paren', ')');
		if (items.length === 1 && !sawComma) {
			return items[0];
		}
		return { kind: 'tuple', items };
	}

	private parseBrace(): PrettyValue {
		this.expect('brace', '{');
		if (this.isToken('brace', '}')) {
			this.advance();
			return { kind: 'object', entries: [] };
		}

		const first = this.parseValue();
		if (this.isToken('colon')) {
			const entries: PrettyObjectEntry[] = [];
			this.advance();
			entries.push({ key: { kind: 'value', value: first }, value: this.parseValue() });
			while (this.isToken('comma')) {
				this.advance();
				if (this.isToken('brace', '}')) {
					break;
				}
				const key = this.parseValue();
				this.expect('colon');
				entries.push({ key: { kind: 'value', value: key }, value: this.parseValue() });
			}
			this.expect('brace', '}');
			return { kind: 'object', entries };
		}

		const items: PrettyValue[] = [first];
		while (this.isToken('comma')) {
			this.advance();
			if (this.isToken('brace', '}')) {
				break;
			}
			items.push(this.parseValue());
		}
		this.expect('brace', '}');
		return { kind: 'set', items };
	}
}

export function parsePythonLiteral(text: string): ParseResult {
	try {
		const parser = new PythonParser(text);
		return { ok: true, value: parser.parse() };
	} catch (error) {
		return {
			ok: false,
			error: {
				message: error instanceof Error ? error.message : 'Failed to parse Python literal',
			},
		};
	}
}
