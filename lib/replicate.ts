import Replicate from "replicate";

const getReplicate = () => {
    const rawToken = process.env.REPLICATE_API_TOKEN;
    console.log("🔍 [DEBUG] Raw token from env:", rawToken ? `${rawToken.substring(0, 4)}...${rawToken.substring(rawToken.length - 4)} (length: ${rawToken.length})` : "undefined");

    const token = rawToken?.replace(/['"]/g, '')?.trim();
    console.log("🔍 [DEBUG] Cleaned token:", token ? `${token.substring(0, 4)}...${token.substring(token.length - 4)} (length: ${token.length})` : "undefined");

    if (!token) {
        console.error("❌ REPLICATE_API_TOKEN is missing!");
        throw new Error("REPLICATE_API_TOKEN environment variable is not set");
    }

    if (!token.startsWith("r8_")) {
        console.error("❌ Token doesn't start with r8_. Starts with:", token.substring(0, 4));
        throw new Error("Invalid REPLICATE_API_TOKEN format");
    }

    console.log("✅ Creating Replicate client with token");
    return new Replicate({ auth: token });
};

export function validateToken() {
    const rawToken = process.env.REPLICATE_API_TOKEN;
    const t = rawToken?.replace(/['"]/g, '')?.trim();
    if (!t) return { valid: false, reason: "Missing" };
    if (!t.startsWith("r8_")) return { valid: false, reason: `Invalid format (starts with ${t.substring(0, 3)}..., expected r8_)` };
    if (t.length < 40) return { valid: false, reason: `Too short (length: ${t.length}, expected ~40)` };
    return { valid: true, token: t, length: t.length };
}

// Models
const MODELS = {
    FLUX_FILL: "black-forest-labs/flux-fill-pro",
    SAM_2: "facebook/sam-2-hiera-large",
    FLUX_KONTEXT: "black-forest-labs/flux-kontext-pro",
    FLUX_MULTI_IMAGE: "flux-kontext-apps/multi-image-kontext-pro",
    QWEN_IMAGE_EDIT: "qwen/qwen-image-edit-2511",
    NANO_BANANA: "google/nano-banana-pro",  // Google's image editing model (Pro version)
    GROUNDED_SAM: "schananas/grounded_sam:ee871c19efb1941f55f66a3d7d960428c8a5afcb77449547fe8e5a3ab9ebc21c",
    FAST_SAM: "casia-iva-lab/fastsam:371aeee1ce0c5efd25bbef7a4527ec9e59188b963ebae1eeb851ddc145685c17",
};

/**
 * Helper to handle various Replicate output formats (URLs, base64, Streams)
 */
async function handleReplicateOutput(output: any): Promise<string> {
    console.log("[Replicate] Raw Output Type:", output?.constructor?.name);
    console.log("[Replicate] Output is Array:", Array.isArray(output));

    // Handle array output (Qwen returns array of file objects)
    if (Array.isArray(output)) {
        console.log("[Replicate] Array length:", output.length);
        const firstItem = output[0];

        // Check if it's a file object with a .url() method
        // Note: .url() returns a URL object, not a string - must convert
        if (firstItem && typeof firstItem.url === 'function') {
            console.log("[Replicate] Extracting URL from file object...");
            return firstItem.url().toString();
        }

        // Handle ReadableStream items in array
        if (firstItem instanceof ReadableStream || (firstItem && typeof (firstItem as any).getReader === 'function')) {
            console.log("[Replicate] First item is a ReadableStream, converting to Base64...");
            const stream = firstItem as ReadableStream;
            const reader = stream.getReader();
            const chunks: Uint8Array[] = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }

            const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            const combined = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                combined.set(chunk, offset);
                offset += chunk.length;
            }

            const buffer = Buffer.from(combined);
            const base64 = buffer.toString('base64');
            return `data:image/jpeg;base64,${base64}`;
        }

        // Otherwise just return the first item (might be a URL string)
        return firstItem;
    }

    // Handle ReadableStream output (common in newer Replicate SDKs for file outputs)
    if (output instanceof ReadableStream || (output && typeof (output as any).getReader === 'function')) {
        console.log("[Replicate] Output is a ReadableStream, converting to Base64...");
        const stream = output as ReadableStream;
        const reader = stream.getReader();
        const chunks: Uint8Array[] = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }

        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
        }

        const buffer = Buffer.from(combined);
        const base64 = buffer.toString('base64');
        return `data:image/jpeg;base64,${base64}`;
    }

    // Handle file object with .url() method
    // Note: .url() returns a URL object, not a string - must convert
    if (output && typeof output.url === 'function') {
        console.log("[Replicate] Extracting URL from file object...");
        return output.url().toString();
    }

    return output;
}

/**
 * Process images using Google Nano Banana.
 * @param carImage Main car image (base64 or URL)
 * @param wheelImage Reference wheel image (base64 or URL)
 * @param prompt Detailed instruction
 */
export async function processQwenImageEdit(carImage: string, wheelImage: string, prompt: string) {
    console.log(`[Replicate] Processing with Google Nano Banana Pro...`);
    console.log(`[Replicate] Prompt: ${prompt.substring(0, 150)}...`);
    console.log(`[Replicate] Input images: [0] Car (${carImage.length} chars), [1] Wheel reference (${wheelImage.length} chars)`);

    try {
        const output = await getReplicate().run(MODELS.NANO_BANANA as any, {
            input: {
                prompt,
                image_input: [carImage, wheelImage],
                aspect_ratio: "match_input_image",
                resolution: "1K",
                safety_filter_level: "block_only_high",
                output_format: "png",
            },
        });

        return await handleReplicateOutput(output);
    } catch (error) {
        console.error("[Replicate] Nano Banana Pro failed:", error);
        throw error;
    }
}

/**
 * Process single image with Google Nano Banana for paint color changes.
 * @param image Car image (base64 or URL)
 * @param prompt Paint change instruction
 */
export async function processQwenPaint(image: string, prompt: string) {
    console.log(`[Replicate] Processing paint with Nano Banana Pro...`);
    console.log(`[Replicate] Prompt: ${prompt}`);
    console.log(`[Replicate] Image length: ${image.length}`);

    try {
        const output = await getReplicate().run(MODELS.NANO_BANANA as any, {
            input: {
                prompt,
                image_input: [image],
                aspect_ratio: "match_input_image",
                resolution: "1K",
                safety_filter_level: "block_only_high",
                output_format: "png",
            },
        });

        return await handleReplicateOutput(output);
    } catch (error) {
        console.error("[Replicate] Nano Banana Pro Paint failed:", error);
        throw error;
    }
}

/**
 * Generate a mask for a specific object in an image using SAM 2.
 * @param image The input image (File, Blob, or URL)
 * @param prompt The object to detect (e.g., "wheels", "car")
 * @returns The mask URL or base64 data
 */
export async function generateMask(image: string, prompt: string) {
    // TODO: Implement SAM 2 logic
    // This usually requires uploading the image first or passing a URL
    console.log(`Generating mask for '${prompt}' on image...`);

    // Placeholder for now as SAM 2 API specifics need to be verified
    const output = await getReplicate().run(MODELS.SAM_2 as any, {
        input: {
            image,
            mask_prompt: prompt,
        },
    });

    return output;
}

/**
 * Modify an image using Flux Fill Pro (Inpainting).
 * @param image The original image (base64 or URL)
 * @param mask The mask image (white = area to inpaint, black = preserve)
 * @param prompt Desired change (e.g., "chrome mesh wheels with intricate lattice design")
 * @param options Optional parameters for fine-tuning
 * @returns The URL of the modified image
 */
export async function inpaintImage(
    image: string,
    mask: string,
    prompt: string
) {
    console.log(`[Replicate] Inpainting with Flux Fill Pro...`);
    console.log(`[Replicate] Prompt: "${prompt}"`);
    console.log(`[Replicate] Image length: ${image.length}, Mask length: ${mask.length}`);

    try {
        const output = await getReplicate().run("black-forest-labs/flux-fill-pro", {
            input: {
                image,
                mask,
                prompt,
            },
        });

        console.log(`[Replicate] Flux Fill Pro completed`);
        return await handleReplicateOutput(output);
    } catch (error) {
        console.error("[Replicate] Flux Fill Pro failed:", error);
        throw error;
    }
}

/**
 * Process an image using Flux Kontext Pro (Image-to-Image).
 * @param image The input image URL
 * @param prompt The transformation prompt
 * @returns The URL of the processed image
 */
export async function processImageKontext(image: string, prompt: string) {
    console.log(`[Replicate] Processing with Flux Kontext Pro: '${prompt}'...`);
    // console.log(`[Replicate] Image string length: ${image.length}`);

    try {
        const output = await getReplicate().run(MODELS.FLUX_KONTEXT as any, {
            input: {
                prompt,
                input_image: image,
                aspect_ratio: "match_input_image",
                output_format: "jpg",
                safety_tolerance: 2,
            },
        });

        return await handleReplicateOutput(output);
    } catch (error) {
        console.error("[Replicate] Execution failed:", error);
        throw error;
    }
}

/**
 * Generate a mask for specific objects using Grounded SAM (Grounding DINO + SAM).
 * This allows text-prompted segmentation - specify what to mask with natural language.
 * @param image The input image (base64 or URL)
 * @param maskPrompt What to segment (e.g., "wheels", "car wheels", "rims")
 * @param negativeMaskPrompt Optional - what to exclude from mask
 * @param adjustmentFactor Mask adjustment: negative = erosion (shrink), positive = dilation (expand)
 * @returns Object with mask URLs: { annotated, negative, mask, inverted }
 */
export async function generateGroundedSamMask(
    image: string,
    maskPrompt: string,
    negativeMaskPrompt: string = "",
    adjustmentFactor: number = 0
): Promise<{ annotated: string; negative: string; mask: string; inverted: string }> {
    console.log(`[Replicate] Generating mask with Grounded SAM for: "${maskPrompt}"...`);

    try {
        const output = await getReplicate().run(MODELS.GROUNDED_SAM as any, {
            input: {
                image,
                mask_prompt: maskPrompt,
                negative_mask_prompt: negativeMaskPrompt,
                adjustment_factor: adjustmentFactor,
            },
        });

        console.log("[Replicate] Grounded SAM raw output type:", typeof output, Array.isArray(output) ? `(array of ${output.length})` : "");

        // Check for error in output
        if (!output) {
            throw new Error("Grounded SAM returned no output");
        }

        // Output is an array of 4 items: [annotated, negative, mask, inverted]
        // These can be ReadableStreams, FileObjects, or URLs - need to convert to base64
        if (Array.isArray(output) && output.length >= 4) {
            const processItem = async (item: any): Promise<string> => {
                // Handle ReadableStream
                if (item && typeof item.getReader === 'function') {
                    const reader = item.getReader();
                    const chunks: Uint8Array[] = [];
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        chunks.push(value);
                    }
                    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
                    const combined = new Uint8Array(totalLength);
                    let offset = 0;
                    for (const chunk of chunks) {
                        combined.set(chunk, offset);
                        offset += chunk.length;
                    }
                    const buffer = Buffer.from(combined);
                    return `data:image/png;base64,${buffer.toString('base64')}`;
                }
                // Handle FileOutput with .url() method
                // Note: .url() returns a URL object, not a string - must convert
                if (item && typeof item.url === 'function') {
                    return item.url().toString();
                }
                // Handle string URL
                if (typeof item === 'string') {
                    return item;
                }
                return String(item);
            };

            const [annotated, negative, mask, inverted] = await Promise.all([
                processItem(output[0]),
                processItem(output[1]),
                processItem(output[2]),
                processItem(output[3]),
            ]);

            console.log("[Replicate] Grounded SAM masks processed to base64/URLs");

            return {
                annotated,  // Visual overlay showing detected regions
                negative,   // Negative mask visualization
                mask,       // Raw mask (white = detected, black = background)
                inverted,   // Inverted mask (black = detected, white = background)
            };
        }

        throw new Error(`Unexpected Grounded SAM output format: ${JSON.stringify(output)}`);
    } catch (error) {
        console.error("[Replicate] Grounded SAM failed:", error);
        throw error;
    }
}

/**
 * Generate a mask using FastSAM (50x faster than original SAM).
 * Supports text prompts for object detection.
 * @param image The input image (base64 or URL)
 * @param textPrompt What to segment (e.g., "wheels", "car wheels")
 * @param options Optional parameters for fine-tuning
 * @returns Base64 mask image (white = detected regions)
 */
export async function generateFastSamMask(
    image: string,
    textPrompt: string,
    options: {
        iou?: number;        // IOU threshold 0-1 (default 0.7)
        conf?: number;       // Confidence threshold 0-1 (default 0.25)
        retina?: boolean;    // High-res masks (default true)
        imageSize?: number;  // 512-1024 (default 640 for speed)
    } = {}
): Promise<string> {
    // Use smaller defaults for faster processing (640 is default, not 1024)
    const { iou = 0.7, conf = 0.25, retina = true, imageSize = 640 } = options;

    console.log(`[Replicate] Generating mask with FastSAM for: "${textPrompt}"...`);
    console.log(`[Replicate] FastSAM params: iou=${iou}, conf=${conf}, size=${imageSize}`);
    const startTime = Date.now();

    try {
        const output = await getReplicate().run(MODELS.FAST_SAM as any, {
            input: {
                input_image: image,
                text_prompt: textPrompt,
                iou,
                conf,
                retina,
                image_size: imageSize,
                withContours: false,
            },
        });

        const elapsed = Date.now() - startTime;
        console.log(`[Replicate] FastSAM completed in ${elapsed}ms`);

        // Output is a FileOutput object with .url() method
        const result = await handleReplicateOutput(output);
        return result;
    } catch (error) {
        console.error("[Replicate] FastSAM failed:", error);
        throw error;
    }
}

export default getReplicate;
