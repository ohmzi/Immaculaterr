import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function fromCodePointSafe(cp: number): string | null {
  if (!Number.isFinite(cp)) return null;
  const n = Math.trunc(cp);
  if (n < 0 || n > 0x10ffff) return null;
  if (n >= 0xd800 && n <= 0xdfff) return null;
  try {
    return String.fromCodePoint(n);
  } catch {
    return null;
  }
}

// Decode a small subset of HTML entities for display safety (historical job reports).
export function decodeHtmlEntities(input: string): string {
  let s = input ?? '';
  if (!s) return '';

  // Hex numeric entities: &#xB7;
  s = s.replace(/&#x([0-9a-fA-F]{1,8});/g, (m, hex: string) => {
    const cp = Number.parseInt(hex, 16);
    return fromCodePointSafe(cp) ?? m;
  });

  // Decimal numeric entities: &#183;
  s = s.replace(/&#([0-9]{1,8});/g, (m, dec: string) => {
    const cp = Number.parseInt(dec, 10);
    return fromCodePointSafe(cp) ?? m;
  });

  // Minimal named entities
  s = s.replace(/&(amp|lt|gt|quot|apos|nbsp|middot);/gi, (m, name: string) => {
    switch (name.toLowerCase()) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      case 'nbsp':
        return ' ';
      case 'middot':
        return '·';
      default:
        return m;
    }
  });

  return s;
}
