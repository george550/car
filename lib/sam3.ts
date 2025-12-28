/**
 * SAM3 (Segment Anything 3) Integration via Replicate
 *
 * Uses lucataco/sam3-video model which supports text-prompted segmentation.
 * Can process both images and videos with text prompts like "car wheel".
 *
 * IMPORTANT: This model returns video/ZIP output even for single images.
 * We use return_zip=true to get PNG frames, then extract the first frame.
 *
 * Model: lucataco/sam3-video
 * Docs: https://replicate.com/lucataco/sam3-video
 */

import Replicate from "replicate";
import JSZip from "jszip";

const SAM3_MODEL = "lucataco/sam3-video:8cbab4c2a3133e679b5b863b80527f6b5c751ec7b33681b7e0b7c79c749df961";

/**
 * Get Replicate client
 */
function getReplicate() {
  const token = process.env.REPLICATE_API_TOKEN?.replace(/['"]/g, "")?.trim();
  if (!token) {
    throw new Error("REPLICATE_API_TOKEN environment variable is not set");
  }
  return new Replicate({ auth: token });
}

export interface Sam3Input {
  video: string;  // Can be image or video URL/base64
  prompt: string;  // Text prompt like "car wheel"
  negative_prompt?: string;  // Objects to exclude
  mask_only?: boolean;  // Return black/white mask
  mask_color?: "green" | "red" | "blue" | "yellow" | "cyan" | "magenta";
  mask_opacity?: number;  // 0.0 to 1.0
  return_zip?: boolean;  // Return ZIP of frame masks
}

/**
 * Run SAM3 segmentation on an image using text prompt.
 * Returns URL to the mask output.
 *
 * @param image - Base64 image data URI or URL
 * @param prompt - Text description of what to segment (e.g., "car wheel rim")
 * @param options - Additional options
 * @returns URL to mask image/video
 */
export async function segmentWithSam3(
  image: string,
  prompt: string,
  options: {
    negativePrompt?: string;
    maskOnly?: boolean;
  } = {}
): Promise<string> {
  const replicate = getReplicate();

  console.log(`[SAM3] Segmenting with prompt: "${prompt}"`);
  const startTime = Date.now();

  const input: Sam3Input = {
    video: image,  // SAM3 accepts images too
    prompt,
    mask_only: options.maskOnly ?? true,  // We want the mask for inpainting
    // Note: mask_color only applies when mask_only=false (colored overlay)
    // When mask_only=true, output is automatically black/white
    mask_opacity: 1.0,
    return_zip: true,  // Return ZIP with PNG frames (we extract first frame)
  };

  if (options.negativePrompt) {
    input.negative_prompt = options.negativePrompt;
  }

  const maxRetries = 2;
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`[SAM3] Retry attempt ${attempt}/${maxRetries}...`);
        // Wait before retry (exponential backoff)
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }

      const output = await replicate.run(SAM3_MODEL as `${string}/${string}`, { input });

      const elapsed = Date.now() - startTime;
      console.log(`[SAM3] Model completed in ${elapsed}ms`);

      // Get the ZIP URL
      let zipUrl: string;
      if (output && typeof (output as any).url === "function") {
        zipUrl = (output as any).url().toString();
      } else if (typeof output === "string") {
        zipUrl = output;
      } else if (Array.isArray(output) && output[0]) {
        const first = output[0];
        zipUrl = typeof first.url === "function" ? first.url().toString() : String(first);
      } else {
        throw new Error(`Unexpected SAM3 output format: ${JSON.stringify(output)}`);
      }

      console.log(`[SAM3] ZIP URL: ${zipUrl.substring(0, 80)}...`);

      // Download and extract first PNG from ZIP
      const maskBase64 = await extractFirstPngFromZip(zipUrl);
      console.log(`[SAM3] Extracted mask PNG (${maskBase64.length} chars)`);

      return maskBase64;
    } catch (error: any) {
      lastError = error;
      console.error(`[SAM3] Attempt ${attempt} failed:`, error?.message || error);

      // Don't retry on certain errors
      if (error?.message?.includes("token") || error?.message?.includes("401")) {
        break;
      }
    }
  }

  console.error("[SAM3] All attempts failed:", lastError);
  throw lastError;
}

/**
 * Download a ZIP file and extract the first PNG as base64.
 */
async function extractFirstPngFromZip(zipUrl: string): Promise<string> {
  console.log("[SAM3] Downloading ZIP...");

  const response = await fetch(zipUrl);
  if (!response.ok) {
    throw new Error(`Failed to download ZIP: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  console.log(`[SAM3] ZIP downloaded: ${arrayBuffer.byteLength} bytes`);

  const zip = await JSZip.loadAsync(arrayBuffer);

  // List all files in ZIP for debugging
  const allFiles = Object.keys(zip.files);
  console.log(`[SAM3] ZIP contains ${allFiles.length} files:`, allFiles);

  // Find the first PNG file
  const pngFiles = allFiles.filter(name => name.endsWith(".png"));
  if (pngFiles.length === 0) {
    throw new Error(`No PNG files found in ZIP. Files: ${allFiles.join(", ")}`);
  }

  // Sort to get first frame (usually named 0000.png or similar)
  pngFiles.sort();
  const firstPng = pngFiles[0];
  console.log(`[SAM3] Extracting: ${firstPng}`);

  const pngData = await zip.files[firstPng].async("base64");
  return `data:image/png;base64,${pngData}`;
}

/**
 * Detect wheels in a car image and return a binary mask.
 * Uses SAM3 text-prompted segmentation.
 *
 * @param image - Base64 image or URL
 * @returns URL to mask image (white = wheels, black = background)
 */
export async function detectWheelsMask(
  image: string
): Promise<string> {
  console.log("[SAM3] Detecting wheels...");

  // Use specific prompt for car wheels
  const maskUrl = await segmentWithSam3(
    image,
    "car wheel rim tire",
    {
      maskOnly: true,
      negativePrompt: "background sky ground building",
    }
  );

  console.log("[SAM3] Wheel mask generated");
  return maskUrl;
}

/**
 * Detect car body panels and return a mask.
 * Uses SAM3 text-prompted segmentation.
 *
 * @param image - Base64 image or URL
 * @returns URL to mask image (white = body, black = background)
 */
export async function detectBodyMask(
  image: string
): Promise<string> {
  console.log("[SAM3] Detecting car body...");

  const maskUrl = await segmentWithSam3(
    image,
    "car",  // Simple prompt - SAM3 will segment the entire car
    {
      maskOnly: true,
      negativePrompt: "wheel tire rim",  // Exclude wheels from the mask
    }
  );

  console.log("[SAM3] Body mask generated");
  return maskUrl;
}

/**
 * Validate Replicate API token for SAM3
 */
export function validateSam3Token(): { valid: boolean; reason?: string } {
  const token = process.env.REPLICATE_API_TOKEN?.replace(/['"]/g, "")?.trim();
  if (!token) {
    return { valid: false, reason: "REPLICATE_API_TOKEN not set" };
  }
  if (!token.startsWith("r8_")) {
    return { valid: false, reason: "Token should start with r8_" };
  }
  return { valid: true };
}

// Keep backward compatibility with old function name
export const validateRoboflowKey = validateSam3Token;
