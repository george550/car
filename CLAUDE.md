# TunerAI - Claude Context

## Modus Operandi

### Debugging Protocol

**NEVER stack quick fixes. Always find the root cause first.**

When encountering an error:

1. **Understand the data flow** - Trace what types/values are actually being passed
2. **Check type definitions first** - Look at `node_modules/*/index.d.ts` for SDK types
3. **Search documentation** - Consult official docs and source code
4. **Understand WHY it fails, not just WHAT fails**
5. **One correct fix > multiple attempted fixes**

Example: `x.startsWith is not a function`
- Bad: Add type guards, try/catch, convert types blindly
- Good: Check what `x` actually is. If it's a `URL` object (not string), the fix is `.toString()`

### Replicate SDK Notes

- `FileOutput.url()` returns a `URL` object, NOT a string
- Always call `.toString()` when you need the URL as a string
- `FileOutput` extends `ReadableStream` - can also use `.blob()` or stream directly

## Tech Stack

- Next.js 16 (App Router)
- React 19
- Tailwind CSS
- Replicate API (Qwen Image Edit 2511)
- Sharp for image processing

## Key Files

- `lib/replicate.ts` - Replicate API wrapper
- `lib/mask-utils.ts` - Image compositing utilities
- `app/api/process-car/route.ts` - Main image processing endpoint
- `app/editor/page.tsx` - Editor UI

## Image Processing Pipeline

1. User uploads car image
2. Qwen Image Edit modifies (wheels/paint)
3. `differenceComposite()` preserves original background, takes changed pixels from Qwen output
4. Result cached for toggle functionality
