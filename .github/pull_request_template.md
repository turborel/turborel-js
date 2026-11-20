<!--
This description is the series' cover letter (CONTRIBUTING.md, Pull
requests). Each commit message still stands alone, in Linux's form.
Base the series on main, keep it rebased, and on revising say what
changed in a comment, not here.
-->

## What and why

<!-- The problem and its impact, then the approach and the choices made.
Link the issue: "Closes #N". -->

## The series

<!-- One line per commit, in order: what it does. Each passes
`npm run verify` on its own. -->

1.

## Testing

<!-- The tests added and what each verifies, by the section it cites
([PROTOCOL Frames], [CLIENT Pipelines], [DESIGN] D<n>). For a change to
what goes over the wire, the server it was tried against. -->

- [ ] `npm run verify` passes
- [ ] `npm run coverage` passes, at or above the floor in `.c8rc.json`

## Compatibility

<!-- What changes for a program that uses the driver, and what a server
sees; "none" if nothing changes. -->

## Performance

<!-- If the change claims any: what was measured, before and after, with
the numbers. Otherwise "none claimed". -->

## Checklist (RULES.md §7)

- [ ] One logical change per commit, each passing `npm run verify`
- [ ] Each test cites what it verifies (R-TRACE-1); a failing-first test for a fix (R-TEST-6)
- [ ] Every failure a `TurborelError`; no uncaught exception, unhandled rejection or `process.exit` (R-ERR, R-ASYNC)
- [ ] No magic numbers; protocol tags named constants (R-CONST); public items documented in TSDoc (R-DOC-1)
- [ ] Every length a server sends bounded, no secret disclosed (R-SAFE)
- [ ] No new dependency without a decision (R-DEP-1)
- [ ] CONFORMANCE.md, RULES.md, TODO.md and doc/ updated where they change
