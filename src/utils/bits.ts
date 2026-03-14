const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const CHAR_MAP = new Map<string, number>(CHARS.split('').map((c, i) => [c, i]));

export class BitWriter {
  private buf: number[] = [];
  private cur = 0;
  private bits = 0;

  write(value: number, numBits: number): void {
    // Mask to numBits
    const masked = value & ((1 << numBits) - 1);
    this.cur = (this.cur << numBits) | masked;
    this.bits += numBits;
    while (this.bits >= 6) {
      this.bits -= 6;
      this.buf.push((this.cur >> this.bits) & 0x3f);
    }
  }

  flush(): string {
    if (this.bits > 0) {
      this.buf.push((this.cur << (6 - this.bits)) & 0x3f);
    }
    return this.buf.map(b => CHARS[b]).join('');
  }
}

export class BitReader {
  private pos = 0;  // current char index
  private cur = 0;
  private bits = 0; // bits available in cur

  constructor(private readonly encoded: string) {}

  read(numBits: number): number {
    while (this.bits < numBits) {
      if (this.pos >= this.encoded.length) break;
      const val = CHAR_MAP.get(this.encoded[this.pos++]) ?? 0;
      this.cur = (this.cur << 6) | val;
      this.bits += 6;
    }
    this.bits -= numBits;
    return (this.cur >> this.bits) & ((1 << numBits) - 1);
  }

  get done(): boolean {
    return this.pos >= this.encoded.length && this.bits === 0;
  }
}
