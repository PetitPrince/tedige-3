declare module 'gifenc' {
  export function GIFEncoder(): {
    writeFrame(
      indexed: Uint8Array,
      width: number,
      height: number,
      opts?: {
        palette?: Uint8Array | number[][];
        delay?: number;
        repeat?: number;
        dispose?: number;
        transparent?: boolean;
        transparentIndex?: number;
      },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
  };

  export function quantize(
    rgba: Uint8ClampedArray | Uint8Array,
    maxColors: number,
    opts?: {
      format?: string;
      oneBitAlpha?: boolean;
    },
  ): Uint8Array;

  export function applyPalette(
    rgba: Uint8ClampedArray | Uint8Array,
    palette: Uint8Array,
    format?: string,
  ): Uint8Array;
}
