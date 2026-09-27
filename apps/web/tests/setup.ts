import '@testing-library/jest-dom/vitest';

/**
 * jsdom does not implement the Pointer Capture API that Radix primitives call
 * when a pointer goes down (for example opening a Select). Providing no-op
 * stubs lets those components be exercised in component tests instead of
 * crashing on `target.hasPointerCapture is not a function`.
 */
Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => undefined;
Element.prototype.releasePointerCapture = () => undefined;
Element.prototype.scrollIntoView = () => undefined;
