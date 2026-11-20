# Security

Report a vulnerability privately, never in a public issue: on the
repository's **Security** tab, choose **Report a vulnerability**. Only the
maintainers see the report.

What counts, for a driver:

- TLS not used, or the server's certificate not verified, where the
  program asked for it, as by `tls_mode` `require`, `verify-ca` or
  `verify-full`, or channel binding not done where `channel_binding` is
  `require`;
- a password, a SCRAM key or anything else derived from a password, or a
  session's cancel key, disclosed: sent where it should not go, as a
  password over plain TCP, or written to an error, a log or a stack;
- a server's reply, or a file the driver reads, such as the service file
  or the password file, that can crash the program, run code in it, or
  make it take memory without bound.

A wrong value, a hang or a crash that no attacker can bring about is a
bug: report it with the **Bug** form, its impact in the title
(CONTRIBUTING.md, Reporting issues). A vulnerability of the server is
reported in [turborel](https://github.com/turborel/turborel)'s own
repository.

Say in the report:

- what an attacker needs, such as a server of their own, a place on the
  network between the program and the server, or a file the driver reads;
- what they gain;
- the commit you tested (`git rev-parse --short=12 HEAD`), and the
  Node.js version;
- the smallest steps that show it.

You will hear back within a week. The fix is made in private and
published with an advisory that credits you, unless you ask not to be
named.
