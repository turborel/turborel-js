/**
 * A scripted server on loopback (RULES.md R-TEST-5): each connection
 * handed to a script that reads the client's frames and sends replies,
 * so a test sets out a conversation byte for byte. Shared by the session
 * tests (R-TEST-7).
 */

import { type Server, type Socket, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { encodeFrame } from '../../src/codec/frame.js';
import { REPLY } from '../../src/codec/kinds.js';
import { Writer } from '../../src/codec/writer.js';
import { type Frame, FrameStream } from '../../src/transport/frames.js';
import { type Target, local, tcp } from '../../src/transport/target.js';
import { type Column, writeFailure, writeRow } from '../../src/codec/composite.js';
import { writeColumns } from '../../src/codec/declared.js';
import { MORE, writeMark } from '../../src/codec/tail.js';
import type { Value } from '../../src/codec/values.js';
import type { TurborelError } from '../../src/error.js';

/** How many local sockets this process has made, so each has a name of its own. */
let made = 0;

/** The longest body a scripted server reads. */
const MAX = 16_777_216;

/** One client's connection, as a script sees it. */
export class Peer {
  /** The client's socket. */
  readonly socket: Socket;
  readonly #frames: FrameStream;

  /** @param socket - the client's socket */
  constructor(socket: Socket) {
    this.socket = socket;
    this.#frames = new FrameStream(socket);
  }

  /** @returns the client's next frame */
  frame(): Promise<Frame> {
    return this.#frames.next(MAX, undefined);
  }

  /**
   * Sends bytes as they are.
   *
   * @param bytes - frames
   */
  send(bytes: Uint8Array): void {
    this.socket.write(bytes);
  }

  /**
   * Sends a reply of `letter`'s kind and the body `write` writes.
   *
   * @param letter - the reply's kind
   * @param write - writes its body
   */
  reply(letter: string, write: (w: Writer) => void = () => undefined): void {
    const w = new Writer();
    write(w);
    this.send(encodeFrame(letter.charCodeAt(0), w.finish()));
  }

  /**
   * Sends Ready.
   *
   * @param granted - the capabilities granted
   * @param authorization - the session's authorization
   */
  ready(granted: readonly string[] = [], authorization = 'ANN'): void {
    this.reply(String.fromCharCode(REPLY.READY), (w) => {
      w.string(authorization).key(new Uint8Array(16).fill(7)).strings(granted).string('turborel 0.0.0 (alpha)');
    });
  }

  /**
   * Sends Complete: SQLCODE, SQLSTATE and active, and the tail's `more`.
   *
   * @param done - its fields, SQLCODE 0, SQLSTATE 00000, no transaction active and no more by default
   */
  complete(done: { sqlcode?: number; sqlstate?: string; active?: boolean; more?: boolean } = {}): void {
    this.reply('K', (w) => {
      w.i32(done.sqlcode ?? 0)
        .string(done.sqlstate ?? '00000')
        .flag(done.active ?? false);
      writeMark(w, MORE, done.more ?? false);
    });
  }

  /**
   * Sends Description.
   *
   * @param columns - the columns
   */
  description(columns: readonly Column[]): void {
    this.reply('D', (w) => {
      writeColumns(w, columns);
    });
  }

  /**
   * Sends Rows.
   *
   * @param rows - the rows
   */
  rows(rows: readonly (readonly Value[])[]): void {
    this.reply('B', (w) => {
      w.u32(rows.length);
      for (const r of rows) writeRow(w, r);
    });
  }

  /**
   * Sends Error.
   *
   * @param failure - the failure
   */
  error(failure: TurborelError): void {
    this.reply('E', (w) => {
      writeFailure(w, failure);
    });
  }

  /** Closes the connection. */
  end(): void {
    this.socket.end();
  }
}

/** A scripted server, listening. */
export interface Scripted {
  /** Where it listens. */
  readonly target: Target;
  /** Every connection's peer, in order. */
  readonly peers: Peer[];
  /** Stops it, its connections destroyed. */
  close(): Promise<void>;
}

/**
 * Listens at `server` on `where`, as `listen` does.
 *
 * @param server - the server
 * @param where - a port of loopback, or a path
 * @returns once it listens
 */
function listening(server: Server, where: { port: number; host: string } | { path: string }): Promise<void> {
  return new Promise((resolve) => {
    server.listen(where, () => {
      resolve();
    });
  });
}

/**
 * A server on loopback, or at a local socket, running `script` for each connection.
 *
 * @param script - what each connection is answered with
 * @param at - where it listens: TCP on loopback, or a local socket
 * @returns the server
 */
export async function scripted(script: (peer: Peer) => Promise<void>, at: 'tcp' | 'local' = 'tcp'): Promise<Scripted> {
  const peers: Peer[] = [];
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    const peer = new Peer(socket);
    peers.push(peer);
    script(peer).catch(() => {
      socket.destroy();
    });
  });
  let target: Target;
  if (at === 'local') {
    made += 1;
    const name = `turborel-js-${String(process.pid)}-${String(made)}`;
    const path = process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `${name}.sock`);
    await listening(server, { path });
    target = local(path);
  } else {
    await listening(server, { port: 0, host: '127.0.0.1' });
    const address = server.address();
    target = tcp('127.0.0.1', typeof address === 'object' && address !== null ? address.port : 0);
  }
  return {
    target,
    peers,
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => {
          resolve();
        });
      }),
  };
}
