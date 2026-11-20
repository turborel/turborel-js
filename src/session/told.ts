/**
 * What a connection asks for as it opens, and what the server has told it
 * since beside each statement's replies, as turborel-client's `told.rs`
 * keeps them: the capabilities granted, the session's settings as Status
 * gave them, the notices the server sent, the log position of the last
 * commit and the last statement's completion; and the query attributes
 * each request carries.
 * `[CLIENT What a connection asks for]`
 * `[CLIENT What the server tells]`
 *
 * @packageDocumentation
 */

import { ALL_CAPABILITIES, COMPRESSION, QUERY_ATTRIBUTES } from './capabilities.js';
import { DEFAULT_THRESHOLD } from '../codec/compress.js';
import type { Completion } from '../codec/replies.js';
import type { Attribute } from '../codec/tail.js';
import type { Diagnostics } from '../error.js';

/** The connection attribute that names the program, which the server shows in INFORMATION_SCHEMA.CONNECTIONS. */
export const APPLICATION = 'application';

/** The most notices kept for a connection with no handler, the oldest dropped past them. */
export const KEPT_NOTICES = 64;

/** A notice the server sent: a condition a statement raised, or one of its own. */
export interface Notice {
  /** Its SQLSTATE. */
  readonly sqlstate: string;
  /** What it says. */
  readonly message: string;
  /** Its severity and what it is about, if the server said. */
  readonly diagnostics?: Diagnostics;
}

/** What takes each notice as it comes. */
export type NoticeHandler = (notice: Notice) => void;

/** What a connection asks for as it opens. */
export class Offer {
  /** The capabilities asked for, by name. */
  readonly capabilities: readonly string[];
  /** The connection's attributes, which the server shows in INFORMATION_SCHEMA.CONNECTION_ATTRIBUTES. */
  readonly attributes: readonly Attribute[];
  /** The bytes, header included, of the shortest request sent compressed, once compression is granted. */
  readonly compressFrom: number;

  /**
   * An offer of these.
   *
   * @param capabilities - the capabilities asked for
   * @param attributes - the connection's attributes
   * @param compressFrom - the shortest request sent compressed
   */
  constructor(
    capabilities: readonly string[],
    attributes: readonly Attribute[] = [],
    compressFrom = DEFAULT_THRESHOLD,
  ) {
    this.capabilities = capabilities;
    this.attributes = attributes;
    this.compressFrom = compressFrom;
  }

  /** @returns every capability but compression, which costs time where the network is fast; no attributes */
  static default(): Offer {
    return new Offer(ALL_CAPABILITIES.filter((name) => name !== COMPRESSION));
  }

  /** @returns no capability: the protocol's first form */
  static none(): Offer {
    return new Offer([]);
  }

  /** @returns it, asking for compression too */
  compressed(): Offer {
    const capabilities = this.capabilities.includes(COMPRESSION)
      ? this.capabilities
      : [...this.capabilities, COMPRESSION];
    return new Offer(capabilities, this.attributes, this.compressFrom);
  }

  /**
   * It, with a connection attribute.
   *
   * @param name - the attribute's name
   * @param value - its value
   * @returns the offer
   */
  attribute(name: string, value: string): Offer {
    return new Offer(this.capabilities, [...this.attributes, [name, value]], this.compressFrom);
  }

  /**
   * It, compressing requests from `bytes` on, once compression is granted.
   *
   * @param bytes - the shortest request, header included, sent compressed
   * @returns the offer
   */
  compressingFrom(bytes: number): Offer {
    return new Offer(this.capabilities, this.attributes, bytes);
  }
}

/** What the server has told a connection. */
export class Told {
  /** The capabilities granted, in Ready's order. */
  granted: readonly string[] = [];
  /** The session's settings, as Status last gave them. */
  readonly settings = new Map<string, string>();
  /** What takes each notice as it comes, if anything does. */
  handler: NoticeHandler | undefined;
  /** The notices that came while no handler was set, the last 64. */
  readonly notices: Notice[] = [];
  /** The log position of the last commit the server told of. */
  position: bigint | undefined;
  /** The last statement's completion. */
  completed: Completion | undefined;
  /** The query attributes each Query and Execute carries, as the program set them. */
  attributes: readonly Attribute[] = [];

  /**
   * Takes a notice: to the handler, or kept.
   *
   * @param notice - the notice
   */
  notice(notice: Notice): void {
    if (this.handler !== undefined) {
      this.handler(notice);
      return;
    }
    if (this.notices.length === KEPT_NOTICES) this.notices.shift();
    this.notices.push(notice);
  }

  /**
   * Whether `name` was granted.
   *
   * @param name - a capability's name
   * @returns true if Ready granted it
   */
  has(name: string): boolean {
    return this.granted.includes(name);
  }

  /** @returns the attributes a Query or an Execute carries: none unless `query-attributes` was granted */
  carried(): readonly Attribute[] {
    return this.has(QUERY_ATTRIBUTES) ? this.attributes : [];
  }
}
