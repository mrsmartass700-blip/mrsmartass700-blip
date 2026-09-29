// Минимальный WebSocket-сервер (RFC 6455) без внешних зависимостей.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 1 << 20;

export function attachWebSocket(httpServer, path, onConnection) {
  httpServer.on('upgrade', (req, socket) => {
    const url = (req.url || '').split('?')[0];
    const key = req.headers['sec-websocket-key'];
    if (url !== path || (req.headers.upgrade || '').toLowerCase() !== 'websocket' || !key) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);
    onConnection(new WSConnection(socket), req);
  });
}

export class WSConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = null;
    this.open = true;
    this.remoteAddress = socket.remoteAddress;
    socket.on('data', (d) => { this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d; this._parse(); });
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
    socket.setTimeout(30000, () => socket.destroy()); // клиент шлёт данные постоянно
  }

  _closed() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }

  _parse() {
    while (this.open) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_PAYLOAD) { this.close(1009); return; }
      let mask = null;
      if (masked) { if (b.length < off + 4) return; mask = b.subarray(off, off + 4); off += 4; }
      if (b.length < off + len) return;
      const payload = Buffer.from(b.subarray(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + len);

      if (op === 0x8) { this.close(1000); return; }
      if (op === 0x9) { this._frame(0xA, payload); continue; }
      if (op === 0xA) continue;
      if (op === 0x0) {
        if (!this.frags) continue;
        this.frags.push(payload);
        if (fin) { const m = Buffer.concat(this.frags); this.frags = null; this.emit('message', m.toString('utf8')); }
        continue;
      }
      if (op === 0x1 || op === 0x2) {
        if (fin) this.emit('message', payload.toString('utf8'));
        else this.frags = [payload];
      }
    }
  }

  _frame(op, data) {
    if (!this.open) return;
    const len = data.length;
    let header;
    if (len < 126) { header = Buffer.from([0x80 | op, len]); }
    else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | op; header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x80 | op; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
    try { this.socket.write(Buffer.concat([header, data])); } catch { this._closed(); }
  }

  send(text) { this._frame(0x1, Buffer.from(text, 'utf8')); }

  close(code = 1000) {
    if (!this.open) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code, 0);
    this._frame(0x8, p);
    this.open = false;
    this.socket.end();
    this.emit('close');
  }
}
