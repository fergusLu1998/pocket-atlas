import type { ImgHTMLAttributes } from 'react';
/* oxlint-disable next/no-img-element -- Standalone SVG data images do not require a Next image server. */
// Molecule/scaffold images already contain their own SVG data; no image server is needed.
export default function Image({
  unoptimized: _unoptimized,
  alt,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) {
  return <img {...props} alt={alt || ''} />;
}
