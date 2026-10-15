/** Absolute URL of a file in public/, independent of the current route depth (clean URLs make relative paths unsafe). */
export const assetUrl = (path: string) => new URL(import.meta.env.BASE_URL + path.replace(/^\//, ''), location.origin).href;
