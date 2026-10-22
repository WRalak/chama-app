/**
 * Removes personal identifiers the assistant never needs from text sent to
 * the AI provider: phone numbers, e-mail addresses and long digit runs such as
 * bank account or ID numbers. Transaction codes (letters and digits) are kept
 * because members ask about them. Anything typed that looks like a PIN or
 * password is dropped.
 */
export function redactForProvider(text: string): string {
  return text
    .replace(/\b(pin|password|passcode|otp)\b\s*(is|:|=)?\s*\S+/gi, '$1 [removed]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/(?:\+?254|\b0)[17]\d{8}\b/g, '[phone]')
    .replace(/\b\d{9,}\b/g, '[number]');
}
