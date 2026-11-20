# Versioning

How turborel-js is numbered, what the alpha promises, and how it is
published.

[The version](#the-version) · [Alpha](#alpha) ·
[The protocol](#the-protocol) · [Where the version is](#where-the-version-is) ·
[Publishing](#publishing)

---

## The version

turborel-js has no version scheme of its own. Its version is the number
of the turborel release it is made for, the same number as the server's
(RULES.md D8). A turborel release and each driver's release share that
number, so a program pairs a driver with a server of the same number,
and turborel's
[VERSIONING.md](https://github.com/turborel/turborel/blob/main/VERSIONING.md)
says what each kind of release may change.

## Alpha

turborel is in alpha, version **0.0.0**, and so is turborel-js. While the
version is 0.y.z nothing is promised: the driver's API, its behaviour and
what it needs may change in any build. The first stable release is
turborel's 1.0.0, and the driver's with it.

## The protocol

The alpha speaks turborel's native protocol, version **1**
(`doc/client/05-protocol.md` in turborel), the only version. The protocol
grows by capabilities, which a client asks for and a server grants, never
by a new version, so the driver asks for those it knows and uses only
those granted.

## Where the version is

- `package.json`'s `version`, `0.0.0`.
- The server's product, as Ready tells it, `turborel 0.0.0 (alpha)`, is
  the release a connection's server is of.

## Publishing

The package is published to [npm](https://www.npmjs.com) as `turborel`.
Nothing is published until every turborel driver is done, and then the
owner publishes them together, each at the release's number. The
publishing is the owner's alone; no contributor or workflow publishes.

`.github/workflows/release.yml` runs only by hand. From a pushed commit
it runs every check and coverage, packs the package, installs the packed
file into an empty project and loads it by `import` and by `require`, and
keeps the file. Its publish step, `npm publish --provenance --access
public`, is written but disabled. When the time comes, the owner:

1. signs in to npmjs.com with an account in the organization that holds
   the name `turborel`, and sets this repository's `release.yml` as the
   package's trusted publisher;
2. sets `version` in `package.json` to the release's number, in a
   reviewed commit;
3. enables the publish step, giving its job the permission
   `id-token: write`, and runs the workflow on that commit.

The package carries its compiled code with declarations, `LICENSE`,
`README.md` and `package.json`, nothing else (`files` in
`package.json`). A version published can be deprecated but not
published again, so a fix is a new release.
