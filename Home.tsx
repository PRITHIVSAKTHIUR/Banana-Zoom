/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useCallback, useEffect, useRef, MouseEvent } from 'react';
// FIX: Added GenerateContentResponse for proper typing of API responses.
import { GoogleGenAI, Modality, GenerateContentResponse } from "@google/genai";
import {GIFEncoder, quantize, applyPalette} from 'https://unpkg.com/gifenc'

// --- Type Definitions ---
enum AppState {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  LOADED = 'LOADED',
  SELECTING = 'SELECTING',
  ENHANCING = 'ENHANCING',
  ENHANCED = 'ENHANCED',
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ImageDescription {
    selectionDescription:string;
    prompt?:string;
}

interface HistoryStep {
  imageSrc: string;
  description: ImageDescription | null;
  originalRect: Rect | null;
}

// --- Utility Functions ---

// FIX: Changed to a standard function declaration to avoid issues with TypeScript generics in a .tsx file.
// Also improved error handling to consistently return null.
function extractJson<T>(text: string): T | null {
  try {
    const data = JSON.parse(text) as T;
    return data;
  } catch {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/s);
    if (!match) {
      console.error(`No JSON found in response: ${text}`);
      return null;
    }
    try {
      const data = JSON.parse(match[1]) as T;
      return data;
    } catch (error) {
      console.error(error);
      return null;
    }
  }
}

const cropImage = (
  image: HTMLImageElement,
  cropRect: Rect,
  targetWidth: number,
  targetHeight: number,
  pixelated: boolean
): Promise<string> => {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return resolve('');
    }
    
    if (pixelated) {
      ctx.imageSmoothingEnabled = false;
    }

    ctx.drawImage(
      image,
      cropRect.x,
      cropRect.y,
      cropRect.w,
      cropRect.h,
      0,
      0,
      targetWidth,
      targetHeight
    );

    resolve(canvas.toDataURL('image/png'));
  });
};

// FIX: Changed to an async function declaration to avoid JSX parsing issues with Promise return types.
// FIX: Renamed `history` parameter to `descriptions` to avoid conflict with the browser's built-in `History` type.
async function serviceDescribeImage(imageDataUrl: string, descriptions: ImageDescription[]): Promise<ImageDescription> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const parts = imageDataUrl.split(',');
    const mimeType = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
    const base64Data = parts[1];

    if (!base64Data) {
        console.error("Invalid image data URL provided to serviceDescribeImage.");
        return {selectionDescription:"user selected a region to enhance"};
    }
    
    const imagePart = {
        inlineData: {
            mimeType,
            data: base64Data,
        },
    };
    
    const textPart = {
        text: `You are an advanced image enhancement system. Your two tasks are:

1. **Selection Description:** Provide a precise, internal-use description of what the user has selected. Format this as: "The user selected...".

2. **Enhancement Prompt:** Write a short, non-narrative prompt for an image enhancement model. The model is a 'black box' and only receives your prompt and the cropped image. It cannot access history.

### Enhancement Prompt Rules

- **Camera Angle & Perspective:** Always provide a camera angle. Crucially, infer the most plausible perspective from the selection's context. For architectural features like windows, assume an **external perspective** (looking in) unless the image content or history clearly indicates an interior scene.

- **Content & Detail:**
  - If the selection is clear, provide a concise, high-level description of the image type and angle (e.g., "microscopic photography, close-up"). Do not describe the content itself.
  - If the selection is blurry or too zoomed in, provide a creative, plausible, and imprecise description of what could be in the frame. Avoid details about color or shape, allowing the enhancement model to infer them from the image's pixels. Example: a blurry section of water could suggest "a contour of a fish beneath the surface," while a blurry sky could suggest "the faint glow of a distant nebula."

- **Final Check:** Do not include a full narrative or describe anything outside the selection box. The prompt must be concise.

### Output
Return a JSON object in the following format:

\`\`\`json
{
  "selectionDescription": "string",
  "prompt": "string"
}
\`\`\`

Here's the selection history for your reference:

${descriptions.length ? descriptions.filter(Boolean).map((desc,index)=>`${index+1} - ${desc.selectionDescription}`).join('\n\n* ') : 'No current history, this is the first selection'}
`
    };

    try {
        // FIX: Added GenerateContentResponse type for the response object.
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [imagePart, textPart] },
        });
        // FIX: Added a safety check for the text property.
        const text = response.text?.trim();
        if (!text) {
          console.error("No text in response from Gemini");
          return {selectionDescription:"user selected a region to enhance"};
        }

        const data = extractJson<ImageDescription>(text);
        
        if (!data) {
            return {selectionDescription:"user selected a region to enhance"};
        }
        return data;
    } catch (error) {
        console.error("Error describing image with Gemini:", error);
        return {selectionDescription:"user selected a region to enhance"};
    }
}

// FIX: Changed to an async function declaration to avoid JSX parsing issues with Promise return types.
async function serviceEnhance(croppedImageDataUrl: string, history: string[]): Promise<{ imageSrc: string }> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const base64Data = croppedImageDataUrl.split(',')[1] || '';
    const imagePart = {
        inlineData: {
            mimeType: 'image/png',
            data: base64Data,
        },
    };

    if (!history || history.length === 0) {
        console.error("Enhancement history is empty.");
        return { imageSrc: croppedImageDataUrl };
    }

    // FIX: Simplified the prompt to be less restrictive, which was likely causing the "No candidates" error.
    // REMOVED: Banana easter egg prompt text.
    const generationPrompt = `Enhance and upscale this image. Preserve the original content, shapes, and colors, but increase the resolution and detail. If the image is too blurry to determine content, use creative interpretation based on the existing shapes and colors.`;

    try {
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image-preview',
            contents: {parts:[imagePart, {text:generationPrompt}]},
            config:{
                // REMOVED: Modality.TEXT as we no longer expect a text response for the banana.
                responseModalities: [Modality.IMAGE],
            }
        });

        // FIX: Added robust error handling to check for blocked prompts.
        if (response.promptFeedback?.blockReason) {
          const message = `Request was blocked: ${response.promptFeedback.blockReason} - ${response.promptFeedback.blockReasonMessage || 'No message.'}`;
          console.error(message, response.promptFeedback);
          throw new Error(message);
        }

        const candidates = response.candidates;
        // FIX: The original error. Check candidates and throw a more informative error.
        if (!candidates || candidates.length === 0) {
            console.error("No candidates returned from the API. Full response:", response);
            if (response.text) {
                throw new Error(`API returned no candidates, but provided a text response: ${response.text}`);
            }
            throw new Error("API returned no candidates and no block reason. The response may have been empty.");
        }

        const contents = candidates[0].content;
        if (!contents) throw new Error("No contents returned from the API.");
        const parts = contents.parts;
        if (!parts) throw new Error("No parts returned from the API.");

        let imageSrc = croppedImageDataUrl;

        // REMOVED: Logic to parse `foundTheBanana`
        for (const part of parts) {
          if (part.inlineData) {
            const imageData = part.inlineData.data;
            imageSrc = `data:${part.inlineData.mimeType};base64,${imageData}`;
          }
        }
        
        return { imageSrc };

    } catch (error) {
        console.error("Error generating image with Gemini:", error);
        return { imageSrc: croppedImageDataUrl };
    }
}

const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const interpolateRect = (start: Rect, end: Rect, t: number): Rect => ({
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    w: start.w + (end.w - start.w) * t,
    h: start.h + (end.h - start.h) * t,
});
const addFrameToGif = (gif: any, ctx:CanvasRenderingContext2D, delay:number) => {
  const { data, width, height } = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  const palette = quantize(data, 256)
  const indexed = applyPalette(data, palette)
  gif.writeFrame(indexed, width, height, { palette, delay });
}
// FIX: Changed to an async function declaration to avoid JSX parsing issues with Promise return types.
async function generateZoomGif(history: HistoryStep[]): Promise<Blob> {
    if (history.length < 2) {
        throw new Error("History must contain at least two steps to generate a GIF.");
    }
    const images = await Promise.all(
        history.map(step => new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = step.imageSrc;
        }))
    );
    const firstSelectionRect = history[1].originalRect;
    if (!firstSelectionRect) {
        throw new Error("The second history step must have a selection rectangle.");
    }
    const gifAspectRatio = firstSelectionRect.h / firstSelectionRect.w;
    const gifWidth = 512;
    const gifHeight = Math.round(gifWidth * gifAspectRatio);
    
    const gif = GIFEncoder();
    const canvas = document.createElement('canvas');
    canvas.width = gifWidth;
    canvas.height = gifHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error("Could not get canvas context");

    const fps = 30;
    const zoomDuration = 1.0;
    const holdDuration = 0.5;
    const zoomFrames = zoomDuration * fps;
    const holdFrames = holdDuration * fps;
    const frameDelay = 1000 / fps;

    for (let i = 0; i < images.length - 1; i++) {
        const sourceImageForZoom = images[i];
        const nextEnhancedImage = images[i + 1];
        const startRect: Rect = { x: 0, y: 0, w: sourceImageForZoom.naturalWidth, h: sourceImageForZoom.naturalHeight };
        const endRect = history[i + 1].originalRect;
        if (!endRect) continue;

        for (let f = 0; f < zoomFrames; f++) {
            const t = easeInOutCubic(f / zoomFrames);
            const currentRect = interpolateRect(startRect, endRect, t);
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, gifWidth, gifHeight);
            ctx.drawImage(sourceImageForZoom, currentRect.x, currentRect.y, currentRect.w, currentRect.h, 0, 0, gifWidth, gifHeight);
            const scaleX = gifWidth / currentRect.w;
            const scaleY = gifHeight / currentRect.h;
            const rectOnCanvas = {
                x: (endRect.x - currentRect.x) * scaleX,
                y: (endRect.y - currentRect.y) * scaleY,
                w: endRect.w * scaleX,
                h: endRect.h * scaleY,
            };
            ctx.strokeStyle = '#EEE';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(rectOnCanvas.x, rectOnCanvas.y, rectOnCanvas.w, rectOnCanvas.h);
            ctx.setLineDash([]);
            addFrameToGif(gif, ctx, frameDelay);
        }
        
        for (let f = 0; f < holdFrames; f++) {
             ctx.fillStyle = 'black';
             ctx.fillRect(0, 0, gifWidth, gifHeight);
             ctx.drawImage(nextEnhancedImage, 0, 0, gifWidth, gifHeight);
             addFrameToGif(gif, ctx, frameDelay);
        }
    }
    gif.finish();
    return new Blob([gif.bytesView()], { type: 'image/gif' });
}

// --- React Components ---

interface DropZoneProps {
    onUploadClick: () => void;
}
const DropZone: React.FC<DropZoneProps> = ({ onUploadClick }) => {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center border-2 border-dashed border-white/50 rounded-lg text-center p-8">
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-white/70 mb-4">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
        <h2 className="text-2xl font-bold text-white mb-2">[ CSI Image Enhancer v2.5 ]</h2>
        <p className="text-white/80">Awaiting Image Input...</p>
        <p className="text-sm text-white/60 mt-4">Drag & Drop an image file or</p>
        <button 
            onClick={onUploadClick}
            className="mt-2 px-4 py-2 bg-white/20 border border-white/50 rounded text-white hover:bg-white/30 transition-colors"
        >
            Upload from Local
        </button>
    </div>
  );
};

interface ImageDisplayProps {
  imageSrc: string;
  onStageSelection: (originalRect: Rect, screenRect: Rect, canvasDataUrl: string) => void;
  isEnhancing: boolean;
  historicalSelection?: Rect | null;
  stagedSelectionRect?: Rect | null;
  useFixedSelectionBox: boolean;
  fixedSelectionSizePercentage: number;
}
const ImageDisplay: React.FC<ImageDisplayProps> = ({ imageSrc, onStageSelection, isEnhancing, historicalSelection, stagedSelectionRect, useFixedSelectionBox, fixedSelectionSizePercentage }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  
  useEffect(() => {
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => setImage(img);
  }, [imageSrc]);

  const getCanvasScale = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return { scale: 1, offsetX: 0, offsetY: 0, dWidth: 0, dHeight: 0 };
    const { width: canvasWidth, height: canvasHeight } = canvas.getBoundingClientRect();
    const canvasAspect = canvasWidth / canvasHeight;
    const imageAspect = image.naturalWidth / image.naturalHeight;
    let dWidth, dHeight, offsetX, offsetY;
    if (canvasAspect > imageAspect) {
      dHeight = canvasHeight;
      dWidth = dHeight * imageAspect;
    } else {
      dWidth = canvasWidth;
      dHeight = dWidth / imageAspect;
    }
    offsetX = (canvasWidth - dWidth) / 2;
    offsetY = (canvasHeight - dHeight) / 2;
    const scale = dWidth / image.naturalWidth;
    return { scale, offsetX, offsetY, dWidth, dHeight };
  }, [image]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas || !image) return;
    
    const { width: cssWidth, height: cssHeight } = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    const { scale, offsetX, offsetY, dWidth, dHeight } = getCanvasScale();
    ctx.drawImage(image, offsetX, offsetY, dWidth, dHeight);
    
    if (stagedSelectionRect) {
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.setLineDash([]); // solid line
        ctx.strokeRect(stagedSelectionRect.x, stagedSelectionRect.y, stagedSelectionRect.w, stagedSelectionRect.h);
    }

    if (selection) {
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
      ctx.setLineDash([]);
      ctx.font = '10px "Fira Code", monospace';
      const info = `x:${Math.round(selection.x)} y:${Math.round(selection.y)} w:${Math.round(selection.w)} h:${Math.round(selection.h)}`;
      const textMetrics = ctx.measureText(info);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(selection.x -1, selection.y - 14, textMetrics.width + 4, 12);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(info, selection.x + 1, selection.y - 4);
    } else if (historicalSelection && !stagedSelectionRect) {
      const screenRect = {
          x: historicalSelection.x * scale + offsetX,
          y: historicalSelection.y * scale + offsetY,
          w: historicalSelection.w * scale,
          h: historicalSelection.h * scale,
      };
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 2;
      ctx.strokeRect(screenRect.x, screenRect.y, screenRect.w, screenRect.h);
      ctx.font = '10px "Fira Code", monospace';
      const info = `PREV. CROP`;
      const textMetrics = ctx.measureText(info);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(screenRect.x - 1, screenRect.y - 14, textMetrics.width + 4, 12);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.fillText(info, screenRect.x + 1, screenRect.y - 4);
    }
  }, [image, selection, getCanvasScale, historicalSelection, stagedSelectionRect]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        const { width, height } = parent.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.scale(dpr, dpr);
        }
        draw();
      }
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [draw, image]);

  const getMousePos = (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isEnhancing) return;
    const pos = getMousePos(e);
    if (useFixedSelectionBox) {
        if (!image) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const { scale, offsetX, offsetY, dWidth, dHeight } = getCanvasScale();
        if (pos.x < offsetX || pos.x > offsetX + dWidth || pos.y < offsetY || pos.y > offsetY + dHeight) {
            return;
        }
        const originalClickX = (pos.x - offsetX) / scale;
        const originalClickY = (pos.y - offsetY) / scale;
        const boxWidth = image.naturalWidth * fixedSelectionSizePercentage;
        const boxHeight = image.naturalHeight * fixedSelectionSizePercentage;
        let originalX = originalClickX - boxWidth / 2;
        let originalY = originalClickY - boxHeight / 2;
        if (originalX < 0) originalX = 0;
        if (originalY < 0) originalY = 0;
        if (originalX + boxWidth > image.naturalWidth) originalX = image.naturalWidth - boxWidth;
        if (originalY + boxHeight > image.naturalHeight) originalY = image.naturalHeight - boxHeight;
        const originalRect: Rect = { x: originalX, y: originalY, w: boxWidth, h: boxHeight };
        const screenRect: Rect = {
            x: originalRect.x * scale + offsetX,
            y: originalRect.y * scale + offsetY,
            w: originalRect.w * scale,
            h: originalRect.h * scale,
        };
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(screenRect.x, screenRect.y, screenRect.w, screenRect.h);
        ctx.setLineDash([]);
        const canvasDataUrl = canvas.toDataURL('image/png');
        draw();
        onStageSelection(originalRect, screenRect, canvasDataUrl);
    } else {
        setStartPoint(pos);
        setSelection({ ...pos, w: 0, h: 0 });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (useFixedSelectionBox || !startPoint || isEnhancing) return;
    const pos = getMousePos(e);
    const x = Math.min(pos.x, startPoint.x);
    const y = Math.min(pos.y, startPoint.y);
    const w = Math.abs(pos.x - startPoint.x);
    const h = Math.abs(pos.y - startPoint.y);
    setSelection({ x, y, w, h });
  };

  const handleMouseUp = () => {
    if (useFixedSelectionBox) return;
    if (!selection || !image || selection.w < 10 || selection.h < 10 || isEnhancing) {
      setStartPoint(null);
      setSelection(null);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { scale, offsetX, offsetY } = getCanvasScale();
    const originalRect: Rect = {
        x: (selection.x - offsetX) / scale,
        y: (selection.y - offsetY) / scale,
        w: selection.w / scale,
        h: selection.h / scale
    };
    const canvasDataUrl = canvas.toDataURL('image/png');
    onStageSelection(originalRect, selection, canvasDataUrl);
    setStartPoint(null);
    setSelection(null);
  };

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      className={`max-w-full max-h-full w-full h-full transition-[filter] duration-700 ${isEnhancing ? 'filter brightness-50 cursor-wait' : 'filter brightness-100 ' + (useFixedSelectionBox ? 'cursor-zoom-in' : 'cursor-crosshair')}`}
    />
  );
};

interface PixelDissolveProps {
  lowResSrc: string;
  highResSrc: string;
  onComplete: () => void;
}
const PixelDissolve: React.FC<PixelDissolveProps> = ({ lowResSrc, highResSrc, onComplete }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number | null>(null);

  const startAnimation = useCallback((lowResImg: HTMLImageElement, highResImg: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if(!parent) return;
    const { width, height } = parent.getBoundingClientRect();
    canvas.width = width;
    canvas.height = height;
    const offscreenLow = document.createElement('canvas');
    const offscreenHigh = document.createElement('canvas');
    offscreenLow.width = canvas.width;
    offscreenLow.height = canvas.height;
    offscreenHigh.width = canvas.width;
    offscreenHigh.height = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const ctxLow = offscreenLow.getContext('2d', { willReadFrequently: true });
    const ctxHigh = offscreenHigh.getContext('2d', { willReadFrequently: true });
    if (!ctx || !ctxLow || !ctxHigh) return;
    ctxLow.imageSmoothingEnabled = false;
    ctxLow.drawImage(lowResImg, 0, 0, canvas.width, canvas.height);
    ctxHigh.imageSmoothingEnabled = true;
    ctxHigh.drawImage(highResImg, 0, 0, canvas.width, canvas.height);
    const lowData = ctxLow.getImageData(0, 0, canvas.width, canvas.height);
    const highData = ctxHigh.getImageData(0, 0, canvas.width, canvas.height);
    ctx.putImageData(lowData, 0, 0);
    const totalPixels = canvas.width * canvas.height;
    const pixelIndices = Array.from({ length: totalPixels }, (_, i) => i);
    for (let i = pixelIndices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pixelIndices[i], pixelIndices[j]] = [pixelIndices[j], pixelIndices[i]];
    }
    let currentPixel = 0;
    const pixelsPerFrame = Math.max(1, Math.ceil(totalPixels / 60));
    const animate = () => {
        if (!canvasRef.current) return;
        if (currentPixel >= totalPixels) {
            ctx.putImageData(highData, 0, 0);
            onComplete();
            return;
        }
        const endPixel = Math.min(currentPixel + pixelsPerFrame, totalPixels);
        for (let i = currentPixel; i < endPixel; i++) {
            const pIndex = pixelIndices[i] * 4;
            if (lowData.data.length > pIndex + 3 && highData.data.length > pIndex + 3) {
                lowData.data[pIndex] = highData.data[pIndex];
                lowData.data[pIndex + 1] = highData.data[pIndex + 1];
                lowData.data[pIndex + 2] = highData.data[pIndex + 2];
                lowData.data[pIndex + 3] = highData.data[pIndex + 3];
            }
        }
        ctx.putImageData(lowData, 0, 0);
        currentPixel = endPixel;
        animationFrameId.current = requestAnimationFrame(animate);
    };
    animate();
  }, [onComplete]);

  useEffect(() => {
    let lowResImg: HTMLImageElement;
    let highResImg: HTMLImageElement;
    const lowPromise = new Promise<HTMLImageElement>(resolve => {
        lowResImg = new Image();
        lowResImg.crossOrigin = "anonymous";
        lowResImg.src = lowResSrc;
        lowResImg.onload = () => resolve(lowResImg);
    });
    const highPromise = new Promise<HTMLImageElement>(resolve => {
        highResImg = new Image();
        highResImg.crossOrigin = "anonymous";
        highResImg.src = highResSrc;
        highResImg.onload = () => resolve(highResImg);
    });
    Promise.all([lowPromise, highPromise]).then(([loadedLow, loadedHigh]) => {
        startAnimation(loadedLow, loadedHigh);
    });
    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [lowResSrc, highResSrc, startAnimation]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
};

interface SelectionAnimatorProps {
    rect: Rect;
    finalRect: Rect;
    src: string;
    onComplete: () => void;
}
const SelectionAnimator: React.FC<SelectionAnimatorProps> = ({ rect, finalRect, src, onComplete }) => {
    const [isAnimating, setIsAnimating] = useState(false);
    const onCompleteCalled = useRef(false);

    useEffect(() => {
        const timer = setTimeout(() => setIsAnimating(true), 50);
        return () => clearTimeout(timer);
    }, []);

    const handleTransitionEnd = () => {
        if (!onCompleteCalled.current) {
            onCompleteCalled.current = true;
            onComplete();
        }
    };
    
    const initialStyle: React.CSSProperties = {
        top: `${rect.y}px`,
        left: `${rect.x}px`,
        width: `${rect.w}px`,
        height: `${rect.h}px`,
    };

    const finalStyle: React.CSSProperties = {
        top: `${finalRect.y}px`,
        left: `${finalRect.x}px`,
        width: `${finalRect.w}px`,
        height: `${finalRect.h}px`,
    };

    return (
        <div
            style={isAnimating ? finalStyle : initialStyle}
            className="absolute transition-all duration-700 ease-in-out cursor-progress"
            onTransitionEnd={handleTransitionEnd}
        >
            <img 
                src={src} 
                alt="Enhancing selection"
                className="w-full h-full pixelated"
            />
        </div>
    );
}

interface StatusBarProps {
  state: AppState;
  useFixedSelectionBox: boolean;
  isInitialState: boolean;
  onUploadClick: () => void;
}
const getStatusMessage = (state: AppState, useFixedSelectionBox:boolean): string => {
  switch (state) {
    case AppState.IDLE:
      return 'SYSTEM IDLE. AWAITING INPUT.';
    case AppState.LOADING:
      return 'LOADING INITIAL ASSETS... STANDBY...';
    case AppState.LOADED:
      return 'IMAGE LOADED. '+ (useFixedSelectionBox ? 'CLICK TO SELECT AREA TO ENHANCE' : 'DRAW SELECTION TO ENHANCE.');
    case AppState.SELECTING:
        return 'DEFINING SELECTION AREA...';
    case AppState.ENHANCING:
      return 'ANALYZING SELECTION... ENHANCING...';
    case AppState.ENHANCED:
      return 'APPLYING ENHANCEMENT...';
    default:
      return '...';
  }
};
const StatusBar: React.FC<StatusBarProps> = ({ state, useFixedSelectionBox, isInitialState, onUploadClick }) => {
  if (state === AppState.LOADED && isInitialState) {
    return (
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-2 text-center text-white font-mono tracking-widest text-sm border-t border-white/30 z-10 flex items-center justify-center h-12">
        <p className="hidden sm:block animate-pulse">Drag and drop a new image or click on the current one to begin</p>
        <button
          onClick={onUploadClick}
          className="block sm:hidden px-4 py-2 bg-white/20 border border-white/50 rounded text-white hover:bg-white/30 transition-colors"
        >
          Select Image
        </button>
      </div>
    );
  }
  const message = getStatusMessage(state, useFixedSelectionBox);
  return (
    <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-2 text-center text-white font-mono tracking-widest text-sm border-t border-white/30 z-10 flex items-center justify-center h-12">
        <p className="animate-pulse">{message}</p>
    </div>
  );
};

const ProcessingAnimation: React.FC = () => {
    return (
        <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-30" aria-label="Processing request" role="alert">
            <div className="w-16 h-16 border-4 border-dashed border-white rounded-full animate-spin"></div>
            <p className="text-white text-lg font-mono mt-4 animate-pulse">PROCESSING...</p>
        </div>
    )
}

// --- Main App Component ---

interface EnhancementJob {
  originalRect: Rect;
  canvasWithSelectionDataUrl: string;
  pixelatedSrc: string;
  screenRect: Rect;
}

type StagedSelection = {
  originalRect: Rect;
  screenRect: Rect;
  canvasDataUrl: string;
};

export default function Home() {
  const useFixedSelectionBox = true;
  const fixedSelectionSizePercentage = 0.125;
  const [appState, setAppState] = useState<AppState>(AppState.LOADING);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [pixelatedImageSrc, setPixelatedImageSrc] = useState<string | null>(null);
  const [enhancedImageSrc, setEnhancedImageSrc] = useState<string | null>(null);
  const [finalImageSrc, setFinalImageSrc] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryStep[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [newHistoryEntryData, setNewHistoryEntryData] = useState<{description: ImageDescription, originalRect: Rect} | null>(null);
  const [enhancementJob, setEnhancementJob] = useState<EnhancementJob | null>(null);
  const [finalEnhancementRect, setFinalEnhancementRect] = useState<Rect | null>(null);
  const [displaySelection, setDisplaySelection] = useState<Rect | null>(null);
  const [isGeneratingGif, setIsGeneratingGif] = useState<boolean>(false);
  const [stagedSelection, setStagedSelection] = useState<StagedSelection | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const imageObjectURLRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadInitialImage = useCallback(async () => {
    if (imageObjectURLRef.current) {
      URL.revokeObjectURL(imageObjectURLRef.current);
      imageObjectURLRef.current = null;
    }
    setAppState(AppState.LOADING);
    try {
      const response = await fetch('https://cdn-uploads.huggingface.co/production/uploads/65bb837dbfb878f46c77de4c/xlCiAw2IirDxEbryce_YI.jpeg');
      if (!response.ok) throw new Error(`Failed to fetch initial image: ${response.statusText}`);
      const blob = await response.blob();
      const objectURL = URL.createObjectURL(blob);
      imageObjectURLRef.current = objectURL;
      const img = new Image();
      img.onload = () => {
        const newStep: HistoryStep = { imageSrc: objectURL, description: null, originalRect: null };
        setHistory([newStep]);
        setHistoryIndex(0);
        setImage(img);
        setFinalImageSrc(objectURL);
        setDisplaySelection(null);
        setAppState(AppState.LOADED);
      };
      img.onerror = () => {
        console.error("Image failed to load from object URL.");
        setAppState(AppState.IDLE);
        if (imageObjectURLRef.current) {
          URL.revokeObjectURL(imageObjectURLRef.current);
          imageObjectURLRef.current = null;
        }
      };
      img.src = objectURL;
    } catch (error) {
      console.error("Failed to load initial image:", error);
      setAppState(AppState.IDLE);
    }
  }, []);
  
  const resetState = useCallback(() => {
    setEnhancementJob(null);
    setFinalEnhancementRect(null);
    setHistory([]);
    setHistoryIndex(-1);
    setNewHistoryEntryData(null);
    setDisplaySelection(null);
    setStagedSelection(null);
    setIsProcessing(false);
    loadInitialImage();
  }, [loadInitialImage]);

  useEffect(() => {
    loadInitialImage();
    return () => {
      if (imageObjectURLRef.current) {
        URL.revokeObjectURL(imageObjectURLRef.current);
      }
    };
  }, [loadInitialImage]);

  const handleFileDrop = useCallback((file: File) => {
    if (imageObjectURLRef.current) {
      URL.revokeObjectURL(imageObjectURLRef.current);
      imageObjectURLRef.current = null;
    }
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const newImageSrc = e.target?.result as string;
          const newStep: HistoryStep = { imageSrc: newImageSrc, description: null, originalRect: null };
          setHistory([newStep]);
          setHistoryIndex(0);
          setImage(img);
          setFinalImageSrc(newImageSrc);
          setEnhancementJob(null);
          setFinalEnhancementRect(null);
          setDisplaySelection(null);
          setStagedSelection(null);
          setAppState(AppState.LOADED);
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileDrop(e.target.files[0]);
    }
  };

  const handleUploadClick = () => { fileInputRef.current?.click(); };

  const handleStageSelection = useCallback((originalRect: Rect, screenRect: Rect, canvasDataUrl: string) => {
      setStagedSelection({ originalRect, screenRect, canvasDataUrl });
  }, []);

  const startEnhancementProcess = useCallback((originalRect: Rect, screenRect: Rect, canvasWithSelectionDataUrl: string) => {
    if (!image) return;
    if (historyIndex < history.length - 1) {
      const newHistory = history.slice(0, historyIndex + 1);
      setHistory(newHistory);
    }
    setAppState(AppState.ENHANCING);
    const aspectRatio = originalRect.w / originalRect.h;
    const padding = 0.05;
    const maxWidth = window.innerWidth * (1 - padding);
    const maxHeight = window.innerHeight * (1 - padding);
    let targetWidth = maxWidth;
    let targetHeight = targetWidth / aspectRatio;
    if (targetHeight > maxHeight) {
        targetHeight = maxHeight;
        targetWidth = targetHeight * aspectRatio;
    }
    setFinalEnhancementRect({ w: targetWidth, h: targetHeight, x: (window.innerWidth - targetWidth) / 2, y: (window.innerHeight - targetHeight) / 2 });
    cropImage(image, originalRect, originalRect.w, originalRect.h, true).then(pixelatedSrc => {
      setEnhancementJob({ originalRect, canvasWithSelectionDataUrl, pixelatedSrc, screenRect });
    });
  }, [image, history, historyIndex]);

  const handleProcessClick = useCallback(() => {
    if (!stagedSelection) return;
    startEnhancementProcess(stagedSelection.originalRect, stagedSelection.screenRect, stagedSelection.canvasDataUrl);
    setStagedSelection(null);
  }, [stagedSelection, startEnhancementProcess]);

  const runEnhancementJob = useCallback(async () => {
    if (!enhancementJob || !image) return;
    setIsProcessing(true);
    try {
        const { originalRect, canvasWithSelectionDataUrl, pixelatedSrc } = enhancementJob;
        const descriptionHistory = history.slice(0, historyIndex + 1).map(h => h.description).filter((d): d is ImageDescription => d !== null);
        const description = await serviceDescribeImage(canvasWithSelectionDataUrl, descriptionHistory);
        setNewHistoryEntryData({ description, originalRect });
        const sourceImageWidth = image.naturalWidth;
        const sourceImageHeight = image.naturalHeight;
        const padding = 0.25;
        const paddedX = originalRect.x - originalRect.w * padding;
        const paddedY = originalRect.y - originalRect.h * padding;
        const paddedW = originalRect.w * (1 + 2 * padding);
        const paddedH = originalRect.h * (1 + 2 * padding);
        const finalPaddedX = Math.max(0, paddedX);
        const finalPaddedY = Math.max(0, paddedY);
        const finalPaddedX2 = Math.min(sourceImageWidth, paddedX + paddedW);
        const finalPaddedY2 = Math.min(sourceImageHeight, paddedY + paddedH);
        const paddedRect = { x: finalPaddedX, y: finalPaddedY, w: finalPaddedX2 - finalPaddedX, h: finalPaddedY2 - finalPaddedY };
        const aspect = paddedRect.h / paddedRect.w;
        const targetWidth = 512 * (1.+padding);
        const targetHeight = Math.round(targetWidth * aspect);
        const croppedForEnhancement = await cropImage(image, paddedRect, targetWidth, targetHeight, false);
        const prompts = [...descriptionHistory.map(d=>(d.prompt || '')), description.prompt || ''];
        const { imageSrc: enhancedPaddedSrc } = await serviceEnhance(croppedForEnhancement, prompts);

        const enhancedPaddedImage = await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = enhancedPaddedSrc;
        });
        const finalCropRect = {
            x: enhancedPaddedImage.naturalWidth * ((originalRect.x - paddedRect.x) / paddedRect.w),
            y: enhancedPaddedImage.naturalHeight * ((originalRect.y - paddedRect.y) / paddedRect.h),
            w: enhancedPaddedImage.naturalWidth * (originalRect.w / paddedRect.w),
            h: enhancedPaddedImage.naturalHeight * (originalRect.h / paddedRect.h),
        };
        const finalImageWidth = 1024;
        const finalImageHeight = Math.round(finalImageWidth * (originalRect.h / originalRect.w));
        const enhancedSrc = await cropImage(enhancedPaddedImage, finalCropRect, finalImageWidth, finalImageHeight, false);
        setPixelatedImageSrc(pixelatedSrc);
        setEnhancedImageSrc(enhancedSrc);
        setAppState(AppState.ENHANCED);
    } catch (error) {
        console.error("Enhancement process failed:", error);
        const fallbackSrc = await cropImage(image, enhancementJob.originalRect, enhancementJob.originalRect.w * 2, enhancementJob.originalRect.h * 2, false);
        setPixelatedImageSrc(enhancementJob.pixelatedSrc);
        setEnhancedImageSrc(fallbackSrc);
        setAppState(AppState.ENHANCED);
    } finally {
        setEnhancementJob(null);
        setIsProcessing(false);
    }
  }, [enhancementJob, image, history, historyIndex]);
  
  const handleEnhancementComplete = useCallback(() => {
    if (enhancedImageSrc && newHistoryEntryData) {
        const newStep: HistoryStep = { imageSrc: enhancedImageSrc, description: newHistoryEntryData.description, originalRect: newHistoryEntryData.originalRect };
        const newHistory = history.slice(0, historyIndex + 1);
        setHistory([...newHistory, newStep]);
        setHistoryIndex(newHistory.length);
        const newImage = new Image();
        newImage.onload = () => {
            setImage(newImage);
            setFinalImageSrc(enhancedImageSrc);
            setEnhancedImageSrc(null);
            setFinalEnhancementRect(null);
            setNewHistoryEntryData(null);
            setDisplaySelection(null);
            setAppState(AppState.LOADED);
        }
        newImage.src = enhancedImageSrc;
    }
  }, [enhancedImageSrc, newHistoryEntryData, history, historyIndex]);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileDrop(e.dataTransfer.files[0]);
      e.dataTransfer.clearData();
    }
  };

  const handleUndo = useCallback(() => {
    if (historyIndex <= 0 || appState === AppState.ENHANCING || isGeneratingGif) return;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    const nextStep = history[newIndex + 1];
    setDisplaySelection(nextStep?.originalRect || null);
    const newImageSrc = history[newIndex].imageSrc;
    const img = new Image();
    img.onload = () => { setImage(img); setFinalImageSrc(newImageSrc); };
    img.src = newImageSrc;
    setStagedSelection(null);
  }, [history, historyIndex, appState, isGeneratingGif]);

  const handleRedo = useCallback(() => {
    if (historyIndex >= history.length - 1 || appState === AppState.ENHANCING || isGeneratingGif) return;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    const nextStep = history[newIndex + 1];
    setDisplaySelection(nextStep?.originalRect || null);
    const newImageSrc = history[newIndex].imageSrc;
    const img = new Image();
    img.onload = () => { setImage(img); setFinalImageSrc(newImageSrc); };
    img.src = newImageSrc;
    setStagedSelection(null);
  }, [history, historyIndex, appState, isGeneratingGif]);

  const handleRegenerate = useCallback(async () => {
    if (historyIndex <= 0 || appState === AppState.ENHANCING || isGeneratingGif) return;
    setAppState(AppState.ENHANCING);
    setStagedSelection(null);
    const previousStep = history[historyIndex - 1];
    const originalRect = history[historyIndex].originalRect;
    if (!originalRect) { setAppState(AppState.LOADED); return; }
    const sourceImage = new Image();
    sourceImage.crossOrigin = "anonymous";
    sourceImage.onload = async () => {
      try {
        const descriptionHistory = history.slice(0, historyIndex).map(h => h.description).filter((d): d is ImageDescription => d !== null);
        const croppedForDescription = await cropImage(sourceImage, originalRect, originalRect.w, originalRect.h, false);
        const description = await serviceDescribeImage(croppedForDescription, descriptionHistory);
        const sourceImageWidth = sourceImage.naturalWidth;
        const sourceImageHeight = sourceImage.naturalHeight;
        const padding = 0.5;
        const paddedX = originalRect.x - originalRect.w * padding;
        const paddedY = originalRect.y - originalRect.h * padding;
        const paddedW = originalRect.w * (1 + 2 * padding);
        const paddedH = originalRect.h * (1 + 2 * padding);
        const finalPaddedX = Math.max(0, paddedX);
        const finalPaddedY = Math.max(0, paddedY);
        const finalPaddedX2 = Math.min(sourceImageWidth, paddedX + paddedW);
        const finalPaddedY2 = Math.min(sourceImageHeight, paddedY + paddedH);
        const paddedRect = { x: finalPaddedX, y: finalPaddedY, w: finalPaddedX2 - finalPaddedX, h: finalPaddedY2 - finalPaddedY };
        const aspect = paddedRect.h / paddedRect.w;
        const targetWidth = 512;
        const targetHeight = Math.round(targetWidth * aspect);
        const croppedForEnhancement = await cropImage(sourceImage, paddedRect, targetWidth, targetHeight, false);
        const prompts = [...descriptionHistory.map(d=>(d.prompt || '')), description.prompt || ''];
        const { imageSrc: enhancedPaddedSrc } = await serviceEnhance(croppedForEnhancement, prompts);

        const enhancedPaddedImage = await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => resolve(img); img.onerror = reject; img.src = enhancedPaddedSrc;
        });
        const finalCropRect = {
            x: enhancedPaddedImage.naturalWidth * ((originalRect.x - paddedRect.x) / paddedRect.w),
            y: enhancedPaddedImage.naturalHeight * ((originalRect.y - paddedRect.y) / paddedRect.h),
            w: enhancedPaddedImage.naturalWidth * (originalRect.w / paddedRect.w),
            h: enhancedPaddedImage.naturalHeight * (originalRect.h / paddedRect.h),
        };
        const finalImageWidth = 1024;
        const finalImageHeight = Math.round(finalImageWidth * (originalRect.h / originalRect.w));
        const enhancedSrc = await cropImage(enhancedPaddedImage, finalCropRect, finalImageWidth, finalImageHeight, false);
        const newStep: HistoryStep = { imageSrc: enhancedSrc, description, originalRect };
        const newHistory = [...history.slice(0, historyIndex), newStep];
        setHistory(newHistory);
        setDisplaySelection(null);
        const newImage = new Image();
        newImage.onload = () => { setImage(newImage); setFinalImageSrc(enhancedSrc); setAppState(AppState.LOADED); };
        newImage.src = enhancedSrc;
      } catch (error) { console.error("Regeneration failed:", error); setAppState(AppState.LOADED); }
    };
    sourceImage.src = previousStep.imageSrc;
  }, [history, historyIndex, appState, isGeneratingGif]);

  const handleExportGif = useCallback(async () => {
    if (historyIndex < 1) return;
    setIsGeneratingGif(true);
    try {
      const blob = await generateZoomGif(history.slice(0, historyIndex + 1));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'enhancement-zoom.gif'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (error) { console.error("Failed to generate GIF:", error);
    } finally { setIsGeneratingGif(false); }
  }, [history, historyIndex]);

  const stopPropagation = (ev:MouseEvent<HTMLButtonElement>)=>{ ev.stopPropagation(); }

  return (
    <div ref={containerRef} className="fixed inset-0 bg-black flex flex-col items-center justify-center p-4 text-white" onDragOver={handleDragOver} onDrop={handleDrop}>
      {isProcessing && <ProcessingAnimation />}
      {appState === AppState.IDLE && <DropZone onUploadClick={handleUploadClick} />}
      
      <div className="w-full h-full flex items-center justify-center relative">
        {finalImageSrc && ![AppState.ENHANCED, AppState.ENHANCING].includes(appState) && (
          <ImageDisplay imageSrc={finalImageSrc} onStageSelection={handleStageSelection} isEnhancing={appState === AppState.ENHANCING || isGeneratingGif} historicalSelection={displaySelection} stagedSelectionRect={stagedSelection?.screenRect} useFixedSelectionBox={useFixedSelectionBox} fixedSelectionSizePercentage={fixedSelectionSizePercentage} />
        )}
      </div>

      {appState === AppState.LOADED && (
          <div className="absolute top-4 right-4 z-20">
              <button
                  onClick={handleUploadClick}
                  onMouseDownCapture={stopPropagation}
                  className="px-4 py-2 text-white bg-black/50 backdrop-blur-sm border border-white/30 rounded-md hover:bg-white/20 transition-colors"
              >
                  Upload New Image
              </button>
          </div>
      )}

      {enhancementJob && appState === AppState.ENHANCING && finalEnhancementRect && ( <SelectionAnimator rect={enhancementJob.screenRect} finalRect={finalEnhancementRect} src={enhancementJob.pixelatedSrc} onComplete={runEnhancementJob} /> )}
      {appState === AppState.ENHANCED && pixelatedImageSrc && enhancedImageSrc && finalEnhancementRect && (
        <div className="absolute" style={{ top: `${finalEnhancementRect.y}px`, left: `${finalEnhancementRect.x}px`, width: `${finalEnhancementRect.w}px`, height: `${finalEnhancementRect.h}px`, }}>
          <PixelDissolve lowResSrc={pixelatedImageSrc} highResSrc={enhancedImageSrc} onComplete={handleEnhancementComplete} />
        </div>
      )}

      {appState === AppState.LOADED && history.length >= 1 && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 flex items-center gap-4 bg-black/50 p-2 rounded-md border border-white/60">
          {stagedSelection ? (
            <>
              <button onClick={() => setStagedSelection(null)} onMouseDownCapture={stopPropagation} className="px-3 py-1 text-white hover:bg-white/20 rounded transition-colors">Cancel</button>
              <button onClick={handleProcessClick} onMouseDownCapture={stopPropagation} className="px-3 py-1 bg-white/20 text-white font-bold hover:bg-white/30 rounded transition-colors animate-pulse">Process</button>
            </>
          ) : (
            <>
              <button onClick={handleUndo} onMouseDownCapture={stopPropagation} disabled={historyIndex <= 0 || isGeneratingGif} className="px-3 py-1 text-white disabled:text-gray-500 disabled:cursor-not-allowed hover:enabled:bg-white/20 rounded transition-colors" aria-label="Undo">&lt;</button>
              <div className="flex flex-col items-center">
                <span className="text-xs w-24 text-center">Step: {historyIndex + 1} / {history.length}</span>
                <span className="text-xs w-24 text-center font-bold">Zoom: {historyIndex + 1}x</span>
              </div>
              <button onClick={handleRedo} onMouseDownCapture={stopPropagation} disabled={historyIndex >= history.length - 1 || isGeneratingGif} className="px-3 py-1 text-white disabled:text-gray-500 disabled:cursor-not-allowed hover:enabled:bg-white/20 rounded transition-colors" aria-label="Redo">&gt;</button>
              <button onClick={handleRegenerate} onMouseDownCapture={stopPropagation} disabled={historyIndex <= 0 || isGeneratingGif} className="px-3 py-1 text-white disabled:text-gray-500 disabled:cursor-not-allowed hover:enabled:bg-white/20 rounded transition-colors">Re-gen</button>
              <button onClick={handleExportGif} onMouseDownCapture={stopPropagation} disabled={historyIndex < 1 || isGeneratingGif} className="px-3 py-1 text-white disabled:text-gray-500 disabled:cursor-not-allowed hover:enabled:bg-white/20 rounded transition-colors">{isGeneratingGif ? 'Generating...' : 'Export GIF'}</button>
              <button onClick={resetState} onMouseDownCapture={stopPropagation} className="px-3 py-1 text-white hover:enabled:bg-white/20 rounded transition-colors">Reset</button>
            </>
          )}
        </div>
      )}
      <input type="file" ref={fileInputRef} onChange={handleFileSelect} style={{ display: 'none' }} accept="image/*" />
      <StatusBar state={appState} useFixedSelectionBox={useFixedSelectionBox} isInitialState={history.length <= 1} onUploadClick={handleUploadClick}/>
    </div>
  );
}