# Settings

[Contents](README.md)

## NAME

`Settings`, `Options`, `role`, `modeConfig`: connecting as settings
say, to one of several servers.

## SYNOPSIS

```ts
class Options {
  set(key: string, value: string): this;
  get(key: Key): string | undefined;
  readonly isEmpty: boolean;
  over(lower: Options): Options;
  static environment(variable: (name: string) => string | undefined): Options;
  static fromUri(uri: string): Options;
}

class Settings {
  static resolve(explicit?: Options): Settings;
  static resolveIn(explicit: Options, variable: (name: string) => string | undefined): Settings;
  static fromUri(uri: string): Settings;
  readonly hosts: readonly Host[];
  readonly user: string;
  readonly tlsMode: 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';
  readonly channelBinding: 'disable' | 'prefer' | 'require';
  readonly applicationName: string | undefined;
  readonly connectTimeout: number | undefined;
  readonly passfile: string;
  readonly target: 'any' | 'read-write' | 'read-only';
  readonly loadBalance: 'disable' | 'random';
  readonly tls: TlsFiles;
  readonly keyCache: KeyCache;
  passwordFor(host: Host): string | undefined;
  connect(): Promise<Connection>;
}

type Host = { kind: 'tcp'; name: string; port: number } | { kind: 'local'; path: string };
function serviceFile(file: string, name: string): Options;
function role(conn: Connection): Promise<'read-write' | 'read-only' | 'unknown'>;
function modeConfig(mode: TlsMode, files: TlsFiles): TlsConfig | undefined;
```

## DESCRIPTION

`Options` is a layer of settings, each by its name ([Appendix
C](../appendix/c-settings.md)); `over` lays one over another;
`environment` reads the TURBOREL_ variables; `fromUri` reads a
`turborel://` URI; `serviceFile` reads a service file's section. `Settings.resolve` lays the program's options, then
the service file's section they or the environment name, then the
environment, then the defaults, and reads them. `passwordFor` gives the
settings' password, else the password file's for a server.

`connect` tries each host, in order or at random, each address its name
resolves to, over TLS as `tlsMode` says, each step within
`connectTimeout` milliseconds; it proves the user by SCRAM with a
password, else by the certificate named, else by trust, binding SCRAM
as `channelBinding` says, and asks for every capability but
compression, and the attribute `application` if `applicationName` is
set. A server whose role is not `target` is left. `role` gives the role
a connection's session sees: by its SERVER_READ_ONLY status, else by
INFORMATION_SCHEMA.REPLICAS. `modeConfig` gives the TLS of a mode.

## ERRORS

| SQLSTATE | SQLCODE | When |
|---|---|---|
| 08001 | -919 | A setting that cannot be read; a service file that cannot be read, or has no section of the name; no user named; no server kept of several, each named and why; a server not of the role asked |
| 28000 | -919 | A password over plain TCP; channel binding required that cannot be; no server kept, the last refusing the user |
| 08006 | -919 | A server not reached, or not in time; a TLS handshake that failed; no authority trusted for `verify-ca` or `verify-full`; a certificate named without its key, or a file that cannot be read |

Of one server tried, its own failure is given.

## EXAMPLES

```js
import { Settings } from 'turborel';

const settings = Settings.fromUri('turborel://ann@127.0.0.1:7422/?tls_mode=require&application_name=reports');
const conn = await settings.connect();
console.log(conn.server, conn.authorization, conn.target.kind);
await conn.terminate();
// turborel 0.0.0 (alpha) ANN tls
```

## SEE ALSO

[Settings](../user/09-settings.md), [Appendix C](../appendix/c-settings.md),
[Connections](21-connections.md)
