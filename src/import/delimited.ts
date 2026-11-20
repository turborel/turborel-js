/**
 * Delimited text as a source (`[CLIENT Importing]`), as turborel-client's
 * `import/delimited.rs` reads it: CSV as RFC 4180 §2 defines it, and
 * tab-separated text, a record a line, fields split at a delimiter. Read a
 * line at a time, a record at most `maxRecord` bytes, so input of any size
 * is read in bounded memory, and a quote left open is refused at the bound
 * rather than read to the end.
 *
 * CSV (RFC 4180 §2): a record ends at a line break, CR LF or LF alone, the
 * last one's optional; a header row may come first; a field may be
 * enclosed in double quotes, and must be to hold the delimiter, a quote or
 * a line break, a quote in it written twice. A quote in a field not
 * enclosed, or anything but the delimiter after a closing quote, is
 * refused. Tab-separated text has no quoting.
 *
 * A field written as the dialect's text for null, not enclosed in quotes,
 * is null: by default an empty one, so `,,` is a null, and `,"",` the
 * empty string. Text is UTF-8; a byte order mark beginning the input is
 * passed over.
 *
 * @packageDocumentation
 */

import { type Heading, type Position, type Source, SourceError, type SourceRecord } from './source.js';
import { apiMisuse } from '../error.js';

/** The longest record read by default, in bytes: the protocol's longest body, as a longer record could not be sent. */
export const DEFAULT_MAX_RECORD = 16_777_216;

/** CSV's delimiter. */
const COMMA = 0x2c;
/** The delimiter of tab-separated text. */
const TAB = 0x09;
/** What encloses a field. */
const QUOTE = 0x22;
/** What ends a line, after an optional CR. */
const LF = 0x0a;
/** What may come before LF at a line's end. */
const CR = 0x0d;
/** The UTF-8 byte order mark. */
const BOM = Buffer.from('\uFEFF');
/** The last ASCII character. */
const LAST_ASCII = 0x7f;
/** UTF-8, refusing what is not. */
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** The message of a quoted field not closed by the end of the input. */
const UNCLOSED = '[RFC 4180 §2 rule 5] a quoted field is not closed';

/** A dialect's fields. */
interface DialectFields {
  readonly delimiter: number;
  readonly quoted: boolean;
  readonly header: boolean;
  readonly nullText: string;
  readonly maxRecord: number;
}

/** How delimited text is written. */
export class Dialect {
  /** The delimiter's octet. */
  readonly delimiter: number;
  /** Whether fields may be enclosed in quotes, as CSV's are. */
  readonly quoted: boolean;
  /** Whether the first record names the fields. */
  readonly header: boolean;
  /** What a field not enclosed in quotes is written as to be null. */
  readonly nullText: string;
  /** The longest record, in bytes, its line break counted. */
  readonly maxRecord: number;

  /**
   * A dialect of these.
   *
   * @param fields - its delimiter, quoting, header, text for null and longest record
   */
  private constructor(fields: DialectFields) {
    this.delimiter = fields.delimiter;
    this.quoted = fields.quoted;
    this.header = fields.header;
    this.nullText = fields.nullText;
    this.maxRecord = fields.maxRecord;
  }

  /**
   * The dialect, with `changes`.
   *
   * @param changes - the fields that change
   * @returns the dialect
   */
  #with(changes: Partial<DialectFields>): Dialect {
    const { delimiter, quoted, header, nullText, maxRecord } = this;
    return new Dialect({ delimiter, quoted, header, nullText, maxRecord, ...changes });
  }

  /** @returns CSV: fields split at commas, enclosed in quotes as they need; no header; an empty field null */
  static csv(): Dialect {
    return new Dialect({ delimiter: COMMA, quoted: true, header: false, nullText: '', maxRecord: DEFAULT_MAX_RECORD });
  }

  /** @returns tab-separated text: fields split at tabs, never quoted; no header; an empty field null */
  static tsv(): Dialect {
    return new Dialect({ delimiter: TAB, quoted: false, header: false, nullText: '', maxRecord: DEFAULT_MAX_RECORD });
  }

  /**
   * The dialect, its fields split at `delimiter`.
   *
   * @param delimiter - one ASCII character, not a quote or a line break
   * @returns the dialect
   * @throws {@link TurborelError} TB910 for any other delimiter
   */
  withDelimiter(delimiter: string): Dialect {
    const code = delimiter.charCodeAt(0);
    if (delimiter.length !== 1 || code > LAST_ASCII || code === QUOTE || code === CR || code === LF) {
      throw apiMisuse(`a delimiter is one ASCII character, not a quote or a line break: ${JSON.stringify(delimiter)}`);
    }
    return this.#with({ delimiter: code });
  }

  /** @returns the dialect, its first record naming the fields */
  withHeader(): Dialect {
    return this.#with({ header: true });
  }

  /**
   * The dialect, a field written as `text`, not in quotes, null.
   *
   * @param text - the text for null
   * @returns the dialect
   */
  withNull(text: string): Dialect {
    return this.#with({ nullText: text });
  }

  /**
   * The dialect, a record at most `bytes` long.
   *
   * @param bytes - the longest record, its line break counted
   * @returns the dialect
   */
  withMaxRecord(bytes: number): Dialect {
    return this.#with({ maxRecord: bytes });
  }
}

/** Where a scan of a CSV record is: so whether a line break ends it, or is in a quoted field. */
type Scan = 'fieldStart' | 'plain' | 'quoted' | 'quoteInQuoted';

/**
 * Where the scan is after octet `b`, fields split at `delimiter`.
 *
 * @param at - where it was
 * @param b - the octet
 * @param delimiter - the delimiter
 * @returns where it is
 */
function scanned(at: Scan, b: number, delimiter: number): Scan {
  if (at === 'quoted') return b === QUOTE ? 'quoteInQuoted' : 'quoted';
  if (b === delimiter) return 'fieldStart';
  if (at === 'plain') return 'plain';
  return b === QUOTE ? 'quoted' : 'plain';
}

/** A field as written: its text, and whether it was enclosed in quotes. */
interface Field {
  readonly text: string;
  readonly quoted: boolean;
}

/**
 * `bytes` as the text of field `n`.
 *
 * @param bytes - its octets
 * @param n - its index
 * @returns its text
 */
function text(bytes: Uint8Array, n: number): string {
  try {
    return UTF8.decode(bytes);
  } catch {
    throw new Error(`field ${String(n + 1)} is not UTF-8`);
  }
}

/**
 * The fields of a quoted record `bytes`.
 *
 * @param bytes - the record, its line break taken off
 * @param delimiter - the delimiter
 * @returns its fields
 */
function splitQuoted(bytes: Uint8Array, delimiter: number): Field[] {
  const fields: Field[] = [];
  let i = 0;
  for (;;) {
    const n = fields.length;
    const quoted = bytes[i] === QUOTE;
    const written: number[] = [];
    if (quoted) {
      for (i += 1; ; i += 1) {
        if (i >= bytes.byteLength) throw new Error(`field ${String(n + 1)}: ${UNCLOSED}`);
        const b = bytes[i] ?? 0;
        if (b === QUOTE && bytes[i + 1] !== QUOTE) break;
        if (b === QUOTE) i += 1;
        written.push(b);
      }
      i += 1;
    } else {
      for (; i < bytes.byteLength && bytes[i] !== delimiter; i += 1) {
        if (bytes[i] === QUOTE) {
          throw new Error(`[RFC 4180 §2 rule 5] field ${String(n + 1)}: a quote in a field not enclosed in quotes`);
        }
        written.push(bytes[i] ?? 0);
      }
    }
    fields.push({ text: text(Uint8Array.from(written), n), quoted });
    if (i >= bytes.byteLength) return fields;
    if (bytes[i] !== delimiter) {
      throw new Error(
        `[RFC 4180 §2 rule 5] field ${String(n + 1)}: a quoted field's closing quote is followed by more`,
      );
    }
    i += 1;
  }
}

/**
 * The fields of the record `bytes`, written as `dialect` says.
 *
 * @param bytes - the record, its line break taken off
 * @param dialect - how it is written
 * @returns its fields
 */
function split(bytes: Uint8Array, dialect: Dialect): Field[] {
  if (dialect.quoted) return splitQuoted(bytes, dialect.delimiter);
  const fields: Field[] = [];
  let start = 0;
  for (let i = 0; i <= bytes.byteLength; i += 1) {
    if (i === bytes.byteLength || bytes[i] === dialect.delimiter) {
      fields.push({ text: text(bytes.subarray(start, i), fields.length), quoted: false });
      start = i + 1;
    }
  }
  return fields;
}

/** Delimited text read from chunks of octets, as a Node.js stream gives them, a record at a time. */
export class Delimited implements Source {
  readonly #input: AsyncIterator<Uint8Array> | Iterator<Uint8Array>;
  readonly #dialect: Dialect;
  #held: Uint8Array = new Uint8Array(0);
  #inputEnded = false;
  #lines = 0;
  #records = 0;
  #headerPending: boolean;
  #started = false;
  #done = false;

  /**
   * Delimited text read from `input`, written as `dialect` says.
   *
   * @param input - the text's octets, in chunks: a Node.js stream, or an array of them
   * @param dialect - how it is written
   */
  constructor(input: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, dialect: Dialect) {
    this.#input = Symbol.asyncIterator in input ? input[Symbol.asyncIterator]() : input[Symbol.iterator]();
    this.#dialect = dialect;
    this.#headerPending = dialect.header;
  }

  /**
   * The octets up to and through the next LF, at most `room` of them; none at the input's end.
   *
   * @param room - the most octets
   * @returns them
   */
  async #line(room: number): Promise<Uint8Array> {
    for (;;) {
      const lf = this.#held.indexOf(LF);
      const end = lf < 0 ? Infinity : lf + 1;
      if (end <= room || this.#held.byteLength >= room || this.#inputEnded) {
        const take = Math.min(end, this.#held.byteLength, room);
        const piece = this.#held.subarray(0, take);
        this.#held = this.#held.subarray(take);
        return piece;
      }
      const next = await this.#input.next();
      if (next.done === true) this.#inputEnded = true;
      else this.#held = this.#held.byteLength === 0 ? next.value : Buffer.concat([this.#held, next.value]);
    }
  }

  /** @returns the next record's octets, its line break taken off, or undefined at the input's end */
  async #raw(): Promise<Uint8Array | undefined> {
    const parts: Uint8Array[] = [];
    let length = 0;
    let at: Scan = 'fieldStart';
    for (;;) {
      const piece = await this.#line(this.#dialect.maxRecord - length + 1);
      parts.push(piece);
      length += piece.byteLength;
      if (length > this.#dialect.maxRecord) {
        throw new Error(`the record is longer than ${String(this.#dialect.maxRecord)} bytes`);
      }
      if (piece.byteLength === 0) {
        if (at === 'quoted') throw new Error(UNCLOSED);
        return length === 0 ? undefined : this.#ended(Buffer.concat(parts));
      }
      if (this.#dialect.quoted) for (const b of piece) at = scanned(at, b, this.#dialect.delimiter);
      this.#lines += 1;
      if (at !== 'quoted') return this.#ended(Buffer.concat(parts));
    }
  }

  /**
   * A record's octets, its line break taken off, and a byte order mark off the first's.
   *
   * @param bytes - the record as read
   * @returns its octets
   */
  #ended(bytes: Uint8Array): Uint8Array {
    let record = bytes;
    if (record[record.byteLength - 1] === LF) {
      record = record.subarray(0, record.byteLength - 1);
      if (record[record.byteLength - 1] === CR) record = record.subarray(0, record.byteLength - 1);
    }
    if (!this.#started && BOM.every((b, i) => record[i] === b)) record = record.subarray(BOM.length);
    this.#started = true;
    return record;
  }

  /**
   * The next record's fields, and the line it began on.
   *
   * @param record - its number, for a failure
   * @returns them, or undefined at the input's end
   */
  async #fields(record: number): Promise<[Field[], number] | undefined> {
    const line = this.#lines + 1;
    try {
      const raw = await this.#raw();
      const fields = raw === undefined ? undefined : split(raw, this.#dialect);
      this.#done = fields === undefined;
      return fields === undefined ? undefined : [fields, line];
    } catch (e) {
      this.#done = true;
      throw new SourceError({ record, line }, e instanceof Error ? e.message : String(e));
    }
  }

  /** @returns the header's headings, if one is still to be read */
  async #header(): Promise<Heading[] | undefined> {
    if (!this.#headerPending) return undefined;
    this.#headerPending = false;
    const read = await this.#fields(0);
    if (read === undefined) throw new SourceError({ record: 0, line: 1 }, 'there is no header');
    return read[0].map((f) => ({ name: f.text }));
  }

  /**
   * Its fields' names, of a header row, read once, if the dialect has one.
   *
   * @returns the headings, or undefined
   */
  headings(): Promise<Heading[] | undefined> {
    return this.#header();
  }

  /**
   * The next record: its fields as strings, or null.
   *
   * @returns it, or undefined at the end
   */
  async record(): Promise<SourceRecord | undefined> {
    await this.#header();
    if (this.#done) return undefined;
    const number = this.#records + 1;
    const read = await this.#fields(number);
    if (read === undefined) return undefined;
    this.#records = number;
    const [fields, line] = read;
    const position: Position = { record: number, line };
    const values = fields.map((f) => (!f.quoted && f.text === this.#dialect.nullText ? null : f.text));
    return { values, position };
  }
}
