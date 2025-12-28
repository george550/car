import sharp from "sharp";

/**
 * Extract changed pixels as a transparent PNG layer.
 * Pixels that changed significantly become opaque, unchanged pixels become transparent.
 * This allows overlaying the layer on top of the original image.
 *
 * @param originalImage - Base64 or URL of the original image
 * @param generatedImage - Base64/URL of the AI-generated output
 * @param threshold - Color difference threshold (default 25)
 * @param regionMask - Optional mask image (white=include, black=exclude)
 * @param maskMode - "include" keeps only pixels inside mask, "exclude" keeps only pixels outside mask
 * @returns Base64 PNG with transparency (changed pixels opaque, unchanged transparent)
 */
export async function extractDifferenceLayer(
    originalImage: string,
    generatedImage: string,
    threshold: number = 25,
    regionMask?: string,
    maskMode: "include" | "exclude" = "include"
): Promise<string> {
    console.log("[MaskUtils] Extracting difference layer...");
    if (regionMask) {
        console.log(`[MaskUtils] Using region mask with mode: ${maskMode}`);
    }

    // Helper to load image from various input types
    const loadImage = async (input: any): Promise<Buffer> => {
        if (typeof input === 'string') {
            if (input.startsWith("data:")) {
                return Buffer.from(input.split(",")[1], "base64");
            } else {
                const response = await fetch(input);
                return Buffer.from(await response.arrayBuffer());
            }
        }
        if (input && typeof input.url === 'function') {
            const url = input.url().toString();
            const response = await fetch(url);
            return Buffer.from(await response.arrayBuffer());
        }
        if (input && typeof input.getReader === 'function') {
            const reader = input.getReader();
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
            return Buffer.from(combined);
        }
        throw new Error(`Unsupported image input type: ${typeof input}`);
    };

    const [originalBuffer, generatedBuffer] = await Promise.all([
        loadImage(originalImage),
        loadImage(generatedImage),
    ]);

    // Get dimensions from original
    const originalMeta = await sharp(originalBuffer).metadata();
    const width = originalMeta.width!;
    const height = originalMeta.height!;

    console.log(`[MaskUtils] Layer dimensions: ${width}x${height}`);

    // Load and process region mask if provided
    let maskRaw: Buffer | null = null;
    if (regionMask) {
        try {
            const maskBuffer = await loadImage(regionMask);
            // Resize mask to match image dimensions and get grayscale values
            maskRaw = await sharp(maskBuffer)
                .resize(width, height, { fit: "fill" })
                .grayscale()
                .raw()
                .toBuffer();
            console.log(`[MaskUtils] Region mask loaded: ${maskRaw.length} bytes`);
        } catch (error) {
            console.error("[MaskUtils] Failed to load region mask:", error);
            // Continue without mask
        }
    }

    // Get raw pixels (RGBA)
    const [originalRaw, generatedRaw] = await Promise.all([
        sharp(originalBuffer).ensureAlpha().raw().toBuffer(),
        sharp(generatedBuffer).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer(),
    ]);

    // Create output buffer for transparent layer
    const layerData = Buffer.alloc(width * height * 4);

    let changedPixels = 0;
    let maskedOutPixels = 0;

    // Extract only changed pixels, filtered by mask if provided
    for (let i = 0; i < width * height; i++) {
        const r1 = originalRaw[i * 4];
        const g1 = originalRaw[i * 4 + 1];
        const b1 = originalRaw[i * 4 + 2];

        const r2 = generatedRaw[i * 4];
        const g2 = generatedRaw[i * 4 + 1];
        const b2 = generatedRaw[i * 4 + 2];

        // Calculate color difference
        const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);

        // Check mask filter if provided
        let passesFilter = true;
        if (maskRaw) {
            const maskValue = maskRaw[i]; // 0-255, white=255, black=0
            const isInMask = maskValue > 128; // Treat >50% as "in mask"

            if (maskMode === "include") {
                // Only keep pixels that are INSIDE the mask (white areas)
                passesFilter = isInMask;
            } else {
                // Only keep pixels that are OUTSIDE the mask (black areas)
                passesFilter = !isInMask;
            }
        }

        if (diff > threshold * 3 && passesFilter) {
            // Pixel changed AND passes filter - copy from generated with full opacity
            layerData[i * 4] = r2;
            layerData[i * 4 + 1] = g2;
            layerData[i * 4 + 2] = b2;
            layerData[i * 4 + 3] = 255; // Opaque
            changedPixels++;
        } else {
            // Pixel unchanged OR filtered out - make transparent
            layerData[i * 4] = 0;
            layerData[i * 4 + 1] = 0;
            layerData[i * 4 + 2] = 0;
            layerData[i * 4 + 3] = 0; // Transparent

            if (diff > threshold * 3 && !passesFilter) {
                maskedOutPixels++;
            }
        }
    }

    if (maskRaw && maskedOutPixels > 0) {
        console.log(`[MaskUtils] Masked out ${maskedOutPixels} pixels that were outside the ${maskMode === "include" ? "wheel" : "body"} region`);
    }

    const changePercent = ((changedPixels / (width * height)) * 100).toFixed(1);
    console.log(`[MaskUtils] Layer extracted: ${changedPixels} changed pixels (${changePercent}%)`);

    // Convert to PNG (preserves transparency)
    const layerBuffer = await sharp(layerData, {
        raw: { width, height, channels: 4 }
    })
        .png()
        .toBuffer();

    console.log("[MaskUtils] Difference layer extraction complete");
    return `data:image/png;base64,${layerBuffer.toString("base64")}`;
}

/**
 * Align a generated image back to the original's composition.
 * Uses phase correlation to detect shift and corrects it.
 *
 * @param originalImage - Base64 or URL of the original image
 * @param generatedImage - Base64 or URL of the generated (shifted) image
 * @returns Base64 of the aligned image
 */
/**
 * Difference-based composite: Take changed pixels from generated, keep unchanged from original.
 * This avoids alignment issues by only taking what Qwen actually modified (the car).
 *
 * @param originalImage - Base64 of the original image
 * @param generatedImage - Base64/URL of Qwen's output (may be shifted)
 * @param threshold - Color difference threshold to consider a pixel "changed" (default 30)
 * @returns Base64 of composited image with original background + generated car
 */
export async function differenceComposite(
    originalImage: string,
    generatedImage: string,
    threshold: number = 30
): Promise<string> {
    console.log("[MaskUtils] Difference-based composite...");

    // Load original
    let originalBuffer: Buffer;
    if (originalImage.startsWith("data:")) {
        originalBuffer = Buffer.from(originalImage.split(",")[1], "base64");
    } else {
        const response = await fetch(originalImage);
        originalBuffer = Buffer.from(await response.arrayBuffer());
    }

    // Load generated
    let generatedBuffer: Buffer;
    if (generatedImage.startsWith("data:")) {
        generatedBuffer = Buffer.from(generatedImage.split(",")[1], "base64");
    } else {
        const response = await fetch(generatedImage);
        generatedBuffer = Buffer.from(await response.arrayBuffer());
    }

    // Get original dimensions
    const originalMeta = await sharp(originalBuffer).metadata();
    const width = originalMeta.width!;
    const height = originalMeta.height!;

    console.log(`[MaskUtils] Dimensions: ${width}x${height}`);

    // Get raw pixels
    const [originalRaw, generatedRaw] = await Promise.all([
        sharp(originalBuffer).ensureAlpha().raw().toBuffer(),
        sharp(generatedBuffer).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer(),
    ]);

    // Create output buffer - start with original
    const outputData = Buffer.alloc(width * height * 4);

    let changedPixels = 0;

    // Compare each pixel - if different enough, take from generated
    for (let i = 0; i < width * height; i++) {
        const r1 = originalRaw[i * 4];
        const g1 = originalRaw[i * 4 + 1];
        const b1 = originalRaw[i * 4 + 2];

        const r2 = generatedRaw[i * 4];
        const g2 = generatedRaw[i * 4 + 1];
        const b2 = generatedRaw[i * 4 + 2];

        // Calculate color difference
        const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);

        if (diff > threshold * 3) {
            // Pixel changed significantly - use generated
            outputData[i * 4] = r2;
            outputData[i * 4 + 1] = g2;
            outputData[i * 4 + 2] = b2;
            outputData[i * 4 + 3] = 255;
            changedPixels++;
        } else {
            // Pixel similar - keep original
            outputData[i * 4] = r1;
            outputData[i * 4 + 1] = g1;
            outputData[i * 4 + 2] = b1;
            outputData[i * 4 + 3] = 255;
        }
    }

    const changePercent = ((changedPixels / (width * height)) * 100).toFixed(1);
    console.log(`[MaskUtils] Changed pixels: ${changedPixels} (${changePercent}%)`);

    // Convert to JPEG
    const resultBuffer = await sharp(outputData, {
        raw: { width, height, channels: 4 }
    })
        .jpeg({ quality: 95 })
        .toBuffer();

    console.log("[MaskUtils] Difference composite complete");
    return `data:image/jpeg;base64,${resultBuffer.toString("base64")}`
}

/**
 * Composite two images using a mask.
 * White areas in mask = take from modifiedImage
 * Black areas in mask = take from originalImage
 *
 * @param originalImage - Base64 or URL of the original image
 * @param modifiedImage - Base64 or URL of the modified image (e.g., Qwen output)
 * @param mask - Base64 or URL of the mask (white = modified, black = original)
 * @returns Base64 of the composited image
 */
export async function compositeWithMask(
    originalImage: string,
    modifiedImage: string,
    mask: string
): Promise<string> {
    console.log("[MaskUtils] Compositing images with mask...");

    // Helper to load image from base64, URL, or other formats
    const loadImage = async (input: any): Promise<Buffer> => {
        // Handle string inputs
        if (typeof input === 'string') {
            if (input.startsWith("data:")) {
                const base64Data = input.split(",")[1];
                return Buffer.from(base64Data, "base64");
            } else {
                // URL string
                const response = await fetch(input);
                return Buffer.from(await response.arrayBuffer());
            }
        }

        // Handle FileOutput with .url() method
        // Note: .url() returns a URL object, not a string - must convert
        if (input && typeof input.url === 'function') {
            const url = input.url().toString();
            const response = await fetch(url);
            return Buffer.from(await response.arrayBuffer());
        }

        // Handle ReadableStream
        if (input && typeof input.getReader === 'function') {
            const reader = input.getReader();
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
            return Buffer.from(combined);
        }

        throw new Error(`Unsupported image input type: ${typeof input}`);
    };

    // Load all three images
    const [originalBuffer, modifiedBuffer, maskBuffer] = await Promise.all([
        loadImage(originalImage),
        loadImage(modifiedImage),
        loadImage(mask),
    ]);

    // Get original image dimensions
    const originalMeta = await sharp(originalBuffer).metadata();
    const width = originalMeta.width!;
    const height = originalMeta.height!;

    console.log(`[MaskUtils] Composite dimensions: ${width}x${height}`);

    // Resize modified and mask to match original dimensions
    const [originalRaw, modifiedRaw, maskRaw] = await Promise.all([
        sharp(originalBuffer).ensureAlpha().raw().toBuffer(),
        sharp(modifiedBuffer).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer(),
        sharp(maskBuffer).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer(),
    ]);

    // Create output buffer
    const outputData = Buffer.alloc(width * height * 4);

    // Composite pixel by pixel
    for (let i = 0; i < width * height; i++) {
        const maskValue = maskRaw[i * 4]; // R channel of mask (0-255)
        const alpha = maskValue / 255; // 0 = original, 1 = modified

        // Blend based on mask value
        outputData[i * 4] = Math.round(originalRaw[i * 4] * (1 - alpha) + modifiedRaw[i * 4] * alpha);     // R
        outputData[i * 4 + 1] = Math.round(originalRaw[i * 4 + 1] * (1 - alpha) + modifiedRaw[i * 4 + 1] * alpha); // G
        outputData[i * 4 + 2] = Math.round(originalRaw[i * 4 + 2] * (1 - alpha) + modifiedRaw[i * 4 + 2] * alpha); // B
        outputData[i * 4 + 3] = 255; // A
    }

    // Convert to JPEG
    const resultBuffer = await sharp(outputData, {
        raw: { width, height, channels: 4 }
    })
        .jpeg({ quality: 95 })
        .toBuffer();

    const base64Output = `data:image/jpeg;base64,${resultBuffer.toString("base64")}`;

    console.log("[MaskUtils] Composite complete");

    return base64Output;
}

interface Region {
    id: number;
    pixels: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

/**
 * Filter a mask to keep only the N largest white regions.
 * This helps isolate the main subject's wheels from background vehicles.
 *
 * @param maskInput - Base64 or URL of the mask image
 * @param keepCount - Number of largest regions to keep (default: 2 for side view)
 * @returns Base64 of filtered mask
 */
export async function filterMaskToLargestRegions(
    maskInput: string,
    keepCount: number = 2
): Promise<string> {
    console.log(`[MaskUtils] Filtering mask to keep ${keepCount} largest regions...`);

    // Load the mask image
    let imageBuffer: Buffer;

    if (maskInput.startsWith("data:")) {
        // Base64 input
        const base64Data = maskInput.split(",")[1];
        imageBuffer = Buffer.from(base64Data, "base64");
    } else {
        // URL input - fetch it
        const response = await fetch(maskInput);
        imageBuffer = Buffer.from(await response.arrayBuffer());
    }

    // Get raw pixel data
    const { data, info } = await sharp(imageBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const width = info.width;
    const height = info.height;
    const channels = info.channels;

    console.log(`[MaskUtils] Mask dimensions: ${width}x${height}, channels: ${channels}`);

    // Create binary mask (1 = white/foreground, 0 = black/background)
    const binaryMask = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
        // Check if pixel is white (R > 128)
        const r = data[i * channels];
        binaryMask[i] = r > 128 ? 1 : 0;
    }

    // Connected component labeling using flood fill
    const labels = new Int32Array(width * height);
    let nextLabel = 1;
    const regions: Region[] = [];

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (binaryMask[idx] === 1 && labels[idx] === 0) {
                // Found unlabeled white pixel - flood fill
                const region = floodFill(binaryMask, labels, width, height, x, y, nextLabel);
                regions.push(region);
                nextLabel++;
            }
        }
    }

    console.log(`[MaskUtils] Found ${regions.length} regions`);

    // Sort by pixel count (largest first)
    regions.sort((a, b) => b.pixels - a.pixels);

    // Log region sizes
    regions.slice(0, 5).forEach((r, i) => {
        console.log(`[MaskUtils] Region ${i + 1}: ${r.pixels} pixels, bounds: (${r.minX},${r.minY}) to (${r.maxX},${r.maxY})`);
    });

    // Keep only the N largest regions
    const keepLabels = new Set(regions.slice(0, keepCount).map(r => r.id));

    // Create filtered mask
    const outputData = Buffer.alloc(width * height * 4); // RGBA

    for (let i = 0; i < width * height; i++) {
        const label = labels[i];
        const isKept = keepLabels.has(label);
        const value = isKept ? 255 : 0;

        outputData[i * 4] = value;     // R
        outputData[i * 4 + 1] = value; // G
        outputData[i * 4 + 2] = value; // B
        outputData[i * 4 + 3] = 255;   // A
    }

    // Convert back to PNG
    const filteredBuffer = await sharp(outputData, {
        raw: { width, height, channels: 4 }
    })
        .png()
        .toBuffer();

    const base64Output = `data:image/png;base64,${filteredBuffer.toString("base64")}`;

    console.log(`[MaskUtils] Filtered mask created, keeping ${keepCount} regions`);

    return base64Output;
}

/**
 * Extract a binary mask from FastSAM's colored output.
 * FastSAM overlays colored masks on the original image.
 * We detect the colored regions by comparing saturation/brightness.
 *
 * @param fastSamOutput - The FastSAM output image (base64 or URL)
 * @returns Base64 binary mask (white = detected regions)
 */
export async function extractMaskFromFastSam(
    fastSamOutput: string
): Promise<string> {
    console.log("[MaskUtils] Extracting mask from FastSAM output...");

    // Load FastSAM output
    let imageBuffer: Buffer;
    if (fastSamOutput.startsWith("data:")) {
        const base64Data = fastSamOutput.split(",")[1];
        imageBuffer = Buffer.from(base64Data, "base64");
    } else {
        const response = await fetch(fastSamOutput);
        imageBuffer = Buffer.from(await response.arrayBuffer());
    }

    // Get raw pixel data
    const { data, info } = await sharp(imageBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const width = info.width;
    const height = info.height;
    const channels = info.channels;

    console.log(`[MaskUtils] FastSAM image: ${width}x${height}`);

    // Create output mask
    const outputData = Buffer.alloc(width * height * 4);

    // FastSAM uses bright, saturated colors for masks
    // Detect pixels that are highly saturated (colored masks)
    for (let i = 0; i < width * height; i++) {
        const r = data[i * channels];
        const g = data[i * channels + 1];
        const b = data[i * channels + 2];

        // Calculate saturation (how colorful vs gray)
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const saturation = max === 0 ? 0 : (max - min) / max;
        const brightness = max;

        // FastSAM mask colors are typically bright and saturated
        // Original image pixels tend to have lower saturation
        const isMask = saturation > 0.3 && brightness > 100;

        const value = isMask ? 255 : 0;
        outputData[i * 4] = value;     // R
        outputData[i * 4 + 1] = value; // G
        outputData[i * 4 + 2] = value; // B
        outputData[i * 4 + 3] = 255;   // A
    }

    // Convert to PNG
    const maskBuffer = await sharp(outputData, {
        raw: { width, height, channels: 4 }
    })
        .png()
        .toBuffer();

    const base64Output = `data:image/png;base64,${maskBuffer.toString("base64")}`;
    console.log("[MaskUtils] FastSAM mask extracted");

    return base64Output;
}

/**
 * Flood fill algorithm to label connected components
 */
function floodFill(
    binaryMask: Uint8Array,
    labels: Int32Array,
    width: number,
    height: number,
    startX: number,
    startY: number,
    label: number
): Region {
    const stack: [number, number][] = [[startX, startY]];
    let pixels = 0;
    let minX = startX, maxX = startX, minY = startY, maxY = startY;

    while (stack.length > 0) {
        const [x, y] = stack.pop()!;
        const idx = y * width + x;

        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        if (binaryMask[idx] !== 1 || labels[idx] !== 0) continue;

        labels[idx] = label;
        pixels++;

        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);

        // 4-connectivity
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    return { id: label, pixels, minX, maxX, minY, maxY };
}
