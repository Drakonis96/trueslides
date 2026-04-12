import { readFileSync } from 'fs';
const data = JSON.parse(readFileSync('./data/manual-creations.json', 'utf8'));
const content = data.creations[0].presentation.slides[19].elements.find(el => el.type === 'image').content;
console.log('Content length:', content.length);

// Test 1: regex approach (current code)
try {
  const match = content.match(/^data:([^;]+);base64,(.+)$/);
  console.log('Regex match result:', match ? `OK, match[2] len=${match[2].length}` : 'null');
} catch (e) {
  console.log('Regex FAILED:', e.message);
}

// Test 2: string split approach (proposed fix)
try {
  const commaIdx = content.indexOf(',');
  if (commaIdx === -1) { console.log('No comma found'); process.exit(); }
  const header = content.substring(0, commaIdx);
  const base64 = content.substring(commaIdx + 1);
  const mimeMatch = header.match(/^data:([^;]+);base64$/);
  console.log('String split: mime=' + (mimeMatch ? mimeMatch[1] : 'null') + ', base64 len=' + base64.length);
  
  const buffer = Buffer.from(base64, 'base64');
  console.log('Buffer created, length:', buffer.length);
  console.log('First bytes:', buffer[0]?.toString(16), buffer[1]?.toString(16), buffer[2]?.toString(16), buffer[3]?.toString(16));

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    let found = false;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      const blockLength = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const w = buffer.readUInt16BE(offset + 7);
        const h = buffer.readUInt16BE(offset + 5);
        console.log('JPEG dimensions:', w, 'x', h);
        found = true;
        break;
      }
      offset += blockLength + 2;
    }
    if (!found) console.log('SOF marker not found');
  }
} catch (e) {
  console.log('String split FAILED:', e.message);
}

// Also test slide 25
const content25 = data.creations[0].presentation.slides[24].elements.find(el => el.type === 'image').content;
console.log('\nSlide 25 length:', content25.length);
try {
  content25.match(/^data:([^;]+);base64,(.+)$/);
  console.log('Slide 25 regex: OK');
} catch (e) {
  console.log('Slide 25 regex FAILED:', e.message);
}

// Test the threshold: at what size does regex fail?
console.log('\n--- Size threshold test ---');
for (const testLen of [1000000, 2000000, 3000000, 4000000, 5000000, 6000000, 7000000, 8000000, 9000000]) {
  const testStr = 'data:image/jpeg;base64,' + 'A'.repeat(testLen);
  try {
    testStr.match(/^data:([^;]+);base64,(.+)$/);
    console.log(`${(testLen/1e6).toFixed(0)}M chars: OK`);
  } catch (e) {
    console.log(`${(testLen/1e6).toFixed(0)}M chars: FAILED (${e.message})`);
  }
}
