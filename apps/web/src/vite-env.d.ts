/// <reference types="vite/client" />

/**
 * Typed environment variables exposed to the browser bundle.
 *
 * Declaring the shape here is what removes `any` from `import.meta.env`
 * access. Only `VITE_`-prefixed variables may be added: everything in this
 * interface is inlined into public JavaScript.
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
