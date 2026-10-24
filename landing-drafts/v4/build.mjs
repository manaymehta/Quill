// The quill is loaded as an image (quill-animated.svg next to the page), so the page needs no build step;
// this just copies the source across, kept so the workflow stays the same.
import { readFileSync, writeFileSync } from 'node:fs';
writeFileSync(new URL('./index.html', import.meta.url), readFileSync(new URL('./index.src.html', import.meta.url), 'utf8'));
console.log('built index.html');
