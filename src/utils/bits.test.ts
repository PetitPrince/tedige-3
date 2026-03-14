import { describe, it, expect } from 'vitest';
import { BitWriter, BitReader } from './bits';

function roundTrip(fields: { value: number; bits: number }[]): number[] {
  const w = new BitWriter();
  for (const { value, bits } of fields) w.write(value, bits);
  const encoded = w.flush();
  const r = new BitReader(encoded);
  return fields.map(({ bits }) => r.read(bits));
}

describe('BitWriter / BitReader round-trip', () => {
  it('1-bit values: 0 and 1', () => {
    expect(roundTrip([{ value: 0, bits: 1 }, { value: 1, bits: 1 }])).toEqual([0, 1]);
  });

  it('4-bit boundary values: 0 and 15', () => {
    expect(roundTrip([{ value: 0, bits: 4 }, { value: 15, bits: 4 }])).toEqual([0, 15]);
  });

  it('8-bit boundary values: 0 and 255', () => {
    expect(roundTrip([{ value: 0, bits: 8 }, { value: 255, bits: 8 }])).toEqual([0, 255]);
  });

  it('12-bit boundary values: 0 and 4095', () => {
    expect(roundTrip([{ value: 0, bits: 12 }, { value: 4095, bits: 12 }])).toEqual([0, 4095]);
  });

  it('6-bit boundary: max value 63', () => {
    expect(roundTrip([{ value: 63, bits: 6 }])).toEqual([63]);
  });

  it('multi-field pack/unpack in order', () => {
    const fields = [
      { value: 1,   bits: 4 },
      { value: 7,   bits: 3 },
      { value: 255, bits: 8 },
      { value: 0,   bits: 2 },
      { value: 3,   bits: 2 },
    ];
    expect(roundTrip(fields)).toEqual([1, 7, 255, 0, 3]);
  });

  it('boundary value 0 for multiple widths', () => {
    expect(roundTrip([
      { value: 0, bits: 1 },
      { value: 0, bits: 4 },
      { value: 0, bits: 8 },
    ])).toEqual([0, 0, 0]);
  });

  it('flush pads partial final char and data is recovered correctly', () => {
    // Write 3 bits — will be left-padded in the 6-bit char on flush
    const w = new BitWriter();
    w.write(5, 3); // 0b101
    const encoded = w.flush();
    expect(encoded).toHaveLength(1);
    const r = new BitReader(encoded);
    expect(r.read(3)).toBe(5);
  });

  it('BitReader.done is true after consuming exactly all written bits', () => {
    // 6 bits → exactly 1 base-64 char, no padding
    const w = new BitWriter();
    w.write(42, 6);
    const encoded = w.flush();
    const r = new BitReader(encoded);
    r.read(6);
    expect(r.done).toBe(true);
  });

  it('BitReader.done is false when chars remain unread', () => {
    const w = new BitWriter();
    w.write(42, 6);
    w.write(1, 6);
    const encoded = w.flush();
    const r = new BitReader(encoded);
    r.read(6); // only consume first char
    expect(r.done).toBe(false);
  });

  it('high bits are masked — writing value wider than numBits only keeps low bits', () => {
    // 0b1111_1010 = 250; write as 4 bits → 0b1010 = 10
    expect(roundTrip([{ value: 250, bits: 4 }])).toEqual([10]);
  });
});
