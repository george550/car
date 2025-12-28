/**
 * LEARNINGS: AI Image Editing for Vehicle Customization
 * ======================================================
 *
 * This file documents our findings from attempting to use various AI models
 * for surgical vehicle part modifications (wheels, paint colors).
 *
 * Date: December 2024
 * Project: TunerAI
 */

// ============================================================================
// QWEN IMAGE EDIT 2511 - WHAT DIDN'T WORK
// ============================================================================

/**
 * MODEL: qwen/qwen-image-edit-2511
 * TYPE: Generative image-to-image model
 *
 * FUNDAMENTAL PROBLEM:
 * Qwen is a GENERATIVE model, not an INPAINTING model. It regenerates the
 * ENTIRE image based on the prompt, rather than surgically modifying specific
 * regions. This architectural difference makes it unsuitable for tasks requiring
 * pixel-perfect preservation of unchanged areas.
 */

export const QWEN_ISSUES = {
  /**
   * ISSUE 1: Image Shifting (~20 pixels)
   * ------------------------------------
   * The output image is consistently shifted by approximately 20 pixels
   * compared to the input. This happens because Qwen regenerates the entire
   * image rather than modifying in-place.
   *
   * ATTEMPTED FIXES:
   * - Explicit prompts: "DO NOT shift, pan, or reframe the image" ❌
   * - "Output must be EXACTLY the same dimensions" ❌
   * - "Every pixel outside modification area must remain IDENTICAL" ❌
   *
   * RESULT: Prompting cannot fix this - it's architectural
   */
  imageShifting: {
    description: "Output shifted ~20px from input",
    cause: "Generative model regenerates entire image",
    promptingHelped: false,
    postProcessingHelped: false,
  },

  /**
   * ISSUE 2: Background Modifications
   * ---------------------------------
   * Even with explicit instructions to preserve background, Qwen modifies:
   * - Utility poles and street signs
   * - Other vehicles in the background
   * - Asphalt texture and markings
   * - Trees, sky, buildings
   * - Ground/pavement coloring
   *
   * ATTEMPTED FIXES:
   * - "DO NOT modify ANY background elements" ❌
   * - "Background must be PIXEL-PERFECT identical to original" ❌
   * - Listing specific items NOT to touch ❌
   * - "The ONLY vehicle you may modify is the MAIN FOREGROUND CAR" ❌
   *
   * RESULT: Prompting reduced but did not eliminate background changes
   */
  backgroundModifications: {
    description: "Background elements modified despite instructions",
    affectedAreas: ["poles", "signs", "other vehicles", "asphalt", "trees", "sky"],
    promptingHelped: "slightly - reduced but not eliminated",
    postProcessingHelped: "partially - difference extraction helped but shift ruined alignment",
  },

  /**
   * ISSUE 3: Unintended Part Modifications
   * --------------------------------------
   * When changing one part (e.g., paint), Qwen would also modify other parts:
   * - Paint change would alter wheel appearance
   * - Wheel change would affect body panels
   * - Both would modify windows, trim, lights
   *
   * ATTEMPTED FIXES:
   * - Explicit "DO NOT touch wheels" in paint prompts ❌
   * - Detailed lists of what NOT to modify ❌
   * - Separating operations into different API calls ❌
   *
   * RESULT: Model cannot reliably isolate modifications to specific regions
   */
  unintendedModifications: {
    description: "Model modifies parts it shouldn't",
    examples: [
      "Paint change alters wheel appearance",
      "Wheel change affects body panels",
      "Both operations modify chrome trim, windows, lights"
    ],
    promptingHelped: false,
  },

  /**
   * ISSUE 4: Floating/Misplaced Elements
   * ------------------------------------
   * Qwen sometimes generates wheels or other elements in incorrect locations:
   * - Floating wheels appearing in mid-air
   * - Wheels pasted on top of body panels
   * - Reference wheel image appearing as overlay
   *
   * ATTEMPTED FIXES:
   * - "DO NOT add floating wheels anywhere in the image" ❌
   * - "DO NOT paste or overlay the reference wheel image" ❌
   * - "Only place wheels where wheels ALREADY exist on the car" ❌
   *
   * RESULT: Inconsistent - sometimes works, sometimes fails
   */
  floatingElements: {
    description: "Elements generated in wrong locations",
    promptingHelped: "inconsistent",
  },

  /**
   * ISSUE 5: Style/Quality Inconsistency
   * ------------------------------------
   * The regenerated areas often have different:
   * - Lighting conditions
   * - Shadow directions
   * - Reflection patterns
   * - Overall image quality/sharpness
   *
   * This makes the modified areas visually obvious and unrealistic.
   */
  styleInconsistency: {
    description: "Modified areas look different from original",
    aspects: ["lighting", "shadows", "reflections", "sharpness"],
  },
};

// ============================================================================
// POST-PROCESSING ATTEMPTS
// ============================================================================

export const POST_PROCESSING_ATTEMPTS = {
  /**
   * ATTEMPT 1: Difference Layer Extraction
   * --------------------------------------
   * Extract only pixels that changed between original and Qwen output,
   * creating a transparent layer with just the modifications.
   *
   * IMPLEMENTATION: Compare pixel-by-pixel, keep pixels with difference > threshold
   *
   * PROBLEMS:
   * - Image shift means EVERYTHING is "different" when comparing aligned
   * - Background changes leak into the layer
   * - Edges are inconsistent due to anti-aliasing differences
   *
   * RESULT: Partially useful but shift ruins pixel alignment
   */
  differenceExtraction: {
    description: "Extract only changed pixels as transparent layer",
    helped: "partially",
    problems: ["shift breaks alignment", "background leaks through", "edge artifacts"],
  },

  /**
   * ATTEMPT 2: Mask-Based Filtering
   * -------------------------------
   * Use segmentation (FastSAM/GroundedSAM) to create masks, then only keep
   * difference pixels that fall inside/outside the mask region.
   *
   * IMPLEMENTATION:
   * - For wheels: Keep pixels INSIDE wheel mask
   * - For paint: Keep pixels OUTSIDE wheel mask (exclude wheels)
   *
   * PROBLEMS:
   * - FastSAM was taking 60-240 seconds (wrong API params, 1024px image)
   * - Even with correct mask, the underlying Qwen shift still causes issues
   * - Mask boundaries don't perfectly align with actual part boundaries
   *
   * RESULT: Good concept, but can't fix the source problem (Qwen shift)
   */
  maskFiltering: {
    description: "Use segmentation masks to filter difference layer",
    helped: "conceptually sound but can't fix source problem",
    problems: ["doesn't fix Qwen shift", "mask boundary imprecision"],
  },

  /**
   * ATTEMPT 3: Erosion/Feathering
   * ----------------------------
   * Apply morphological erosion to masks to shrink boundaries,
   * plus feathering (blur) for smoother blending.
   *
   * PROBLEMS:
   * - Erosion removed too many valid pixels
   * - Feathering caused ghosting artifacts
   * - Made the layers look worse, not better
   *
   * RESULT: Reverted - made things worse
   */
  erosionFeathering: {
    description: "Shrink masks and blur edges for blending",
    helped: false,
    problems: ["removed valid pixels", "ghosting artifacts", "worse results"],
    status: "REVERTED",
  },
};

// ============================================================================
// SEGMENTATION MODEL FINDINGS
// ============================================================================

export const SEGMENTATION_FINDINGS = {
  /**
   * FastSAM (casia-iva-lab/fastsam)
   * -------------------------------
   * Text-prompted segmentation model.
   *
   * CORRECT API PARAMETERS:
   * - input_image: base64 or URL
   * - text_prompt: "wheel" (simple is better than verbose)
   * - iou: 0.7 (default)
   * - conf: 0.25 (default)
   * - image_size: 640 (default - NOT 1024, causes 10x slowdown)
   * - retina: true
   * - withContours: false
   *
   * WRONG PARAMS WE USED:
   * - image_size: 1024 (way too slow)
   * - conf: 0.3-0.9 (too high, missed detections)
   * - iou: 0.9 (too strict)
   * - text_prompt: "car wheel, tire, rim, alloy wheel" (verbose didn't help)
   *
   * PERFORMANCE:
   * - With wrong params: 60-240 seconds
   * - With correct params: ~5-10 seconds expected
   */
  fastSam: {
    model: "casia-iva-lab/fastsam",
    correctParams: {
      image_size: 640,
      iou: 0.7,
      conf: 0.25,
      text_prompt: "wheel",
    },
    wrongParams: {
      image_size: 1024,
      iou: 0.9,
      conf: 0.3,
      text_prompt: "car wheel, tire, rim, alloy wheel",
    },
  },

  /**
   * Grounded SAM (schananas/grounded_sam)
   * -------------------------------------
   * Text-prompted segmentation with negative prompts.
   * Useful for more complex segmentation needs.
   *
   * Returns: { annotated, negative, mask, inverted }
   */
  groundedSam: {
    model: "schananas/grounded_sam",
    supportsNegativePrompts: true,
    outputFormat: ["annotated", "negative", "mask", "inverted"],
  },
};

// ============================================================================
// THE SOLUTION: INPAINTING vs GENERATION
// ============================================================================

export const SOLUTION = {
  /**
   * KEY INSIGHT:
   * The fundamental problem is using a GENERATIVE model for a task that
   * requires SURGICAL modification. The solution is to use an INPAINTING
   * model instead.
   *
   * GENERATIVE (Qwen):
   * - Regenerates the ENTIRE image
   * - Background changes are inevitable
   * - Image shifts are architectural
   * - Prompting cannot fix this
   *
   * INPAINTING (Flux Fill Pro):
   * - Only modifies pixels INSIDE the mask
   * - Pixels OUTSIDE mask stay PIXEL-PERFECT unchanged
   * - No image shifting
   * - Background is guaranteed preserved
   */

  architecture: {
    wrong: {
      name: "Generative (Qwen)",
      process: "Regenerate entire image based on prompt",
      backgroundPreservation: "impossible",
      pixelShift: "inherent",
    },
    correct: {
      name: "Inpainting (Flux Fill Pro)",
      process: "Only modify pixels inside mask",
      backgroundPreservation: "guaranteed",
      pixelShift: "none",
    },
  },

  /**
   * CORRECT PIPELINE:
   * 1. User uploads car image
   * 2. FastSAM detects wheels → creates mask (white = wheels)
   * 3. User selects wheel style
   * 4. Flux Fill Pro inpaints ONLY masked wheel regions
   * 5. Background stays 100% unchanged
   * 6. Extract difference layer for compositing (optional - already clean)
   */
  correctPipeline: [
    "Upload image",
    "FastSAM creates wheel mask",
    "User selects modification",
    "Flux Fill Pro inpaints masked region",
    "Background unchanged - no post-processing needed",
  ],

  /**
   * Flux Fill Pro (black-forest-labs/flux-fill-pro)
   * -----------------------------------------------
   * Professional inpainting model.
   *
   * PARAMETERS:
   * - image: Original image (base64 or URL)
   * - mask: Binary mask (white = modify, black = preserve)
   * - prompt: What to generate in masked area
   * - steps: 15-50 (default 50, higher = more detail)
   * - guidance: 1.5-100 (default 30, higher = more prompt adherence)
   */
  fluxFillPro: {
    model: "black-forest-labs/flux-fill-pro",
    type: "inpainting",
    maskConvention: "white = modify, black = preserve",
    recommendedParams: {
      steps: 50,
      guidance: 30,
    },
  },
};

// ============================================================================
// PROMPTING LEARNINGS
// ============================================================================

export const PROMPTING_LEARNINGS = {
  /**
   * What DOESN'T work with generative models:
   * - Negative instructions ("DO NOT modify X")
   * - Preservation instructions ("Keep X unchanged")
   * - Explicit constraints ("Pixel-perfect", "identical")
   * - Lists of things to avoid
   *
   * The model simply cannot follow these because it regenerates everything.
   */
  ineffectivePrompts: [
    "DO NOT modify, move, blur, or touch ANY background elements",
    "Background must be PIXEL-PERFECT identical to original",
    "DO NOT extend, crop, pan, shift, or reframe the image",
    "Every single pixel outside the modification area MUST remain IDENTICAL",
    "DO NOT add any new objects, text, watermarks, or artifacts",
  ],

  /**
   * What SLIGHTLY helps (but doesn't solve the problem):
   * - Being specific about what TO modify (positive framing)
   * - Describing the desired output in detail
   * - Using reference images for style consistency
   */
  slightlyEffectivePrompts: [
    "Replace ONLY the wheel rims with [description]",
    "Change the body paint color to [color]",
    "Copy the spoke pattern from the reference image",
  ],

  /**
   * CONCLUSION:
   * Prompting is not the solution for surgical modifications.
   * Use the right tool (inpainting) for the job.
   */
  conclusion: "Prompting cannot make a generative model behave like an inpainting model. Use inpainting.",
};

// ============================================================================
// FINAL SOLUTION: SAM3 + FLUX FILL PRO
// ============================================================================

export const FINAL_SOLUTION = {
  /**
   * After extensive testing, the optimal pipeline is:
   *
   * 1. SAM3 (via Replicate) - Text-prompted segmentation
   *    - Model: lucataco/sam3-video (works with images too)
   *    - Speed: ~2.3 seconds (vs 60-240s FastSAM)
   *    - Prompt: "car wheel rim tire"
   *    - Returns: Binary mask (white = wheels)
   *
   * 2. FLUX Fill Pro (via Replicate) - Inpainting
   *    - Model: black-forest-labs/flux-fill-pro
   *    - Speed: ~10-15 seconds
   *    - Only modifies pixels INSIDE mask
   *    - Background: PIXEL-PERFECT unchanged
   */

  pipeline: [
    "Upload image",
    "SAM3 text-prompt → wheel mask (~2s)",
    "FLUX Fill Pro inpaints wheel area (~10-15s)",
    "Background unchanged, wheels replaced",
  ],

  models: {
    segmentation: {
      name: "SAM3",
      provider: "Replicate",
      model: "lucataco/sam3-video",
      speed: "~2.3 seconds",
      features: ["text prompts", "negative prompts", "mask output"],
    },
    inpainting: {
      name: "FLUX Fill Pro",
      provider: "Replicate",
      model: "black-forest-labs/flux-fill-pro",
      speed: "~10-15 seconds",
      features: ["mask-based", "text prompts", "pixel-perfect preservation"],
    },
  },

  /**
   * Cost per edit (as of Dec 2024):
   * - SAM3: ~$0.02
   * - FLUX Fill Pro: ~$0.05
   * - Total: ~$0.07 per wheel swap
   */
  costPerEdit: "$0.07",
};

// ============================================================================
// SUMMARY
// ============================================================================

/**
 * TL;DR:
 *
 * 1. Qwen Image Edit regenerates the entire image → causes shifts and background changes
 * 2. No amount of prompting can fix this - it's architectural
 * 3. Post-processing (difference extraction, masking) can't fix the underlying shift
 * 4. FastSAM was too slow (60-240s) due to wrong params
 * 5. SAM3 via Replicate works great (~2.3s) with text prompts
 * 6. FLUX Fill Pro INPAINTING only modifies masked pixels - background guaranteed unchanged
 *
 * FINAL STACK: SAM3 (segmentation) + FLUX Fill Pro (inpainting)
 *
 * Hours spent learning this: Many.
 * Value of documenting it: Priceless.
 */
