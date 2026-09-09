/** Shared with the receiver; no arbitrary fetch targets or transient video URLs. */
export function isImageSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      value.length <= 2048 &&
      url.protocol === 'https:' &&
      url.hostname === 'pbs.twimg.com' &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash &&
      /^\/media\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9]+)?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}
