# Appendix B: Errors

[Contents](README.md)

Every failure reaches a program as a `TurborelError`, of an SQLCODE and
an SQLSTATE: the server's, as it sends them, or the driver's own, which
are turborel's codes for the same failure, as turborel-client gives
them. An SQLSTATE's first two characters are its class. Turborel's own
Appendix A, SQLSTATE and SQLCODE, lists every one the server sends.

## The classes a program sees

| Class | Means | How it comes |
|---|---|---|
| 00 | Successful completion | A completion's `sqlstate`, no failure |
| 01 | Warning | A completion's `sqlstate` and `warning`, and its `conditions`, or a notice |
| 02 | No data | A completion's `sqlstate`, 02000, of a statement that found no row |
| 07 | Dynamic SQL error | A failure of `execute` or `openCursor`, as 07001 for values not one for each parameter |
| 08 | Connection exception | A failure that loses the connection, but 08003 |
| 0A | Feature not supported | A failure, the server's or the driver's for a value past turborel's limits |
| 22 | Data exception | A failure of a value, the server's, or the driver's for a value the protocol cannot carry |
| 23 | Integrity constraint violation | A statement's failure, its diagnostics naming the constraint |
| 24 | Invalid cursor state | A cursor opened again, or fetched or closed when not open |
| 26 | Invalid SQL statement name | A prepared statement deallocated, or never prepared |
| 28 | Invalid authorization specification | Credentials refused, which lose a connection being made or changing user |
| 2A | Syntax error or access rule violation | A statement the server cannot read, or names what is not there |
| 40 | Transaction rollback | A commit that failed, the transaction rolled back, as 40002 |
| TB | turborel's own | As TB910, an argument the driver does not take, and TB920, a statement cancelled |

## The failures the driver raises

| SQLSTATE | SQLCODE | When |
|---|---|---|
| 08006 | -919 | No connection made, in time; a wait that ran out; a message that cannot be read; a reply out of turn; a request of a capability not granted, refused before it is sent |
| 28000 | -919 | A password or SCRAM over plain TCP, refused before connecting; a SCRAM exchange whose server did not prove itself |
| 2200N | -301 | An XML value's text, read for its nodes, that is not well-formed XML content |
| 22003 | -301 | A number past what the protocol carries |
| 22021 | -301 | A string holding a lone surrogate |
| 0A000 | -900 | A value past turborel's limits, as a JSON value nested past 128 levels |
| TB910 | -910 | An argument of a type or range the driver does not take |

## The failures that end the connection

A connection takes nothing more after a failure of class 08 other than
08003, which names another connection, and after credentials refused
(SQLCODE -919, class 28) as the connection is made or its user changed;
`isLost` then says so, and every request fails with the failure that
lost it. A statement's failure, of severity ERROR, leaves the session
going on, its `active` saying whether its transaction is still active.

## The server's own SQLSTATEs of the protocol

| SQLSTATE | SQLCODE | Means |
|---|---|---|
| 01T01 | none: a notice | Reset or ChangeUser rolled back the transaction that was active: a notice, of severity NOTICE |
| TB920 | -920 | The statement was cancelled |
| TBR01 | -920 | A replica had not applied the position of REPLICATION.READ_AFTER in time; the statement fails, the connection goes on |
