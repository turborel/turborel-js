/**
 * turborel, the JavaScript driver for turborel, a relational database
 * system.
 *
 * @remarks
 * The driver speaks turborel's native protocol, version 1, itself, in
 * TypeScript compiled to JavaScript, on Node.js 22.12 or later, with no
 * runtime dependency beyond Node.js's own modules (RULES.md D1, D3, D10).
 * Browsers cannot open a TCP connection and are not served.
 *
 * This is the alpha, version 0.0.0, the number of the turborel release it
 * is made for. Its Promise-based API of connections, queries, prepared
 * statements, cursors as async iterators and pools (RULES.md D2) is built
 * milestone by milestone. Until then it exports its error type and the
 * types its values are read as.
 *
 * @packageDocumentation
 */

export { TurborelError } from './error.js';
export type { Diagnostics, TurborelErrorOptions } from './error.js';
export { Decimal } from './codec/decimal.js';
export { DecFloat } from './codec/decfloat.js';
export type {
  CharUnits,
  DataType,
  IntervalField,
  Qualifier,
  RowField,
  StructuredName,
  TypeName,
  XmlSchemaName,
} from './codec/types.js';
