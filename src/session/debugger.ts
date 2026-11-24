/**
 * The routine debugger (`[CLIENT Debugging routines]`), an extension:
 * with `debugger` granted, one connection drives the routines another
 * connection's session runs. It attaches to that session by the other
 * connection's ID, sets breakpoints in routines' and triggers' text,
 * waits for the session to pause, reads its call stack, and lets it go on
 * a step or to the next breakpoint, as turborel-client's `debug.rs` does.
 *
 * @packageDocumentation
 */

import type { Link } from './link.js';
import { completed } from './lobs.js';
import type {
  Breakpoint,
  DebugEvent,
  DebugReply,
  DebugRequest,
  Paused,
  ResumeAction,
  RoutineKind,
} from '../codec/debug.js';
import type { TurborelError } from '../error.js';

/** A routine a breakpoint is set in: its schema, the debugger's session's default if empty or none, and its specific name, or its name if one routine of its kind has it, or a trigger's name. */
export interface RoutineName {
  /** Its schema; none, the debugger's session's default schema. */
  readonly schema?: string;
  /** Its specific name, its name, or a trigger's name. */
  readonly name: string;
}

/** How a breakpoint is set: its routine's kind, a procedure by default, and a condition, a `<search condition>` over the frame's parameters and variables. */
export interface BreakOptions {
  /** A procedure, a function or a trigger; a procedure by default. */
  readonly kind?: RoutineKind;
  /** It pauses only where this is true. */
  readonly condition?: string;
}

/** A connection's debugger: what it asks of the session it debugs, the session of another connection. */
export class Debugger {
  readonly #conn: Link;
  readonly #events: DebugEvent[];

  /**
   * The debugger of `conn`.
   *
   * @param conn - the debugger's connection
   * @param events - the events of its target that came and were not yet read
   */
  constructor(conn: Link, events: DebugEvent[]) {
    [this.#conn, this.#events] = [conn, events];
  }

  /**
   * Asks `request`, answered by Debugged.
   *
   * @param request - the request
   * @returns what Debugged answered
   */
  async #debugged(request: DebugRequest): Promise<DebugReply> {
    await this.#conn.send({ kind: 'debug', debug: request });
    const reply = await this.#conn.receive();
    if (reply.kind === 'debugged') return reply.debugged;
    throw reply.kind === 'error' ? this.#conn.failed(reply.failure) : this.#conn.lose('the server sent no Debug reply');
  }

  /**
   * Asks `request`, answered by a Complete.
   *
   * @param request - the request
   */
  async #done(request: DebugRequest): Promise<void> {
    await completed(this.#conn, { kind: 'debug', debug: request });
  }

  /**
   * The failure of a Debugged other than the one awaited.
   *
   * @param what - what the server failed to send
   * @returns the connection lost
   */
  #lost(what: string): TurborelError {
    return this.#conn.lose(`the server sent no ${what}`);
  }

  /**
   * @returns this connection's ID, the one INFORMATION_SCHEMA.CONNECTIONS shows, by which another connection attaches to its session
   * @throws {@link TurborelError} 08006 if `debugger` was not granted, the connection kept
   */
  async id(): Promise<bigint> {
    const d = await this.#debugged({ what: 'identify' });
    if (d.what === 'connection') return d.id;
    throw this.#lost("connection's ID");
  }

  /**
   * Makes this connection the debugger of the session of the connection of ID `connection`.
   *
   * @param connection - its ID, as `id` gives it on that connection
   * @throws {@link TurborelError} 08003 if no connection of that ID is served, or this user may not see it; TBD01 if this one is attached already
   */
  async attach(connection: bigint): Promise<void> {
    await this.#done({ what: 'attach', connection });
  }

  /** Ends the debugging: its breakpoints gone, its target, if paused, going on; any event not yet read dropped. */
  async detach(): Promise<void> {
    this.#events.length = 0;
    await this.#done({ what: 'detach' });
  }

  /**
   * Sets a breakpoint at `line`, from 1, of a routine's or a trigger's text.
   *
   * @param routine - the routine
   * @param line - the line
   * @param options - its routine's kind, and its condition
   * @returns the breakpoint set, its routine named by its specific name
   * @throws {@link TurborelError} 42000 (SQLCODE -104) of a routine this user neither owns nor holds DEBUG on
   */
  async break(routine: RoutineName, line: number, options: BreakOptions = {}): Promise<Breakpoint> {
    const { kind = 'procedure', condition } = options;
    const named = { schema: routine.schema ?? '', name: routine.name };
    const d = await this.#debugged({
      what: 'break',
      kind,
      routine: named,
      line,
      ...(condition === undefined ? {} : { condition }),
    });
    if (d.what === 'breakpoint') return d.breakpoint;
    throw this.#lost('breakpoint');
  }

  /**
   * Clears the breakpoint of `number`.
   *
   * @param number - its number
   */
  async clear(number: number): Promise<void> {
    await this.#done({ what: 'clear', number });
  }

  /** @returns every breakpoint set, in the order they were set */
  async breakpoints(): Promise<readonly Breakpoint[]> {
    const d = await this.#debugged({ what: 'breakpoints' });
    if (d.what === 'breakpoints') return d.breakpoints;
    throw this.#lost('breakpoints');
  }

  /**
   * The target's next event: a pause with its call stack, a pause that
   * timed out, its statement cancelled while paused, or its session ended.
   *
   * @param timeout - the milliseconds to wait at most; none, as long as it takes
   * @returns the event, or undefined if none came in time
   * @throws {@link TurborelError} 08006 if the connection is lost
   */
  async wait(timeout?: number): Promise<DebugEvent | undefined> {
    const kept = this.#events.shift();
    if (kept !== undefined) return kept;
    if (!(await this.#conn.arrives(timeout))) return undefined;
    // A Notice or a Status is taken, and an Event kept, as any reply's.
    const reply = await this.#conn.takeUnasked();
    if (reply === undefined) return this.#events.shift();
    throw reply.kind === 'error' ? this.#conn.failed(reply.failure) : this.#conn.lose('the server answered no request');
  }

  /** @returns the target's pause, if it is paused */
  async stack(): Promise<Paused | undefined> {
    const d = await this.#debugged({ what: 'stack' });
    if (d.what === 'stack') return d.paused;
    throw this.#lost('stack');
  }

  /**
   * Lets the paused target go on: into, to its next statement in whatever
   * frame; over, to the next of this frame or one it returns to; out, to
   * the next of the frame it returns to; or continue, to a breakpoint.
   *
   * @param action - how it goes on, continue by default
   * @throws {@link TurborelError} TBD01 (SQLCODE -910) if it is not paused
   */
  async resume(action: ResumeAction = 'continue'): Promise<void> {
    await this.#done({ what: 'resume', action });
  }

  /** Tells the running target to pause at its next statement. */
  async interrupt(): Promise<void> {
    await this.#done({ what: 'interrupt' });
  }
}
