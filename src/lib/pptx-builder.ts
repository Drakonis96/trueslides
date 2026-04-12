import PptxGenJS from "pptxgenjs";
import { PresentationData, ImageLayout } from "./types";

interface PptxOptions {
  imageLayout: ImageLayout;
  stretchImages: boolean;
  textDensity: number;
}

export async function buildPptx(
  data: PresentationData,
  options: PptxOptions
): Promise<Blob> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5

  pptx.author = "TrueSlides";
  pptx.title = data.title;

  // Define a reusable color scheme
  const colors = {
    bg: "0F172A",
    title: "F8FAFC",
    text: "CBD5E1",
    accent: "6366F1",
    bullet: "818CF8",
  };

  for (const slideData of data.slides) {
    const slide = pptx.addSlide();

    // Background
    slide.background = { color: colors.bg };

    // Presenter notes
    if (slideData.notes) {
      slide.addNotes(slideData.notes);
    }

    // Section label
    if (slideData.section) {
      slide.addText(slideData.section.toUpperCase(), {
        x: 0.5,
        y: 0.3,
        w: 5,
        h: 0.3,
        fontSize: 10,
        color: colors.accent,
        fontFace: "Arial",
        bold: true,
        charSpacing: 3,
      });
    }

    // Calculate layout based on image options
    const hasImages = slideData.imageUrls && slideData.imageUrls.length > 0;
    const textWidthRatio = hasImages ? 0.55 : 0.9;
    const textX = 0.5;
    const textW = 13.33 * textWidthRatio;

    // Title
    slide.addText(slideData.title, {
      x: textX,
      y: slideData.section ? 0.6 : 0.4,
      w: textW,
      h: 0.8,
      fontSize: 28,
      color: colors.title,
      fontFace: "Arial",
      bold: true,
    });

    // Bullet points
    if (slideData.bullets.length > 0) {
      const bulletFontSize = options.textDensity <= 10 ? 14 : options.textDensity <= 30 ? 17 : 19;
      const bulletItems = slideData.bullets.map((b) => ({
        text: b,
        options: {
          fontSize: bulletFontSize,
          color: colors.text,
          bullet: { code: "25CF", color: colors.bullet } as const,
          paraSpaceBefore: 10,
          paraSpaceAfter: 5,
        },
      }));

      slide.addText(bulletItems, {
        x: textX,
        y: 1.6,
        w: textW,
        h: 5.2,
        fontFace: "Arial",
        valign: "top",
      });
    }

    // Images
    if (hasImages) {
      const imgX = 13.33 * 0.58;
      const imgW = 13.33 * 0.38;
      const imgs = slideData.imageUrls;

      try {
        if (options.stretchImages && imgs.length > 0) {
          // Full slide background image
          slide.background = { data: `image/png;base64,`, path: imgs[0] };
          // Add a semi-transparent overlay for readability
          slide.addShape("rect" as unknown as PptxGenJS.ShapeType, {
            x: 0,
            y: 0,
            w: "100%",
            h: "100%",
            fill: { color: colors.bg, transparency: 30 },
          });
        } else {
          switch (options.imageLayout) {
            case "full":
              if (imgs[0]) {
                slide.addImage({
                  path: imgs[0],
                  x: imgX,
                  y: 0.5,
                  w: imgW,
                  h: 6.5,
                  sizing: { type: "contain", w: imgW, h: 6.5 },
                });
              }
              break;
            case "two":
              imgs.slice(0, 2).forEach((url, i) => {
                slide.addImage({
                  path: url,
                  x: imgX,
                  y: 0.5 + i * 3.35,
                  w: imgW,
                  h: 3.1,
                  sizing: { type: "contain", w: imgW, h: 3.1 },
                });
              });
              break;
            case "three":
              imgs.slice(0, 3).forEach((url, i) => {
                slide.addImage({
                  path: url,
                  x: imgX,
                  y: 0.3 + i * 2.3,
                  w: imgW,
                  h: 2.1,
                  sizing: { type: "contain", w: imgW, h: 2.1 },
                });
              });
              break;
            case "collage":
              imgs.slice(0, 4).forEach((url, i) => {
                const col = i % 2;
                const row = Math.floor(i / 2);
                const cw = imgW / 2 - 0.1;
                const ch = 3.1;
                slide.addImage({
                  path: url,
                  x: imgX + col * (cw + 0.2),
                  y: 0.5 + row * (ch + 0.2),
                  w: cw,
                  h: ch,
                  sizing: { type: "contain", w: cw, h: ch },
                });
              });
              break;
            case "combined": {
              const count = Math.min(imgs.length, 4);
              if (count === 1) {
                slide.addImage({
                  path: imgs[0],
                  x: imgX, y: 0.5, w: imgW, h: 6.5,
                  sizing: { type: "contain", w: imgW, h: 6.5 },
                });
              } else if (count === 2) {
                imgs.slice(0, 2).forEach((url, i) => {
                  slide.addImage({
                    path: url,
                    x: imgX, y: 0.5 + i * 3.35, w: imgW, h: 3.1,
                    sizing: { type: "contain", w: imgW, h: 3.1 },
                  });
                });
              } else if (count === 3) {
                slide.addImage({
                  path: imgs[0],
                  x: imgX, y: 0.5, w: imgW, h: 3.1,
                  sizing: { type: "contain", w: imgW, h: 3.1 },
                });
                imgs.slice(1, 3).forEach((url, i) => {
                  const cw = imgW / 2 - 0.1;
                  slide.addImage({
                    path: url,
                    x: imgX + i * (cw + 0.2), y: 3.85, w: cw, h: 3.1,
                    sizing: { type: "contain", w: cw, h: 3.1 },
                  });
                });
              } else {
                imgs.slice(0, 4).forEach((url, i) => {
                  const col = i % 2;
                  const row = Math.floor(i / 2);
                  const cw = imgW / 2 - 0.1;
                  const ch = 3.1;
                  slide.addImage({
                    path: url,
                    x: imgX + col * (cw + 0.2),
                    y: 0.5 + row * (ch + 0.2),
                    w: cw, h: ch,
                    sizing: { type: "contain", w: cw, h: ch },
                  });
                });
              }
              break;
            }
          }
        }
      } catch (imgErr) {
        console.error("Image embedding error:", imgErr);
        // Continue without images
      }
    }

    // Accent bar at bottom
    slide.addShape("rect" as unknown as PptxGenJS.ShapeType, {
      x: 0,
      y: 7.2,
      w: "100%",
      h: 0.05,
      fill: { color: colors.accent },
    });
  }

  // Generate as blob
  const output = await pptx.write({ outputType: "blob" });
  return output as Blob;
}
