import Mention from "@tiptap/extension-mention";
import { mentionToken } from "./mentions";

const MENTION_MD_RE = /^@\[([^\]\n]{1,80})\]\(user:([a-z0-9]{1,40})\)/i;

/**
 * Mención como chip no editable. En Markdown se guarda exactamente como @[Nombre](user:ID)
 * (ver src/lib/mentions.ts). La sugerencia (`@`) se configura desde el editor.
 */
export const MentionChip = Mention.extend({
  markdownTokenName: "mention",
  markdownTokenizer: {
    name: "mention",
    level: "inline",
    start: (src: string) => src.indexOf("@["),
    tokenize: (src: string) => {
      const m = MENTION_MD_RE.exec(src);
      if (!m) return undefined;
      return { type: "mention", raw: m[0], mentionId: m[2], mentionLabel: m[1] };
    },
  },
  parseMarkdown: (token, helpers) =>
    helpers.createNode("mention", { id: (token as { mentionId?: string }).mentionId, label: (token as { mentionLabel?: string }).mentionLabel }),
  renderMarkdown: (node) => mentionToken(String(node.attrs?.label ?? ""), String(node.attrs?.id ?? "")),
});
