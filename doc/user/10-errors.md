# Errors

[Contents](README.md)

What a program sees when something fails: a `TurborelError`, with its SQLCODE, SQLSTATE, message, the rule it cites and whether a transaction is still active, and, as the server gives them, notices, conditions and diagnostics. The error type exists today ([TurborelError](../client/06-turborel-error.md)); milestone M3 fills this chapter as statements come to fail.
