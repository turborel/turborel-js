# Appendix D: Versions

[Contents](README.md)

turborel-js has no version scheme of its own. Its version is the number
of the turborel release it is made for, the same as the server's, so a
program uses a driver and a server of the same number
([VERSIONING.md](../../VERSIONING.md)).

| Driver | turborel release | Protocol |
|---|---|---|
| 0.0.0, alpha | 0.0.0, alpha | version 1 |

The alpha speaks turborel's native protocol, version 1, the only
version. The protocol grows by capabilities a client asks for and a
server grants, never by a new version, so the driver uses only what a
server grants. While the version is 0.0.0, anything may change from one
build to the next.
