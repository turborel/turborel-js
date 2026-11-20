# Appendix B: Errors

[Contents](README.md)

Each SQLSTATE class, what it means to a program, and how the driver raises it: always as a `TurborelError`, with the SQLCODE and SQLSTATE turborel-client gives for the same failure. Milestone M1 adds the connection failures the codec raises, and milestone M3 the rest.
