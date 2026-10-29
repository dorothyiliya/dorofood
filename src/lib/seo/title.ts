import { BRAND } from "@/lib/brand";

/** "{title} | Dorocity Foods" with the page's own title filled in. Pure: used by the editor's preview too. */
export function applyTitlePattern(title: string, pattern: string) {
  return pattern.includes("{title}") ? pattern.replace("{title}", title) : `${title} | ${BRAND.name}`;
}
