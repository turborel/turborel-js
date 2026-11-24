# Debugging Routines

[Contents](README.md)

*(extension)* A procedure, a function or a trigger written in SQL can be
run under a debugger: another connection, of the same user, attached to
the session that runs it. This chapter tells how a program debugs one.
The debugger sees into, and pauses in, only the routines its user owns
or holds DEBUG on; turborel's own manual tells who may debug what, and
how a pause ends by itself.

## Attaching and pausing

The session to debug gives its connection's ID with
`conn.debugger.id()`, and the debugger's connection attaches to it with
`debugger.attach(id)`. `debugger.break(routine, line)` sets a
breakpoint at a line of a routine's text, a procedure's unless told,
with an optional condition. The target runs its statements as ever;
when one comes to a breakpoint, it pauses, and its statement completes
only once the debugger lets it go on.

`debugger.wait(timeout)` gives the next thing the target did, waiting
at most `timeout` milliseconds: a pause, with its call stack, each
frame's line and column, parameters, variables and cursors, or a pause
that timed out, a cancel, or the target's end. It gives nothing if the
time runs out, and the connection goes on.

```js
import { Trust, connectTo, tcp } from 'turborel';

const target = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
await target.query(`CREATE PROCEDURE COUNTDOWN(IN FROM_N INTEGER) CONTAINS SQL
BEGIN
  DECLARE N INTEGER DEFAULT 0;
  SET N = FROM_N;
  SET N = N - 1;
END`);
await target.query('COMMIT');
const conn = await connectTo(tcp('127.0.0.1', 7422), 'ann', new Trust());
const debug = conn.debugger;
await debug.attach(await target.debugger.id());
await debug.break({ name: 'COUNTDOWN' }, 4);
const ran = target.query('CALL COUNTDOWN(3)');
let event = await debug.wait(10_000);
console.log(event.what, event.paused.frames.at(-1).line);
await debug.resume('over');
event = await debug.wait(10_000);
const frame = event.paused.frames.at(-1);
console.log(event.paused.reason, frame.line, frame.variables.map((v) => `${v.name} = ${v.value}`));
await debug.resume('continue');
console.log((await ran).kind);
await debug.detach();
await conn.terminate();
await target.terminate();
// paused 4
// step 5 [ 'N = 3' ]
// done
```

## Going on

`debugger.resume(action)` lets the paused target go on: `'into'` its
next statement, in a routine it invokes too; `'over'` to the next
statement of the same frame, or of the one it returns to; `'out'` to the
next statement of the frame it returns to; or `'continue'`, the
default, to a breakpoint. `debugger.interrupt()` pauses a running
target at its next statement, and `debugger.stack()` gives a paused
target's frames again. `debugger.breakpoints()` lists the breakpoints
and `debugger.clear(number)` clears one. `debugger.detach()` ends the
debugging, and the target goes on as if never debugged.

A request the target's state does not allow, as resuming a target not
paused, fails with SQLSTATE TBD01, a breakpoint in a routine its user
may not debug with 42000, and an ID of no connection it may see with
08003; the debugger's session goes on after each
([The Routine Debugger](../client/31-debugging.md)).
