/**
 * Modular prompt templates for vehicle part modifications.
 * Each part has specific instructions on what to modify and what to preserve.
 */

// Base constraints that apply to ALL modifications
const BASE_CONSTRAINTS = `
ABSOLUTE RESTRICTIONS - VIOLATION OF ANY WILL RUIN THE IMAGE:
1. DO NOT modify, move, blur, or touch ANY background elements
2. DO NOT change trees, sky, buildings, ground, pavement, or landscape
3. DO NOT modify other vehicles in the background - leave them EXACTLY as they are
4. DO NOT extend, crop, pan, shift, or reframe the image in ANY way
5. DO NOT change the image dimensions or aspect ratio
6. The ONLY vehicle you may modify is the MAIN FOREGROUND CAR
7. Every single pixel outside the modification area MUST remain IDENTICAL to the original
8. DO NOT add any new objects, text, watermarks, or artifacts
9. DO NOT enhance, sharpen, blur, or apply any filters to unchanged areas

OUTPUT REQUIREMENTS:
- Output image must be EXACTLY the same dimensions as input
- Background must be PIXEL-PERFECT identical to original
- Only the specific part mentioned should change - nothing else
`;

// Part-specific prompts
const PART_PROMPTS = {
    wheels: {
        task: (referenceDesc: string) => `
The first image shows a car. The second image shows a wheel/rim design to copy.

TASK: Replace ONLY the wheel rims on the main foreground vehicle with the design from the second image.

WHAT TO MODIFY (AND NOTHING ELSE):
- The metal alloy wheel/rim portion ONLY - the circular metallic part
- Copy the spoke pattern, finish, and style from the reference wheel image
- Preserve the exact wheel SIZE and POSITION - wheels stay mounted on the car
- Keep the same perspective and angle as original wheels
- Reference style: ${referenceDesc}

CRITICAL - WHAT YOU MUST NEVER TOUCH:
- The BLACK RUBBER TIRES - keep them EXACTLY as they are, do not redraw
- The car body, paint color, windows, lights - absolutely NO changes
- Wheel wells, fenders, or any body panels around the wheels
- Brake calipers, rotors, or any visible suspension components
- DO NOT add floating wheels anywhere in the image
- DO NOT paste or overlay the reference wheel image
- DO NOT create wheels anywhere except where wheels ALREADY exist on the car
- DO NOT modify the wheel size - new wheels must fit the same tire
`,
    },

    paint: {
        task: (colorDesc: string) => `
TASK: Change ONLY the exterior body paint color of the main foreground vehicle to: ${colorDesc}

WHAT TO MODIFY (AND NOTHING ELSE):
- Hood, roof, doors, fenders, trunk - painted metal body panels ONLY
- Front and rear bumper covers (painted plastic portions)
- Side skirts and rocker panels if painted
- Apply realistic reflections and highlights appropriate for the new color
- Maintain the same lighting conditions and shadows

CRITICAL - WHAT YOU MUST NEVER TOUCH:
- WHEELS AND TIRES - absolutely NO changes to wheels or tires whatsoever
- DO NOT repaint, modify, or touch the wheel rims in any way
- Windows, windshield, glass, mirrors - keep transparent/reflective as-is
- Headlights, taillights, fog lights, turn signals - no changes to lights
- Chrome trim, window trim, door handles - keep original metallic finish
- Black trim, plastic trim, grilles - keep original black/dark finish
- Badges, emblems, logos - keep in original position and color
- Interior visible through windows - no changes
- Exhaust tips, antenna, roof rails - keep original finish
`,
    },

    // Future parts - ready to implement
    bumper: {
        task: (bumperDesc: string) => `
TASK: Modify the bumper of the main foreground vehicle.

MODIFICATION: ${bumperDesc}

WHAT TO MODIFY:
- Front or rear bumper as specified
- Bumper cover, air intakes, splitter if applicable

WHAT TO NEVER TOUCH:
- Wheels, tires, body paint color
- Headlights, taillights, grilles (unless part of bumper)
- Any other body panels not part of the bumper
`,
    },

    lights: {
        task: (lightDesc: string) => `
TASK: Modify the lights of the main foreground vehicle.

MODIFICATION: ${lightDesc}

WHAT TO MODIFY:
- Headlights or taillights as specified
- Light housing, lens color, LED pattern if applicable

WHAT TO NEVER TOUCH:
- Wheels, tires, body paint color
- Bumpers, grilles, body panels
- Any lights not specified for modification
`,
    },

    // Add more parts as needed: spoiler, grille, mirrors, etc.
};

export type VehiclePart = keyof typeof PART_PROMPTS;

/**
 * Build a complete prompt for a vehicle part modification.
 * Combines part-specific instructions with base constraints.
 */
export function buildPrompt(part: VehiclePart, details: string): string {
    const partPrompt = PART_PROMPTS[part];
    if (!partPrompt) {
        throw new Error(`Unknown vehicle part: ${part}`);
    }
    return `${partPrompt.task(details)}
${BASE_CONSTRAINTS}`;
}

/**
 * Get just the base constraints (useful for debugging or custom prompts)
 */
export function getBaseConstraints(): string {
    return BASE_CONSTRAINTS;
}

/**
 * List all available vehicle parts
 */
export function getAvailableParts(): VehiclePart[] {
    return Object.keys(PART_PROMPTS) as VehiclePart[];
}
