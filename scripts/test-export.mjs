import { readFileSync, writeFileSync } from 'fs';

const data = JSON.parse(readFileSync('./data/manual-creations.json', 'utf8'));
const slides = data.creations[0].presentation.slides;

// Simulate manualToPresentationData (same as ManualCreator.tsx)
function manualToPresentationData(title, slides) {
  return {
    title,
    slides: slides.map((slide, index) => {
      const titleEl = slide.elements.find(el => el.type === 'title');
      const bulletEl = slide.elements.find(el => el.type === 'bullets');
      const imageEls = slide.elements.filter(el => el.type === 'image' && el.content);
      return {
        id: slide.id,
        index,
        title: titleEl?.content || '',
        bullets: bulletEl ? bulletEl.content.split('\n').filter(Boolean) : [],
        notes: slide.notes || '',
        imageUrls: imageEls.map(el => el.content),
        accentColor: slide.accentColor,
        bgColor: slide.bgColor,
        slideLayout: slide.layout,
        imageSources: imageEls.map(el => el.imageSource || ''),
        imageAdjustments: imageEls.map(el => el.imageAdjustment || { scale: 1, offsetX: 0, offsetY: 0, opacity: 100 }),
        manualElements: slide.elements.map(el => ({
          type: el.type,
          x: el.x, y: el.y, w: el.w, h: el.h,
          content: el.content,
          fontSize: el.fontSize,
          fontWeight: el.fontWeight,
          color: el.color,
          zIndex: el.zIndex,
          imageAdjustment: el.imageAdjustment,
          groupId: el.groupId,
          shapeKind: el.shapeKind,
          shapeFill: el.shapeFill,
          shapeOpacity: el.shapeOpacity,
          shapeBorderColor: el.shapeBorderColor,
          shapeBorderWidth: el.shapeBorderWidth,
          youtubeUrl: el.youtubeUrl,
        })),
      };
    }),
  };
}

const presentation = manualToPresentationData('Origenes de la fotografia', slides);

// Simulate preDownloadManualImages: for HTTP URLs, we'll keep them (no browser proxy)
// This simulates a worst case where all HTTP URL proxied downloads failed
const payload = {
  presentation,
  imageLayout: 'full',
  stretchImages: false,
  textDensity: 30,
  slideBgColor: slides[0]?.bgColor || 'FFFFFF',
  slideAccentColor: slides[0]?.accentColor || '6366F1',
};

const body = JSON.stringify(payload);
console.log(`Payload size: ${(body.length / 1024 / 1024).toFixed(1)} MB`);

// Send to the running dev server
async function sendRequest() {
  console.log('Sending request to build-pptx...');
  const startTime = Date.now();
  
  try {
    const res = await fetch('http://localhost:3000/api/build-pptx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    
    console.log(`Response status: ${res.status} (${Date.now() - startTime}ms)`);
    
    if (res.ok) {
      const blob = await res.arrayBuffer();
      const buf = Buffer.from(blob);
      writeFileSync('/tmp/test-full-export.pptx', buf);
      console.log(`PPTX saved: ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
      
      // Quick check: unzip and list files to see which images are embedded
      const { execSync } = await import('child_process');
      const listing = execSync('unzip -l /tmp/test-full-export.pptx 2>&1 | grep -i "image\\|media" || true').toString();
      console.log('\nEmbedded media files:');
      console.log(listing || '(none found)');
      
      const slideCount = parseInt(execSync('unzip -l /tmp/test-full-export.pptx 2>&1 | grep "ppt/slides/slide" | grep -v "_rels" | wc -l').toString().trim());
      const mediaCount = parseInt(execSync('unzip -l /tmp/test-full-export.pptx 2>&1 | grep "ppt/media/" | wc -l').toString().trim());
      console.log(`\nTotal slides: ${slideCount}, Total media files: ${mediaCount}`);
    } else {
      const errText = await res.text();
      console.error('Build failed:', errText);
    }
  } catch (err) {
    console.error('Request failed:', err.message);
  }
}

sendRequest();
