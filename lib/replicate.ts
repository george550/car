import Replicate from "replicate";

const token = process.env.REPLICATE_API_TOKEN?.trim();

const replicate = new Replicate({
    auth: token,
});

if (!token) {
    console.error("❌ REPLICATE_API_TOKEN is not set in environment variables!");
} else {
    console.log(`✅ REPLICATE_API_TOKEN is present (starts with: ${token.substring(0, 4)}...)`);
}

// Models
const MODELS = {
    FLUX_FILL: "black-forest-labs/flux-fill-pro",
    SAM_2: "facebook/sam-2-hiera-large",
    FLUX_KONTEXT: "black-forest-labs/flux-kontext-pro",
};

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
    const output = await replicate.run(MODELS.SAM_2 as any, {
        input: {
            image,
            mask_prompt: prompt,
        },
    });

    return output;
}

/**
 * Modify an image using Flux Fill (Inpainting).
 * @param image The original image
 * @param mask The mask defining the area to change
 * @param prompt Desired change (e.g., "bronze te37 wheels")
 * @returns The URL of the modified image
 */
export async function inpaintImage(image: string, mask: string, prompt: string) {
    console.log(`Inpainting with prompt: '${prompt}'...`);

    const output = await replicate.run(MODELS.FLUX_FILL as any, {
        input: {
            image,
            mask,
            prompt,
            steps: 25, // Standard quality
            guidance: 3.0,
            output_format: "jpg",
            safety_tolerance: 2,
        },
    });

    return output;
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
        const output = await replicate.run(MODELS.FLUX_KONTEXT as any, {
            input: {
                prompt,
                input_image: image,
                aspect_ratio: "match_input_image",
                output_format: "jpg",
                safety_tolerance: 2,
            },
        });

        console.log("[Replicate] Raw Output Type:", output?.constructor?.name);

        // Handle ReadableStream output (common in newer Replicate SDKs for file outputs)
        if (output instanceof ReadableStream || (output && typeof (output as any).getReader === 'function')) {
            console.log("[Replicate] Output is a ReadableStream, converting to Base64...");
            const stream = output as ReadableStream;
            const reader = stream.getReader();
            const chunks = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }

            // Allow Uint8Array chunks to be concatenated
            const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            const combined = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                combined.set(chunk, offset);
                offset += chunk.length;
            }

            const buffer = Buffer.from(combined);
            const base64 = buffer.toString('base64');
            const dataUrl = `data:image/jpeg;base64,${base64}`;
            console.log("[Replicate] Converted stream to Base64 URL (length: " + dataUrl.length + ")");
            return dataUrl;
        }

        console.log("[Replicate] Success:", output);
        return output;
    } catch (error) {
        console.error("[Replicate] Execution failed:", error);
        throw error;
    }
}

export default replicate;
