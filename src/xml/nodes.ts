/**
 * The nodes of an XML value's serialization (`[CLIENT XML values]`), as
 * turborel's `XmlValue::sequence` parses the text the protocol carries:
 * XML content, its whitespace kept, read into elements, their attributes
 * and namespaces, text, comments and processing instructions.
 *
 * The text is what the server serializes: XML 1.0 content with no XML
 * declaration, or, where 1.0 cannot hold it, XML 1.1 after one. A
 * document type declaration, which no serialization holds, is refused.
 *
 * @packageDocumentation
 */

import { dataException } from '../error.js';

/** SQLSTATE 2200N, invalid XML content. */
const INVALID_XML_CONTENT = '2200N';

/** The namespace the prefix `xml` is bound to. */
export const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
/** The namespace the prefix `xmlns` is bound to. */
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';

/** An attribute of an element. */
export interface XmlAttribute {
  /** Its name as written, its prefix among it. */
  readonly name: string;
  /** Its name less its prefix. */
  readonly localName: string;
  /** Its namespace: none unless it is prefixed. */
  readonly namespace?: string;
  /** Its value, its references replaced and its whitespace normalized. */
  readonly value: string;
}

/** A node of XML content. */
export type XmlNode =
  | {
      readonly kind: 'element';
      /** Its name as written, its prefix among it. */
      readonly name: string;
      /** Its name less its prefix. */
      readonly localName: string;
      /** Its namespace, if it is in one. */
      readonly namespace?: string;
      /** Its attributes, in their order, its namespace declarations not among them. */
      readonly attributes: readonly XmlAttribute[];
      /** The namespaces it declares, by prefix; '' the default one. */
      readonly declared: ReadonlyMap<string, string>;
      /** Its children. */
      readonly children: readonly XmlNode[];
    }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'comment'; readonly text: string }
  | { readonly kind: 'processingInstruction'; readonly target: string; readonly data: string };

/** A name's start character [XML 1.0 §2.3, production 4]. */
const START =
  'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D' +
  '\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';
/** A name's other characters [XML 1.0 §2.3, production 4a]. */
const MORE = `\\u0300-\\u036F${START}\\-.0-9\\u00B7\\u203F-\\u2040:`;
/** A name. */
const NAME = new RegExp(`[${START}:][${MORE}]*`, 'uy');
/** Whitespace [XML 1.0 §2.3, production 3]. */
const SPACE = /[ \t\n]+/y;
/** A character a document may hold [XML 1.0 §2.2], whitespace and the rest. */
const NOT_CHAR = /[^\t\n -퟿-�\u{10000}-\u{10FFFF}]/u;
/** The five entities every document knows [XML 1.0 §4.6]. */
const PREDEFINED: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', apos: "'", quot: '"' };
/** The start of an XML declaration [XML 1.0 §2.8, production 23]. */
const DECLARATION = /<\?xml[ \t\n]/y;
/** The last code point. */
const LAST_CODE_POINT = 0x10ffff;
/** Hexadecimal. */
const HEX = 16;

/** An element being read. */
interface Open {
  readonly name: string;
  readonly attributes: { name: string; value: string }[];
  readonly children: XmlNode[];
  readonly scope: ReadonlyMap<string, string>;
  readonly declared: Map<string, string>;
}

/** Reads XML content, a character at a time. */
class Parser {
  readonly #text: string;
  #at = 0;

  /** @param text - the content, its line ends normalized */
  constructor(text: string) {
    this.#text = text;
  }

  /**
   * Fails the parse.
   *
   * @param why - what is wrong
   * @returns the failure, to be thrown
   */
  fail(why: string): Error {
    return dataException(
      INVALID_XML_CONTENT,
      `the string is not well-formed XML content: ${why} (at ${String(this.#at)})`,
    );
  }

  /** @returns whether all was read */
  get done(): boolean {
    return this.#at >= this.#text.length;
  }

  /**
   * Whether the text goes on with `s`, read past it if so.
   *
   * @param s - the text looked for
   * @returns true if it was there
   */
  take(s: string): boolean {
    if (!this.#text.startsWith(s, this.#at)) return false;
    this.#at += s.length;
    return true;
  }

  /**
   * Reads `s`, or fails.
   *
   * @param s - the text required
   */
  expect(s: string): void {
    if (!this.take(s)) throw this.fail(`${JSON.stringify(s)} expected`);
  }

  /**
   * Reads up to `end`, and past it.
   *
   * @param end - what ends it
   * @param what - what is read, for a failure
   * @returns the text before `end`
   */
  until(end: string, what: string): string {
    const found = this.#text.indexOf(end, this.#at);
    if (found < 0) throw this.fail(`${what} not ended`);
    const read = this.#text.slice(this.#at, found);
    this.#at = found + end.length;
    return read;
  }

  /**
   * Reads what `pattern`, a sticky expression, matches here.
   *
   * @param pattern - the expression
   * @returns what it matched, or undefined
   */
  match(pattern: RegExp): string | undefined {
    pattern.lastIndex = this.#at;
    const found = pattern.exec(this.#text);
    if (found === null) return undefined;
    this.#at += found[0].length;
    return found[0];
  }

  /** @returns a name, or a failure */
  name(): string {
    const name = this.match(NAME);
    if (name === undefined) throw this.fail('a name expected');
    return name;
  }

  /** @returns whether whitespace was read */
  space(): boolean {
    return this.match(SPACE) !== undefined;
  }

  /** @returns the character data up to the next markup */
  chars(): string {
    const next = this.#text.indexOf('<', this.#at);
    const end = next < 0 ? this.#text.length : next;
    const raw = this.#text.slice(this.#at, end);
    if (raw.includes(']]>')) throw this.fail('"]]>" in character data');
    this.#at = end;
    return this.references(raw);
  }

  /**
   * Replaces the references in `raw`.
   *
   * @param raw - text as written
   * @returns the text it stands for
   */
  references(raw: string): string {
    return raw.replace(/&([^;]*);?/gu, (whole, ref: string) => {
      if (!whole.endsWith(';')) throw this.fail('a reference not ended');
      return this.reference(ref);
    });
  }

  /**
   * The text a reference stands for.
   *
   * @param ref - what is between & and ;
   * @returns its text
   */
  reference(ref: string): string {
    const known = PREDEFINED[ref];
    if (known !== undefined) return known;
    const hex = /^#x([0-9A-Fa-f]+)$/u.exec(ref);
    const dec = /^#([0-9]+)$/u.exec(ref);
    const code =
      hex?.[1] === undefined ? (dec?.[1] === undefined ? NaN : Number(dec[1])) : Number.parseInt(hex[1], HEX);
    if (Number.isNaN(code)) throw this.fail(`the entity &${ref}; is not declared`);
    const ch = code <= LAST_CODE_POINT ? String.fromCodePoint(code) : '\u0000';
    if (code === 0 || NOT_CHAR.test(ch.replace('\r', '\n'))) throw this.fail(`&${ref}; is no character`);
    return ch;
  }

  /** @returns an attribute's value, its references replaced and its whitespace normalized */
  quoted(): string {
    const quote = this.take('"') ? '"' : this.take("'") ? "'" : undefined;
    if (quote === undefined) throw this.fail('a quoted value expected');
    const raw = this.until(quote, 'a value');
    if (raw.includes('<')) throw this.fail('"<" in an attribute value');
    return this.references(raw.replace(/[\t\n]/gu, ' '));
  }
}

/**
 * The namespace of a prefixed or unprefixed name, in `scope`.
 *
 * @param p - the parser, for a failure
 * @param name - the name
 * @param scope - the namespaces in scope
 * @param attribute - whether it is an attribute's, which the default namespace does not take
 * @returns its local name and namespace
 */
function resolve(
  p: Parser,
  name: string,
  scope: ReadonlyMap<string, string>,
  attribute: boolean,
): { localName: string; namespace?: string } {
  const colon = name.indexOf(':');
  if (colon < 0) {
    const namespace = attribute ? undefined : scope.get('');
    return namespace === undefined || namespace === '' ? { localName: name } : { localName: name, namespace };
  }
  const prefix = name.slice(0, colon);
  const localName = name.slice(colon + 1);
  const namespace = scope.get(prefix);
  if (namespace === undefined || localName === '' || localName.includes(':')) {
    throw p.fail(`the prefix of ${name} is not declared`);
  }
  return { localName, namespace };
}

/**
 * Reads a start tag past its name: its attributes, and whether it is empty.
 *
 * @param p - the parser
 * @param name - the element's name
 * @param scope - the namespaces of its parent
 * @returns the element begun, and whether its tag ended it
 */
function startTag(p: Parser, name: string, scope: ReadonlyMap<string, string>): [Open, boolean] {
  const attributes: { name: string; value: string }[] = [];
  const declared = new Map<string, string>();
  let empty = false;
  for (;;) {
    const spaced = p.space();
    if (p.take('/>')) {
      empty = true;
      break;
    }
    if (p.take('>')) break;
    if (!spaced) throw p.fail('whitespace expected between attributes');
    const attribute = p.name();
    p.space();
    p.expect('=');
    p.space();
    const value = p.quoted();
    if (attributes.some((a) => a.name === attribute)) throw p.fail(`the attribute ${attribute} is repeated`);
    if (attribute === 'xmlns') declared.set('', value);
    else if (attribute.startsWith('xmlns:')) declared.set(attribute.slice('xmlns:'.length), value);
    attributes.push({ name: attribute, value });
  }
  const inner = new Map(scope);
  for (const [prefix, uri] of declared) inner.set(prefix, uri);
  return [{ name, attributes, children: [], scope: inner, declared }, empty];
}

/**
 * The element `open` makes, its names resolved.
 *
 * @param p - the parser, for a failure
 * @param open - the element read
 * @returns its node
 */
function element(p: Parser, open: Open): XmlNode {
  const attributes: XmlAttribute[] = [];
  const seen = new Set<string>();
  for (const a of open.attributes) {
    if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) continue;
    const named = resolve(p, a.name, open.scope, true);
    const key = `${named.namespace ?? ''} ${named.localName}`;
    if (seen.has(key)) throw p.fail(`the attribute ${a.name} is repeated`);
    seen.add(key);
    attributes.push({ name: a.name, ...named, value: a.value });
  }
  const named = resolve(p, open.name, open.scope, false);
  return { kind: 'element', name: open.name, ...named, attributes, declared: open.declared, children: open.children };
}

/**
 * The last of `items`.
 *
 * @param items - the items
 * @returns the last, if there is one
 */
function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

/**
 * Appends text to `into`, joined to text before it.
 *
 * @param into - the nodes so far
 * @param text - the text
 */
function addText(into: XmlNode[], text: string): void {
  if (text === '') return;
  const before = last(into);
  if (before?.kind === 'text') into[into.length - 1] = { kind: 'text', text: before.text + text };
  else into.push({ kind: 'text', text });
}

/**
 * Reads markup that is not a tag: a comment, CDATA or a processing instruction.
 *
 * @param p - the parser, past its `<`
 * @param into - where its node goes
 * @returns whether it was one
 */
function other(p: Parser, into: XmlNode[]): boolean {
  if (p.take('!--')) {
    const text = p.until('-->', 'a comment');
    if (text.includes('--') || text.endsWith('-')) throw p.fail('"--" in a comment');
    into.push({ kind: 'comment', text });
  } else if (p.take('![CDATA[')) {
    addText(into, p.until(']]>', 'a CDATA section'));
  } else if (p.take('?')) {
    const target = p.name();
    if (target.toLowerCase() === 'xml') throw p.fail('an XML declaration only at the start');
    const data = p.space() ? p.until('?>', 'a processing instruction') : (p.expect('?>'), '');
    into.push({ kind: 'processingInstruction', target, data });
  } else if (p.take('!DOCTYPE')) {
    throw p.fail('a document type declaration in content');
  } else return false;
  return true;
}

/**
 * Reads an end tag past its `</`, ending the element open.
 *
 * @param p - the parser
 * @param stack - the elements open
 * @param top - the content's own nodes
 */
function endTag(p: Parser, stack: Open[], top: XmlNode[]): void {
  const name = p.name();
  p.space();
  p.expect('>');
  const open = stack.pop();
  if (open?.name !== name) throw p.fail(`the end tag ${name} matches no start tag`);
  (last(stack)?.children ?? top).push(element(p, open));
}

/**
 * Parses `text`, XML content, into its nodes, its whitespace kept.
 *
 * @param text - the serialization
 * @returns its nodes, in order
 * @throws {@link TurborelError} 2200N if it is not well-formed XML content
 */
export function parseContent(text: string): XmlNode[] {
  const normalized = text.replace(/\r\n?/gu, '\n');
  const p = new Parser(normalized);
  if (NOT_CHAR.test(normalized)) throw p.fail('a character XML does not take');
  if (p.match(DECLARATION) !== undefined) p.until('?>', 'the XML declaration');
  const top: XmlNode[] = [];
  const stack: Open[] = [];
  const scope = new Map([
    ['xml', XML_NAMESPACE],
    ['xmlns', XMLNS_NAMESPACE],
  ]);
  while (!p.done) {
    const parent = last(stack);
    const into = parent?.children ?? top;
    if (!p.take('<')) addText(into, p.chars());
    else if (p.take('/')) endTag(p, stack, top);
    else if (!other(p, into)) {
      const [open, empty] = startTag(p, p.name(), parent?.scope ?? scope);
      if (empty) into.push(element(p, open));
      else stack.push(open);
    }
  }
  const unclosed = last(stack);
  if (unclosed !== undefined) throw p.fail(`the element ${unclosed.name} is not ended`);
  return top;
}
