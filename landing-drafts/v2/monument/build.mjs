// Inlines the v22 quill mark into the page (so it works from a plain file and the page can add stars to it).
import { readFileSync, writeFileSync } from 'node:fs';
const quill = readFileSync(new URL('../../../design/quill-mark/v22/quill-animated.svg', import.meta.url), 'utf8')
  .replace(/^\s*<\?xml[^>]*>\s*/, '')
  .replace(/\swidth="\d+"\s+height="\d+"/, '');
const src = readFileSync(new URL('./index.src.html', import.meta.url), 'utf8');
writeFileSync(new URL('./index.html', import.meta.url), src.replace('<!--QUILL-->', quill));
console.log('built index.html', Math.round((src.length + quill.length) / 1024), 'KB');
