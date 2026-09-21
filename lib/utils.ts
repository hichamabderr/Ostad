import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import DOMPurify from 'dompurify';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface ExportToDocOptions {
  landscape?: boolean;
  title?: string;
}

const EXPORT_COLOR_NAMES: Record<string, string> = {
  '#000': 'black',
  '#000000': 'black',
  '#ffffff': 'white',
  '#1a1c1e': 'black',
  '#0d2c3b': 'darkslategray',
  '#0d6547': 'seagreen',
  '#0d9488': 'teal',
  '#2e7d9b': 'steelblue',
  '#334155': 'slategray',
  '#475569': 'slategray',
  '#4f46e5': 'indigo',
  '#5c6370': 'slategray',
  '#64748b': 'slategray',
  '#065f46': 'seagreen',
  '#094530': 'darkgreen',
  '#16a34a': 'green',
  '#0284c7': 'steelblue',
  '#059669': 'seagreen',
  '#2563eb': 'royalblue',
  '#7c3aed': 'indigo',
  '#92400e': 'saddlebrown',
  '#b45309': 'darkorange',
  '#ca8a04': 'darkgoldenrod',
  '#d97706': 'darkorange',
  '#db2777': 'deeppink',
  '#dc2626': 'firebrick',
  '#e11d48': 'crimson',
  '#94a3b8': 'darkgray',
  '#cbd5e1': 'lightgray',
  '#d5dfdc': 'lightgray',
  '#e2e8f0': 'lightgray',
  '#f1f5f9': 'whitesmoke',
  '#f8fafc': 'snow',
  '#fafaf9': 'ivory',
  '#fffbeb': 'lemonchiffon',
  '#ecfdf5': 'honeydew',
  '#f0fdf4': 'honeydew',
};

export function sanitizeExportColors(htmlContent: string): string {
  return htmlContent.replace(/#[0-9a-f]{3,8}\b/gi, (color) => {
    const named = EXPORT_COLOR_NAMES[color.toLowerCase()];
    if (named) return named;
    const hex = color.slice(1);
    const expanded = hex.length === 3
      ? hex.split('').map((digit) => digit + digit).join('')
      : hex.slice(0, 6);
    const channels = [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16));
    return `rgb(${channels.join(', ')})`;
  });
}

export function exportToDoc(htmlContent: string, filename: string, options?: ExportToDocOptions) {
  const page = options?.landscape
    ? '@page Section1 { size: 841.9pt 595.3pt; mso-page-orientation: landscape; margin: 0.45cm 0.55cm; }'
    : '@page Section1 { size: 595.3pt 841.9pt; margin: 0.45cm 0.6cm; }';
  const title = DOMPurify.sanitize(options?.title || filename);
  const sanitizedContent = sanitizeExportColors(DOMPurify.sanitize(htmlContent));
  const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${title}</title><style>${page} body{font-family:Amiri,Arial,sans-serif;direction:rtl}table{border-collapse:collapse;width:100%}td,th{border:1px solid lightgray;padding:4px;vertical-align:top}</style></head><body><div class="Section1">${sanitizedContent}</div></body></html>`;
  const blob = new Blob([`\ufeff${html}`], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.doc`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function triggerHapticFeedback() {
  if (typeof window !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(50);
  }
}
