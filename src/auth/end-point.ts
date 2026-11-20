/**
 * The channel binding `tls-server-end-point` [RFC 5929 §4]: the hash of
 * the server's certificate by a hash its signature algorithm chooses, as
 * turborel-protocol's `scram/binding.rs` computes it. A signature of MD5
 * or SHA-1 is bound by SHA-256; of SHA-256, SHA-384 or SHA-512, by that;
 * of no hash, as Ed25519's, of two, as RSASSA-PSS of a mask hash not its
 * message hash, or of an algorithm not known, there is none. Internal.
 *
 * @packageDocumentation
 */

import { createHash } from 'node:crypto';

/** The DER tags read: a SEQUENCE, an OBJECT IDENTIFIER, and RSASSA-PSS-params' [0] and [1]. */
const SEQUENCE = 0x30;
const OID = 0x06;
const PSS_HASH = 0xa0;
const PSS_MASK = 0xa1;

/** A DER length of more than one octet: the low bits count the octets that follow [X.690 §8.1.3.5]. */
const LONG_FORM = 0x80;

/** The most octets of a long-form length read: four, past any certificate's size. */
const MAX_LENGTH_OCTETS = 4;

/** The octets of a tag and a short-form length, before an element's body or its long-form length. */
const HEAD = 2;

/** The bits of an octet. */
const OCTET = 8;

/**
 * The object identifiers' bodies, without tag and length [X.690 §8.19]:
 * pkcs-1 1.2.840.113549.1.1 [RFC 4055 §6], id-ecSigType 1.2.840.10045.4
 * [RFC 3279 §2.2.3], hashalgs 2.16.840.1.101.3.4.2 [RFC 4055 §2.1], SHA-1
 * 1.3.14.3.2.26.
 */
const PKCS1 = '2a864886f70d0101';
const ECDSA = '2a8648ce3d04';
const HASHALGS = '6086480165030402';
const MGF1 = `${PKCS1}08`;
const RSA_PSS = `${PKCS1}0a`;
const SHA1 = '2b0e03021a';

/** The hash each signature algorithm binds by. */
const SIGNATURES: ReadonlyMap<string, string> = new Map([
  [`${PKCS1}04`, 'sha256'],
  [`${PKCS1}05`, 'sha256'],
  [`${PKCS1}0b`, 'sha256'],
  [`${PKCS1}0c`, 'sha384'],
  [`${PKCS1}0d`, 'sha512'],
  [`${ECDSA}01`, 'sha256'],
  [`${ECDSA}0302`, 'sha256'],
  [`${ECDSA}0303`, 'sha384'],
  [`${ECDSA}0304`, 'sha512'],
]);

/** The binding hash of each RSASSA-PSS hash. */
const HASHES: ReadonlyMap<string, string> = new Map([
  [SHA1, 'sha256'],
  [`${HASHALGS}01`, 'sha256'],
  [`${HASHALGS}02`, 'sha384'],
  [`${HASHALGS}03`, 'sha512'],
]);

/** A DER element read: its body, and what follows it. */
type Read = readonly [body: Uint8Array, rest: Uint8Array];

/**
 * The element of tag `tag` that `der` begins with.
 *
 * @param der - the octets
 * @param tag - the tag expected
 * @returns its body and what follows, or undefined if it is not there whole
 */
function expect(der: Uint8Array, tag: number): Read | undefined {
  if (der[0] !== tag || der.byteLength < HEAD) return undefined;
  const first = der[1] ?? 0;
  let length = first;
  let at = HEAD;
  if (first >= LONG_FORM) {
    const octets = first - LONG_FORM;
    if (octets === 0 || octets > MAX_LENGTH_OCTETS || der.byteLength < HEAD + octets) return undefined;
    length = 0;
    for (const b of der.subarray(HEAD, HEAD + octets)) length = length * (1 << OCTET) + b;
    at = HEAD + octets;
  }
  if (at + length > der.byteLength) return undefined;
  return [der.subarray(at, at + length), der.subarray(at + length)];
}

/**
 * The hexadecimal text of `bytes`.
 *
 * @param bytes - the bytes
 * @returns their hex
 */
function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/**
 * An AlgorithmIdentifier's object identifier and parameters.
 *
 * @param der - the octets it begins
 * @returns its OID's hex and its parameters, or undefined
 */
function identifier(der: Uint8Array): readonly [string, Uint8Array] | undefined {
  const sequence = expect(der, SEQUENCE);
  const oid = sequence === undefined ? undefined : expect(sequence[0], OID);
  return oid === undefined ? undefined : [hex(oid[0]), oid[1]];
}

/**
 * The binding hash of RSASSA-PSS parameters: their one hash, SHA-1 by default, if the mask's is the same.
 *
 * @param parameters - RSASSA-PSS-params
 * @returns the hash's name, or undefined
 */
function pss(parameters: Uint8Array): string | undefined {
  const sequence = expect(parameters, SEQUENCE);
  if (sequence === undefined) return undefined;
  let fields = sequence[0];
  let hash = SHA1;
  const explicitHash = expect(fields, PSS_HASH);
  if (explicitHash !== undefined) {
    const id = identifier(explicitHash[0]);
    if (id === undefined) return undefined;
    [hash, fields] = [id[0], explicitHash[1]];
  }
  let mask = SHA1;
  const explicitMask = expect(fields, PSS_MASK);
  if (explicitMask !== undefined) {
    const fn = identifier(explicitMask[0]);
    const of = fn === undefined ? undefined : identifier(fn[1]);
    if (fn?.[0] !== MGF1 || of === undefined) return undefined;
    mask = of[0];
  }
  return hash === mask ? HASHES.get(hash) : undefined;
}

/**
 * The `tls-server-end-point` binding of a certificate.
 *
 * @param certificate - the certificate, as DER
 * @returns its hash by the hash its signature chooses, or undefined if it defines none
 */
export function endPoint(certificate: Uint8Array): Uint8Array | undefined {
  const outer = expect(certificate, SEQUENCE);
  const tbs = outer === undefined ? undefined : expect(outer[0], SEQUENCE);
  const algorithm = tbs === undefined ? undefined : identifier(tbs[1]);
  if (algorithm === undefined) return undefined;
  const hash = algorithm[0] === RSA_PSS ? pss(algorithm[1]) : SIGNATURES.get(algorithm[0]);
  return hash === undefined ? undefined : new Uint8Array(createHash(hash).update(certificate).digest());
}
