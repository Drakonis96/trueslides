import { NextRequest, NextResponse } from "next/server";

function getImageDimensionsFromDataUri(dataUri: string) {
  // Use string split instead of regex to avoid stack overflow on large base64 strings
  const commaIdx = dataUri.indexOf(",");
  if (commaIdx === -1) return { error: 'no_comma' };
  const header = dataUri.substring(0, commaIdx);
  const headerMatch = header.match(/^data:([^;]+);base64$/);
  if (!headerMatch) return { error: 'bad_header', header };
  
  const mimeType = headerMatch[1].toLowerCase();
  const buffer = Buffer.from(dataUri.substring(commaIdx + 1), 'base64');
  
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
  return { error: 'no_dims', mimeType, bufLen: buffer.length };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const presentation = body.presentation;
    const debug: Record<string, unknown>[] = [];
    
    if (!presentation?.slides) {
      return NextResponse.json({ error: 'no slides' });
    }

    // Step 1: Collect URLs (same as resolveAllImages)
    const urls = new Set<string>();
    for (const s of presentation.slides) {
      for (const u of (s.imageUrls || [])) if (u) urls.add(u);
      if (s.manualElements) {
        for (const el of s.manualElements) {
          if (el.type === 'image' && el.content) urls.add(el.content);
        }
      }
    }

    // Step 2: Process data URIs (like downloadImageOnce)
    const imageMap = new Map<string, { data: string; dimensions: unknown }>();
    for (const url of urls) {
      if (url.startsWith('data:')) {
        try {
          const dims = getImageDimensionsFromDataUri(url);
          imageMap.set(url, { data: url, dimensions: dims });
          debug.push({ step: 'resolve', type: 'data', len: url.length, dims, ok: true });
        } catch (err) {
          debug.push({ step: 'resolve', type: 'data', len: url.length, error: String(err), ok: false });
        }
      } else {
        debug.push({ step: 'resolve', type: 'http', url: url.substring(0, 80), skipped: true });
      }
    }

    // Step 3: Build imageAssetByData
    const imageAssetByData = new Map<string, { data: string; dimensions: unknown }>();
    imageMap.forEach((asset) => {
      imageAssetByData.set(asset.data, asset);
    });

    // Step 4: Replace and check
    for (let i = 0; i < presentation.slides.length; i++) {
      const s = presentation.slides[i];
      if (!s.manualElements) continue;
      for (const el of s.manualElements) {
        if (el.type === 'image' && el.content) {
          const resolved = imageMap.get(el.content);
          const inAssetMap = imageAssetByData.has(el.content);
          const afterReplace = resolved ? imageAssetByData.has(resolved.data) : false;
          debug.push({
            step: 'lookup',
            slide: i + 1,
            contentLen: el.content.length,
            isData: el.content.startsWith('data:'),
            inImageMap: !!resolved,
            inAssetMap,
            afterReplace,
          });
        }
      }
    }
    
    return NextResponse.json({ 
      totalUrls: urls.size,
      imageMapSize: imageMap.size,
      assetMapSize: imageAssetByData.size,
      debug,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
