import { readFileSync, writeFileSync } from 'fs';
import PptxGenJS from 'pptxgenjs';
import https from 'node:https';
import http from 'node:http';

const data = JSON.parse(readFileSync('./data/manual-creations.json', 'utf8'));
const allSlides = data.creations[0].presentation.slides;

// Recreate the exact same logic as build-pptx
function getImageDimensionsFromDataUri(dataUri) {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');

  if ((mimeType === 'image/jpeg' || mimeType === 'image/jpg') && buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      const blockLength = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      offset += blockLength + 2;
    }
  }
  if (mimeType === 'image/png' && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  return null;
}

async function downloadImageOnce(url) {
  const UA = 'TrueSlides/0.1 (presentation builder; trueslides@example.com)';
  if (url.startsWith('data:')) {
    return { data: url, dimensions: getImageDimensionsFromDataUri(url) };
  }
  const data = await new Promise((resolve, reject) => {
    const doRequest = (requestUrl, redirects) => {
      if (redirects > 5) { reject(new Error('too many redirects')); return; }
      const mod = requestUrl.startsWith('https') ? https : http;
      const req = mod.get(requestUrl, { headers: { 'User-Agent': UA }, timeout: 12000 }, (res) => {
        if ([301,302,307,308].includes(res.statusCode) && res.headers.location) { doRequest(res.headers.location, redirects + 1); return; }
        if (!res.statusCode || res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    };
    doRequest(url, 0);
  });
  const mimeType = url.match(/\.(png|gif|webp)/) ? `image/${url.match(/\.(png|gif|webp)/)[1]}` : 'image/jpeg';
  const dataUri = `data:${mimeType};base64,${data.toString('base64')}`;
  return { data: dataUri, dimensions: getImageDimensionsFromDataUri(dataUri) };
}

async function downloadImage(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await downloadImageOnce(url);
      if (result) return result;
    } catch (err) {
      if (attempt === 0) { await new Promise(r => setTimeout(r, 500)); continue; }
      console.warn(`[downloadImage] FAILED: ${url.substring(0, 80)}: ${err.message}`);
    }
  }
  return null;
}

// Build presentation data (same as manualToPresentationData)
const presentation = {
  title: 'test',
  slides: allSlides.map((slide, index) => {
    const titleEl = slide.elements.find(el => el.type === 'title');
    const imageEls = slide.elements.filter(el => el.type === 'image' && el.content);
    return {
      id: slide.id, index,
      title: titleEl?.content || '',
      bullets: [],
      notes: slide.notes || '',
      imageUrls: imageEls.map(el => el.content),
      accentColor: slide.accentColor,
      bgColor: slide.bgColor,
      slideLayout: slide.layout,
      imageAdjustments: imageEls.map(el => el.imageAdjustment || { scale: 1, offsetX: 0, offsetY: 0, opacity: 100 }),
      manualElements: slide.elements.map(el => ({
        type: el.type, x: el.x, y: el.y, w: el.w, h: el.h,
        content: el.content,
        fontSize: el.fontSize, fontWeight: el.fontWeight,
        color: el.color, zIndex: el.zIndex,
        imageAdjustment: el.imageAdjustment,
      })),
    };
  }),
};

async function resolveAllImages(slides) {
  const urls = new Set();
  for (const s of slides) {
    for (const u of s.imageUrls) if (u) urls.add(u);
    if (s.manualElements) {
      for (const el of s.manualElements) {
        if (el.type === 'image' && el.content) urls.add(el.content);
      }
    }
  }
  console.log(`\nTotal unique URLs to resolve: ${urls.size}`);
  
  const map = new Map();
  const arr = [...urls];
  const batchSize = 4;
  for (let i = 0; i < arr.length; i += batchSize) {
    const chunk = arr.slice(i, i + batchSize);
    const results = await Promise.all(chunk.map(downloadImage));
    chunk.forEach((u, j) => {
      if (results[j]) {
        map.set(u, results[j]);
        const isData = u.startsWith('data:');
        console.log(`  ✓ Resolved: ${isData ? `data: (${u.length} chars)` : u.substring(0, 80)}`);
      } else {
        console.log(`  ✗ FAILED: ${u.substring(0, 80)}`);
      }
    });
    if (i + batchSize < arr.length) await new Promise(r => setTimeout(r, 200));
  }
  return map;
}

async function main() {
  console.log('=== TESTING FULL BUILD-PPTX FLOW ===\n');
  
  const imageMap = await resolveAllImages(presentation.slides);
  console.log(`\nResolved ${imageMap.size} / ${new Set(presentation.slides.flatMap(s => s.imageUrls).filter(Boolean)).size} imageUrls`);
  
  // Build imageAssetByData
  const imageAssetByData = new Map();
  imageMap.forEach((asset) => {
    imageAssetByData.set(asset.data, asset);
  });
  console.log(`imageAssetByData entries: ${imageAssetByData.size}`);
  
  // Replace URLs
  for (const s of presentation.slides) {
    s.imageUrls = s.imageUrls.map((url) => imageMap.get(url)?.data || '');
    if (s.manualElements) {
      for (const el of s.manualElements) {
        if (el.type === 'image' && el.content) {
          const resolved = imageMap.get(el.content);
          if (resolved) el.content = resolved.data;
        }
      }
    }
  }
  
  // Check which slides will have images in renderManualSlide
  console.log('\n=== PER-SLIDE IMAGE STATUS ===');
  for (let i = 0; i < presentation.slides.length; i++) {
    const s = presentation.slides[i];
    if (!s.manualElements) continue;
    const imgEls = s.manualElements.filter(el => el.type === 'image');
    for (const el of imgEls) {
      if (!el.content) {
        console.log(`Slide ${i+1}: image element has NO content → SKIP`);
        continue;
      }
      const asset = imageAssetByData.get(el.content);
      if (!asset) {
        const isData = el.content.startsWith('data:');
        const isHttp = el.content.startsWith('http');
        console.log(`Slide ${i+1}: ✗ imageAssetByData.get() returned null! content type=${isData ? 'data' : isHttp ? 'http' : 'other'}, len=${el.content.length}`);
      } else {
        console.log(`Slide ${i+1}: ✓ Image found in map, dims=${JSON.stringify(asset.dimensions)}`);
      }
    }
  }
}

main().catch(console.error);
