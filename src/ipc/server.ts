import net from 'net';
import { EventEmitter } from 'events';
import { MessageFramer, isRequest } from './protocol.js';
import { RpcEvent, RpcRequest, RpcResponse } from '../core/types.js';

export type RpcHandler = (
  method: string,
  params: unknown,
  conn: IpcConnection
) => Promise<unknown>;

/** Represents one connected CLI client. */
export class IpcConnection extends EventEmitter {
  private framer = new MessageFramer();
  private _streaming = false;

  constructor(private socket: net.Socket) {
    super();
    socket.on('data', (chunk: Buffer) => {
      this.framer.feed(chunk, (msg) => {
        if (isRequest(msg)) {
          this.emit('request', msg as RpcRequest);
        }
      });
    });
    socket.on('close', () => this.emit('close'));
    socket.on('error', (err) => this.emit('error', err));
  }

  send(msg: RpcResponse | RpcEvent): void {
    if (this.socket.destroyed) return;
    try {
      this.socket.write(MessageFramer.encode(msg));
    } catch {
      // connection gone
    }
  }

  get streaming(): boolean {
    return this._streaming;
  }

  markStreaming(): void {
    this._streaming = true;
  }

  close(): void {
    this.socket.destroy();
  }

  get remoteInfo(): string {
    return `${this.socket.remoteAddress ?? 'unix'}:${this.socket.remotePort ?? ''}`;
  }
}

/** Daemon-side IPC server. */
export class IpcServer extends EventEmitter {
  private server: net.Server;
  private connections = new Set<IpcConnection>();

  constructor(private socketPath: string) {
    super();
    this.server = net.createServer((socket) => {
      const conn = new IpcConnection(socket);
      this.connections.add(conn);

      conn.on('request', (req: RpcRequest) => {
        this.emit('request', req, conn);
      });

      conn.on('close', () => {
        this.connections.delete(conn);
        this.emit('disconnect', conn);
      });

      conn.on('error', () => {
        this.connections.delete(conn);
      });

      this.emit('connect', conn);
    });
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.socketPath, () => {
        this.server.removeListener('error', reject);
        resolve();
      });
    });
  }

  /** Broadcast an event to all currently-streaming connections. */
  broadcast(event: RpcEvent): void {
    for (const conn of this.connections) {
      if (conn.streaming) {
        conn.send(event);
      }
    }
  }

  /** Broadcast to all connections (e.g. process status changes). */
  broadcastAll(event: RpcEvent): void {
    for (const conn of this.connections) {
      conn.send(event);
    }
  }

  close(): Promise<void> {
    for (const conn of this.connections) conn.close();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}
