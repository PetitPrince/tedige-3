import type { Diagram, Frame } from '../types/frame';
import { createBoard } from '../types/board';

// Custom replacer/reviver to handle Uint8Array boards.

function diagramToJSON(diagram: Diagram): string {
  return JSON.stringify(diagram, (_key, value) => {
    if (value instanceof Uint8Array) {
      return { __uint8array: true, data: Array.from(value) };
    }
    return value;
  }, 2);
}

function diagramFromJSON(json: string): Diagram {
  return JSON.parse(json, (_key, value) => {
    if (value && typeof value === 'object' && value.__uint8array === true) {
      return new Uint8Array(value.data);
    }
    return value;
  }) as Diagram;
}

export function downloadJSON(diagram: Diagram, filename = 'tedige.json'): void {
  const blob = new Blob([diagramToJSON(diagram)], { type: 'application/json' });
  triggerDownload(blob, filename);
}

export function loadJSONFile(): Promise<Diagram> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error('No file selected'));
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(diagramFromJSON(reader.result as string));
        } catch (e) {
          reject(e);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
