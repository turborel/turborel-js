# The Routine Debugger

[Contents](README.md)

## NAME

`Connection.debugger`, `Debugger`: one connection driving the routines
another connection's session runs *(extension)*.

## SYNOPSIS

```ts
type RoutineKind = 'procedure' | 'function' | 'trigger';
type ResumeAction = 'into' | 'over' | 'out' | 'continue';
interface Breakpoint { number: number; routine: TypeName; line: number; condition?: string }
interface Named { name: string; dataType: string; value: Value }
interface CursorShown { name: string; open: boolean; query: string }
interface Frame {
  origin?: { kind: RoutineKind; name: TypeName; shown: TypeName };
  visible: boolean; at?: bigint; line?: number; column?: number;
  parameters: readonly Named[]; variables: readonly Named[]; cursors: readonly CursorShown[];
}
interface Paused { reason: 'breakpoint' | 'step'; breakpoint?: number; frames: readonly Frame[] }
type DebugEvent =
  | { what: 'paused'; paused: Paused }
  | { what: 'timedOut' | 'cancelled' | 'ended' };

class Debugger {
  id(): Promise<bigint>;
  attach(connection: bigint): Promise<void>;
  detach(): Promise<void>;
  break(routine: { schema?: string; name: string }, line: number,
        options?: { kind?: RoutineKind; condition?: string }): Promise<Breakpoint>;
  clear(number: number): Promise<void>;
  breakpoints(): Promise<readonly Breakpoint[]>;
  wait(timeout?: number): Promise<DebugEvent | undefined>;
  stack(): Promise<Paused | undefined>;
  resume(action?: ResumeAction): Promise<void>;
  interrupt(): Promise<void>;
}
```

## DESCRIPTION

With `debugger` granted, which a connection asks for by default, a
connection's `debugger` drives the routines the session of another
connection runs. `id` gives this connection's ID, the one
INFORMATION_SCHEMA.CONNECTIONS shows, and `attach` makes this
connection the debugger of the session of the connection of that ID, a
connection of the same user, or of any user for the database's owner
and a user granted the role MONITOR. `detach` ends the debugging: its
breakpoints go, its target, if paused, goes on, and any event not yet
read is dropped.

`break` sets a breakpoint at a line, from 1, of the text of a
procedure, by default, a function or a trigger, named by its specific
name, its name if one routine of that kind has it, or the trigger's
name; no schema is the debugger's session's default. A condition, a
`<search condition>` over the frame's parameters and variables, pauses
only where it is true. It gives the breakpoint set, its routine named
by its specific name. `clear` clears the breakpoint of a number, and
`breakpoints` gives every one set, in the order they were set.

`wait` gives the target's next event, waiting at most `timeout`
milliseconds, as long as it takes if none, or undefined if none came:
a pause, at a breakpoint or the end of a step, with the call stack, the
outermost frame first; a pause that went on by itself past
DEBUGGER.PAUSE_TIMEOUT_MS; its statement cancelled while paused; or its
session ended, which detaches the debugger. The server sends an event
only between the debugger's requests, and one that comes among a
request's replies is kept for the next `wait`; it ends no request. A
wait that runs out keeps the connection.

A frame is a run of a routine's or a trigger's body, its routine named
by its specific name and by its name, with its place in characters,
its line and column, and its parameters, variables and cursors, each
parameter and variable with its type as SQL writes it and its value. A
frame of a statement run directly has no origin, and one the debugger
may not see into is not visible and shows its origin alone. `stack`
gives the target's pause again, if it is paused.

`resume` lets the paused target go on: `into` its next statement in
whatever frame, `over` to the next of this frame or one it returns to,
`out` to the next of the frame it returns to, or `continue`, the
default, to a breakpoint. `interrupt` pauses the running target at its
next statement.

## ERRORS

| SQLSTATE | SQLCODE | When |
|---|---|---|
| 08003 | -919 | `attach` of an ID of no connection served, or one this user may not see |
| 42000 | -104 | A breakpoint in a routine this user neither owns nor holds DEBUG on |
| TBD01 | -910 | An action the target's state does not allow: `resume` of a target not paused, a second `attach`, or any but `id` and `attach` of a debugger attached to none |
| 08006 | -919 | `debugger` not granted, refused before it is sent, the connection kept; the connection lost |

After each but a connection lost, the session goes on.

## EXAMPLES

```js
import { Trust, connectTo, tcp } from 'turborel';

const target = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
await target.query(`CREATE PROCEDURE DOUBLED(IN X INTEGER, OUT Y INTEGER) CONTAINS SQL
BEGIN
  DECLARE N INTEGER DEFAULT 2;
  SET Y = X * N;
END`);
await target.query('COMMIT');
const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
await conn.debugger.attach(await target.debugger.id());
const set = await conn.debugger.break({ name: 'DOUBLED' }, 4);
const call = await target.prepare('CALL DOUBLED(?, ?)');
const ran = target.execute(call, [21n]);
const event = await conn.debugger.wait(10_000);
const frame = event.paused.frames.at(-1);
console.log(event.what, event.paused.breakpoint === set.number, frame.line);
console.log([...frame.parameters, ...frame.variables].map((n) => `${n.name} ${n.value}`));
await conn.debugger.resume();
console.log((await ran).rows);
await conn.debugger.detach();
await conn.terminate();
await target.terminate();
// paused true 4
// [ 'X 21', 'Y null', 'N 2' ]
// [ [ 42n ] ]
```

## SEE ALSO

[Connections](21-connections.md), [Statements and Cursors](22-statements.md),
[Debugging Routines](../user/11-debugging.md)
