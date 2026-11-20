/**
 * An SQL-agent (`[CLIENT The SQL-agent]`), as turborel-client's `agent.rs`
 * keeps one: a program's connections to servers, each named, one current,
 * and the statements that make, choose and end them, CONNECT, SET
 * CONNECTION and DISCONNECT, which it runs itself; every other statement
 * goes to the current connection's session. A connector the program gives
 * makes a connection to the server an address names, as the user a
 * statement names.
 *
 * @packageDocumentation
 */

import { type Token, tokens } from '../sql/lexer.js';
import type { Completion } from '../codec/replies.js';
import { TurborelError } from '../error.js';
import type { Canceller } from '../session/cancel.js';
import { Canceller as CancellerClass } from '../session/cancel.js';
import type { Connection } from '../session/connection.js';
import type { Outcome, Sink, Streamed } from '../session/statements.js';

/** The standard whose rules the connection statements are. */
const SQL92 = 'ISO/IEC 9075:1992';

/** SQLCODEs of the failures an agent raises itself. */
const SQLCODE = {
  syntax: -102,
  syntaxRule: -103,
  privilege: -104,
  unsupported: -900,
  transactionState: -917,
  connection: -919,
};

/** What makes an agent's connections. */
export interface Connector {
  /**
   * A connection to the server `server` names, an address, or for none the default server; as `user`, or for none the user the connector takes.
   *
   * @param server - the server's address, if named
   * @param user - the user, if named
   * @returns the connection
   */
  connect(server: string | undefined, user: string | undefined): Promise<Connection>;
}

/** A connection statement, as the agent runs it. */
type ConnectionStatement =
  | { readonly kind: 'connect'; readonly server: string; readonly name?: string; readonly user?: string }
  | { readonly kind: 'connectDefault' }
  | { readonly kind: 'set'; readonly name?: string }
  | { readonly kind: 'disconnect'; readonly object: 'all' | 'current' | 'default' | { readonly name: string } };

/**
 * A failure of `sqlstate`, its SQLCODE as turborel gives its class, citing `rule`.
 *
 * @param sqlstate - the SQLSTATE
 * @param message - what happened
 * @param rule - the rule of SQL-92 it cites, if any
 * @returns the failure
 */
function exception(sqlstate: string, message: string, rule?: string): TurborelError {
  const sqlcode = sqlstate.startsWith('28')
    ? SQLCODE.privilege
    : sqlstate.startsWith('0A')
      ? SQLCODE.unsupported
      : SQLCODE.connection;
  return new TurborelError(sqlcode, sqlstate, message, rule === undefined ? {} : { rule: `${SQL92} ${rule}` });
}

/**
 * A syntax error of a connection statement.
 *
 * @param message - what is wrong
 * @returns the failure
 */
function syntax(message: string): TurborelError {
  return new TurborelError(SQLCODE.syntax, '2A000', message);
}

/** A connection statement's tokens, read in order. */
class Reader {
  readonly #tokens: Token[];
  #at = 0;

  /** @param read - the tokens */
  constructor(read: Token[]) {
    this.#tokens = read;
  }

  /**
   * Whether the next token is the key word `word`, read past it if so.
   *
   * @param word - the key word
   * @returns true if it was
   */
  accept(word: string): boolean {
    const next = this.#tokens[this.#at];
    if (next?.kind !== 'keyWord' || next.word !== word) return false;
    this.#at += 1;
    return true;
  }

  /**
   * Reads the key word `word`, or fails.
   *
   * @param word - the key word
   */
  expect(word: string): void {
    if (!this.accept(word)) throw syntax(`expected ${word}`);
  }

  /** @returns a simple value specification's text: a character string literal, its spaces trimmed */
  value(): string {
    const next = this.#tokens[this.#at];
    this.#at += 1;
    if (next?.kind === 'colon')
      throw exception('0A000', '<variable specification> (embedded SQL) is valid SQL but is not implemented');
    if (next?.kind === 'string') return next.text.replace(/^ +| +$/gu, '');
    if (next === undefined) throw syntax('expected a <simple value specification>');
    throw new TurborelError(
      SQLCODE.syntaxRule,
      '2A000',
      "a client's connection statement names by character string literals",
    );
  }

  /** Fails unless every token was read. */
  end(): void {
    if (this.#at < this.#tokens.length) throw syntax('expected the end of the statement');
  }
}

/**
 * The rest of CONNECT, after its key word: TO a server [AS a name] [USER a user], or TO DEFAULT.
 *
 * @param r - the statement's tokens
 * @returns the statement
 */
function connectTo(r: Reader): ConnectionStatement {
  r.expect('TO');
  if (r.accept('DEFAULT')) return { kind: 'connectDefault' };
  const server = r.value();
  const name = r.accept('AS') ? r.value() : undefined;
  const user = r.accept('USER') ? r.value() : undefined;
  return { kind: 'connect', server, ...(name === undefined ? {} : { name }), ...(user === undefined ? {} : { user }) };
}

/**
 * The rest of SET CONNECTION, after SET: a connection's name, or DEFAULT.
 *
 * @param r - the statement's tokens
 * @returns the statement
 */
function setConnection(r: Reader): ConnectionStatement {
  r.expect('CONNECTION');
  return r.accept('DEFAULT') ? { kind: 'set' } : { kind: 'set', name: r.value() };
}

/**
 * DISCONNECT: DEFAULT, ALL, CURRENT, or a connection's name.
 *
 * @param r - the statement's tokens
 * @returns the statement
 */
function disconnect(r: Reader): ConnectionStatement {
  r.expect('DISCONNECT');
  if (r.accept('DEFAULT')) return { kind: 'disconnect', object: 'default' };
  if (r.accept('ALL')) return { kind: 'disconnect', object: 'all' };
  if (r.accept('CURRENT')) return { kind: 'disconnect', object: 'current' };
  return { kind: 'disconnect', object: { name: r.value() } };
}

/**
 * `sql` as a connection statement, if it is one: CONNECT, SET CONNECTION or DISCONNECT.
 *
 * @param sql - the statement
 * @returns it, or undefined if it is another
 * @throws {@link TurborelError} a syntax error of one
 */
export function connectionStatement(sql: string): ConnectionStatement | undefined {
  const read = tokens(sql);
  const [first, second] = read;
  const word = (t: Token | undefined): string | undefined => (t?.kind === 'keyWord' ? t.word : undefined);
  const is =
    word(first) === 'CONNECT' ||
    word(first) === 'DISCONNECT' ||
    (word(first) === 'SET' && word(second) === 'CONNECTION');
  if (!is) return undefined;
  const r = new Reader(read);
  const statement = r.accept('CONNECT') ? connectTo(r) : r.accept('SET') ? setConnection(r) : disconnect(r);
  r.end();
  return statement;
}

/**
 * `s` as an identifier, if it is one: a regular identifier in upper case, or a delimited one's body.
 *
 * @param s - the text
 * @returns the identifier, or undefined
 */
export function identifierOf(s: string): string | undefined {
  const read = tokens(s);
  const [only] = read;
  return read.length === 1 && only?.kind === 'identifier' ? only.name : undefined;
}

/**
 * A completion of SQLCODE 0 and `sqlstate`.
 *
 * @param sqlstate - its SQLSTATE
 * @returns the completion
 */
function done(sqlstate: string): Completion {
  return { sqlcode: 0, sqlstate, active: false, more: false, generated: [], conditions: [] };
}

/** A connection of an agent, and its name: none for the default connection. */
interface Held {
  readonly name: string | undefined;
  readonly connection: Connection;
}

/** An SQL-agent's connections. */
export class Agent {
  readonly #connector: Connector;
  #held: Held[] = [];
  #current: number | undefined;

  /**
   * An agent with no connection, or with `connection` its default connection, current.
   *
   * @param connector - what makes its connections
   * @param connection - a connection it begins with, if any
   */
  constructor(connector: Connector, connection?: Connection) {
    this.#connector = connector;
    if (connection !== undefined) [this.#held, this.#current] = [[{ name: undefined, connection }], 0];
  }

  /**
   * The current connection.
   *
   * @returns it
   * @throws {@link TurborelError} 08003 if there is none
   */
  current(): Connection {
    const held = this.#current === undefined ? undefined : this.#held[this.#current];
    if (held === undefined) throw exception('08003', 'there is no current connection', '§15.3 GR9');
    return held.connection;
  }

  /** @returns the current connection's name: undefined for the default one, or for none */
  get currentName(): string | undefined {
    return this.#current === undefined ? undefined : this.#held[this.#current]?.name;
  }

  /** @returns the SQLSTATE of the warning the current connection's last statement completed with, if it did */
  get warning(): string | undefined {
    return this.#heldCurrent()?.connection.warning;
  }

  /** @returns whether the current connection is lost; none is not */
  get isLost(): boolean {
    return this.#heldCurrent()?.connection.isLost ?? false;
  }

  /** @returns what cancels the current connection's statement, if any */
  canceller(): Canceller | undefined {
    const conn = this.#heldCurrent()?.connection;
    return conn === undefined ? undefined : CancellerClass.of(conn);
  }

  /** @returns the current connection held, if any */
  #heldCurrent(): Held | undefined {
    return this.#current === undefined ? undefined : this.#held[this.#current];
  }

  /**
   * Runs `sql`: a connection statement itself, its completion; any other in the current connection's session.
   *
   * @param sql - the statement
   * @returns its outcome
   * @throws {@link TurborelError} a connection statement's failure, or the statement's
   */
  async query(sql: string): Promise<Outcome> {
    const completion = await this.connectionStatement(sql);
    return completion === undefined ? this.current().query(sql) : { kind: 'done', completion };
  }

  /**
   * Runs `sql` as `query` does, a query's rows given to `sink`.
   *
   * @param sql - the statement
   * @param sink - what takes the rows
   * @returns its outcome
   */
  async queryInto(sql: string, sink: Sink): Promise<Streamed> {
    const completion = await this.connectionStatement(sql);
    return completion === undefined ? this.current().queryInto(sql, sink) : { kind: 'done', completion };
  }

  /**
   * `sql`, if a connection statement, run.
   *
   * @param sql - the statement
   * @returns its completion, or undefined if it is another
   * @throws {@link TurborelError} the statement's failure, as each rule says
   */
  async connectionStatement(sql: string): Promise<Completion | undefined> {
    const statement = connectionStatement(sql);
    if (statement === undefined) return undefined;
    switch (statement.kind) {
      case 'connect':
        return this.#connect(statement.server, statement.name, statement.user);
      case 'connectDefault':
        return this.#connect(undefined, undefined, undefined);
      case 'set':
        return this.#set(statement.name);
      case 'disconnect':
        return this.#disconnect(statement.object);
    }
  }

  /** Refuses to leave the current connection's active transaction: none spans servers. */
  #notInTransaction(): void {
    if (this.#heldCurrent()?.connection.inTransaction === true) {
      throw exception(
        '0A001',
        "the current connection's transaction is active, and none spans servers",
        '§15.1 GR1, §15.2 GR1',
      );
    }
  }

  /**
   * The connection named `name`, undefined for the default one, if held.
   *
   * @param name - its name
   * @returns its place, or -1
   */
  #find(name: string | undefined): number {
    return this.#held.findIndex((h) => h.name === name);
  }

  /**
   * CONNECT TO a server, or DEFAULT: the connection made current.
   *
   * @param address - the server, or undefined for the default
   * @param name - the connection's name, if given
   * @param user - the user, if given
   * @returns the completion
   */
  async #connect(address: string | undefined, name: string | undefined, user: string | undefined): Promise<Completion> {
    this.#notInTransaction();
    if (user !== undefined && identifierOf(user) === undefined) {
      throw exception('28000', `'${user}' is not an <authorization identifier>`, '§15.1 GR3');
    }
    const named = name ?? address;
    const identified = named === undefined ? undefined : identifierOf(named);
    if (named !== undefined && identified === undefined) {
      throw exception('2E000', `'${named}' is not an <identifier>`, '§15.1 GR6');
    }
    if (this.#find(identified) >= 0) {
      const what = identified === undefined ? 'the default connection' : `the connection ${identified}`;
      throw exception('08002', `${what} is established`, '§15.1 GR7');
    }
    let connection: Connection;
    try {
      connection = await this.#connector.connect(address, user);
    } catch (e) {
      const failure = e instanceof TurborelError ? e : undefined;
      const state = failure === undefined || failure.sqlstate === '08006' ? '08001' : '08004';
      throw exception(state, failure?.message ?? String(e), '§15.1 GR10, GR11');
    }
    this.#held.push({ name: identified, connection });
    this.#current = this.#held.length - 1;
    return done('00000');
  }

  /**
   * SET CONNECTION, or DEFAULT: that connection current.
   *
   * @param name - its name, or undefined for the default
   * @returns the completion
   */
  #set(name: string | undefined): Completion {
    this.#notInTransaction();
    const found = name === undefined ? undefined : (identifierOf(name) ?? name);
    const at = this.#find(found);
    if (at < 0) {
      throw exception(
        '08003',
        `there is ${found === undefined ? 'no default connection' : `no connection ${found}`}`,
        '§15.2 GR2',
      );
    }
    this.#current = at;
    return done('00000');
  }

  /**
   * The places of the connections a DISCONNECT names.
   *
   * @param object - what it names
   * @returns their places
   * @throws {@link TurborelError} 08003 if it names no connection held
   */
  #named(object: 'all' | 'current' | 'default' | { readonly name: string }): number[] {
    const missing = (what: string): TurborelError => exception('08003', `there is ${what}`, '§15.3 GR1-GR3');
    if (object === 'all') return this.#held.map((_, i) => i);
    if (object === 'current') {
      if (this.#current === undefined) throw missing('no current connection');
      return [this.#current];
    }
    const name = object === 'default' ? undefined : (identifierOf(object.name) ?? object.name);
    const at = this.#find(name);
    if (at < 0) throw missing(name === undefined ? 'no default connection' : `no connection ${name}`);
    return [at];
  }

  /**
   * DISCONNECT: each connection it names ended; none current after, if the current one was.
   *
   * @param object - what it names
   * @returns the completion, 01002 if ending one failed
   */
  async #disconnect(object: 'all' | 'current' | 'default' | { readonly name: string }): Promise<Completion> {
    const ended = this.#named(object);
    if (ended.some((i) => this.#held[i]?.connection.inTransaction === true)) {
      throw new TurborelError(SQLCODE.transactionState, '25000', "a connection's transaction is active", {
        rule: `${SQL92} §15.3 GR6`,
      });
    }
    const current = this.#heldCurrent();
    let warned = false;
    const kept: Held[] = [];
    for (const [i, h] of this.#held.entries()) {
      if (!ended.includes(i)) kept.push(h);
      else if (
        !(await h.connection.terminate().then(
          () => true,
          () => false,
        ))
      )
        warned = true;
    }
    this.#held = kept;
    const at = current === undefined ? undefined : kept.indexOf(current);
    this.#current = at === undefined || at < 0 ? undefined : at;
    return done(warned ? '01002' : '00000');
  }

  /**
   * Ends every connection, as the client ends.
   *
   * @throws {@link TurborelError} the first failure ending one; every one is ended still
   */
  async terminate(): Promise<void> {
    let first: TurborelError | undefined;
    for (const h of this.#held.splice(0)) {
      try {
        await h.connection.terminate();
      } catch (e) {
        first ??= e instanceof TurborelError ? e : exception('08006', String(e));
      }
    }
    this.#current = undefined;
    if (first !== undefined) throw first;
  }
}
