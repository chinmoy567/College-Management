import { describe, expect, it } from 'vitest';
import { simplePdf } from './pdf';

async function pdfText(buf: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const t = await (await doc.getPage(i)).getTextContent();
    out += t.items.map((it) => ('str' in it ? it.str : '')).join('') + '\n';
  }
  return out;
}

describe('PDF exports', () => {
  it('[OPS-10] PDF exports render Bangla text (embedded Noto Sans Bengali)', async () => {
    const name = 'রহিমা খাতুন';
    const subject = 'বাংলা প্রথম পত্র';
    const pdf = await simplePdf('ফলাফল', [{ h: subject }, { p: name }, { table: [['নাম', 'নম্বর'], [name, '৮৫']], widths: [300, 100] }]);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.includes(Buffer.from('NotoSansBengali'))).toBe(true); // the Bangla font is embedded
    const text = (await pdfText(pdf)).normalize('NFC').replace(/\s+/g, '');
    for (const s of [subject, 'ফলাফল', 'খাতুন']) expect(text).toContain(s.normalize('NFC').replace(/\s+/g, ''));
    // Shaping happened: pdf text is in visual order, so the pre-base vowel sign ি sits before হ (রহিমা -> রিহমা),
    // and the conjunct প্র (প + ্ + র) stays together.
    expect(text).toContain('রিহমা');
    expect(text).not.toContain('রহিমা');
  }, 60_000);
});
