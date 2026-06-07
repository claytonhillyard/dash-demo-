export type AttachmentKind = "image" | "cert";

export type MimeDetection =
  | { kind: AttachmentKind; mime: string }
  | null;

/**
 * Detect the file's kind + canonical MIME type from its first 12 bytes.
 *
 * The HTTP request's Content-Type header is trivially spoofable, so we never
 * trust it. Instead we sniff the magic-byte signature off the actual bytes
 * the client sent. A renamed PDF→.jpg upload (Content-Type: image/jpeg)
 * will fail this check at the buffer level.
 *
 * Returns null if the buffer is too short or matches none of the allowed
 * signatures. The caller (uploadDealAttachment) maps null to ForbiddenError.
 */
export function detectKindFromBytes(bytes: Uint8Array): MimeDetection {
  if (bytes.length < 12) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { kind: "image", mime: "image/jpeg" };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { kind: "image", mime: "image/png" };
  }

  // WebP: "RIFF????WEBP" — bytes 0-3 == 'R','I','F','F'; bytes 8-11 == 'W','E','B','P'
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { kind: "image", mime: "image/webp" };
  }

  // PDF: 25 50 44 46 ('%PDF')
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return { kind: "cert", mime: "application/pdf" };
  }

  return null;
}
