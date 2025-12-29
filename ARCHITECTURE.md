# TunerAI - Architecture Overview

## Tech Stack

- **Frontend:** Next.js 15, React 19, Tailwind CSS, Framer Motion
- **AI APIs:** Replicate (GPT-4.1-mini, SAM3, Nano Banana Pro)
- **Image Processing:** Sharp (server-side)

---

## User Flow & API Calls

### 1. Image Upload (`/editor` or `/studio`)

When user uploads/selects an image, **3 parallel API calls** fire:

| API | Model | Purpose |
|-----|-------|---------|
| `POST /api/analyze-vehicle` | GPT-4.1-mini | Identify make, model, year, color, detect problematic angles |
| `POST /api/detect-wheels` | SAM3 | Generate wheel mask (binary PNG) |
| `POST /api/detect-body` | SAM3 | Generate body mask (excludes wheels, windows, background) |

Masks are stored in `sessionStorage` for use in editor.

### 2. Wheel Replacement

When user clicks a wheel option:

| API | Model | Purpose |
|-----|-------|---------|
| `POST /api/replace-wheels` | Nano Banana Pro (Qwen) | Generate car with new wheels using reference image, then composite only wheel pixels onto original using SAM3 mask |

**Flow:** Original image + wheel reference → Qwen generates full image → Sharp extracts only wheel pixels using mask → Returns transparent PNG layer

### 3. Paint/Color Change

When user clicks a color:

| API | Model | Purpose |
|-----|-------|---------|
| `POST /api/paint-body` | Sharp (no AI) | Apply color tint to body mask area only, preserving wheels and background |

**Flow:** Original image + body mask + wheel mask → Sharp applies HSL color shift to body-only region → Returns transparent PNG layer

### 4. Canvas Compositing (Client-side)

`EditorCanvas` component layers:
```
Base: Original image
Layer 1: Paint layer (if selected)
Layer 2: Wheel layer (if selected)
```

User can toggle layers on/off, switch between Original/Tuned view.

### 5. Export

Client-side canvas export at selected resolution (1024, 1920, or 3840 width).

---

## Replicate API Calls Breakdown

### Per Image Upload (happens once when user uploads/selects photo)

| # | Model | Endpoint | What it does |
|---|-------|----------|--------------|
| 1x | `openai/gpt-4.1-mini` | `/api/analyze-vehicle` | Vision model identifies car (make, model, year, color, body type, camera angle). Also detects problematic angles (drone/hillside shots) and blocks them. |
| 1x | `meta/sam-2-1-base` | `/api/detect-wheels` | Segment Anything Model. Prompt: "car wheels, rims, tires". Returns binary mask PNG of wheel regions. |
| 1x | `meta/sam-2-1-base` | `/api/detect-body` | Same model, different prompt: "car body, paint, metal panels". Returns binary mask PNG of paintable body area. |

**Total on upload: 3 Replicate calls**

### Per Wheel Change (each time user clicks a different wheel)

| # | Model | Endpoint | What it does |
|---|-------|----------|--------------|
| 1x | `google/nano-banana-pro` | `/api/replace-wheels` | Image-to-image model (Qwen-based). Takes original car + wheel reference image + prompt. Generates entire car with new wheels. Then Sharp extracts only the wheel pixels using the SAM3 mask from upload. |

**Total per wheel selection: 1 Replicate call** (cached after first generation - clicking same wheel again uses cached layer)

### Per Color Change (each time user clicks a different color)

| # | Model | Endpoint | What it does |
|---|-------|----------|--------------|
| 0x | None | `/api/paint-body` | **No AI call!** Pure Sharp image processing. Applies HSL color transformation to the body mask region. Fast (~500ms). |

**Total per color selection: 0 Replicate calls**

### Summary

| Action | Replicate Calls | Models Used |
|--------|-----------------|-------------|
| Upload image | 3 | GPT-4.1-mini, SAM3 (x2) |
| Change wheels | 1 per unique wheel | Nano Banana Pro |
| Change color | 0 | None (Sharp only) |
| Toggle Original/Tuned | 0 | Client-side |
| Export | 0 | Client-side canvas |

### Caching Strategy

- **Masks:** Cached in `sessionStorage` after upload - never regenerated
- **Wheel layers:** Cached in React state (`wheelLayers` object) - each wheel ID only generates once
- **Paint layers:** Cached in React state (`paintLayers` object) - each color ID only generates once

**Example:** A user who tries all 4 wheels and all 8 colors would make:
- 3 calls on upload
- 4 calls for wheels (one per wheel)
- 0 calls for colors
- **Total: 7 Replicate API calls**

---

## Key Files

```
components/FileUpload.tsx    - Upload UI, triggers analysis + detection
app/editor/page.tsx          - Main editor, manages layers
components/EditorCanvas.tsx  - Canvas compositing
app/api/analyze-vehicle/     - GPT-4.1-mini vehicle ID
app/api/detect-wheels/       - SAM3 wheel segmentation
app/api/detect-body/         - SAM3 body segmentation
app/api/replace-wheels/      - Qwen + mask compositing
app/api/paint-body/          - Color adjustment
lib/replicate.ts             - Replicate API wrapper
```

---

## Environment Variables

```
REPLICATE_API_TOKEN=r8_xxx   # Replicate API key
```
