import { EVIDENCE_MAX_BYTES, EVIDENCE_MIME_TYPES } from '@chamahub/shared';

const TYPES: readonly string[] = EVIDENCE_MIME_TYPES;

/** Reads a receipt or screenshot for the evidence API. Throws a readable message if it cannot be sent. */
export async function readEvidence(file: File): Promise<{ fileName: string; mimeType: string; dataBase64: string }> {
  if (!TYPES.includes(file.type)) throw new Error('Use a JPG, PNG, WebP or HEIC image, or a PDF');
  if (file.size > EVIDENCE_MAX_BYTES) throw new Error('The file is larger than 3 MB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { fileName: file.name, mimeType: file.type, dataBase64: btoa(bin) };
}
