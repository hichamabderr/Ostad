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

export function exportToDoc(htmlContent: string, filename: string, options?: ExportToDocOptions) {
  const page = options?.landscape
    ? '@page Section1 { size: 841.9pt 595.3pt; mso-page-orientation: landscape; margin: 0.45cm 0.55cm; }'
    : '@page Section1 { size: 595.3pt 841.9pt; margin: 0.45cm 0.6cm; }';
  const title = DOMPurify.sanitize(options?.title || filename);
  const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${title}</title><style>${page} body{font-family:Amiri,Arial,sans-serif;direction:rtl}table{border-collapse:collapse;width:100%}td,th{border:1px solid #cbd5e1;padding:4px;vertical-align:top}</style></head><body><div class="Section1">${DOMPurify.sanitize(htmlContent)}</div></body></html>`;
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
