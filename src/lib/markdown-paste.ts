// Detecta si un texto plano pegado «parece» Markdown (para convertirlo en el editor con formato).

const MARKDOWN_HINT =
  /(\*\*[^*\n]+\*\*|~~[^~\n]+~~|\+\+[^+\n]+\+\+|(?<![\w*])\*[^*\s][^*\n]*\*(?![\w*])|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|^\s{0,3}#{1,6}\s+\S|^\s*[-*+]\s+\S|^\s*\d+[.)]\s+\S|^\s*>\s+\S)/m;

export function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_HINT.test(text);
}
