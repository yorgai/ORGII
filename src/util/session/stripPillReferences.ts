/**
 * Strip serialized pill/mention references from display text.
 * Removes patterns like [file:...], [terminal:...::base64], [repo:...], etc.
 * Also removes fenced code blocks (```...```) that carry embedded terminal content.
 * Used to clean user_input for display as session titles and tab labels.
 */
export function stripPillReferences(text: string): string {
  return text
    .replace(
      /\s*\[(?:file|terminal|repo|branch|signal|folder|session|browser|dom-element):[^\]]*\]/g,
      ""
    )
    .replace(/\n*```[\s\S]*?```/g, "")
    .trim();
}
