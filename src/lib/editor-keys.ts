import { Extension, type Editor } from "@tiptap/core";

/**
 * Supr al final del último elemento de una lista seguida de un párrafo vacío: borra ese párrafo.
 * Sin esto, TipTap mete el párrafo vacío dentro del elemento (aparece una línea nueva en la
 * viñeta) y el nodo final vuelve a crear otro, de modo que cada Supr alterna entre crear y borrar.
 */
export const ListDeleteFix = Extension.create({
  name: "listDeleteFix",
  priority: 1000,
  addKeyboardShortcuts() {
    // Con una selección no vacía, Supr/Retroceso solo borran la selección. Sin esto, ListKeymap (StarterKit)
    // la trataba como un cursor al final de un elemento y unía el siguiente a este («OK» + «Activos de Roma:»),
    // dejando el resto de la selección sin borrar.
    const deleteSelectionOnly = ({ editor }: { editor: Editor }) => {
      if (editor.state.selection.empty) return false;
      return editor.commands.deleteSelection();
    };
    return {
      Backspace: deleteSelectionOnly,
      "Mod-Backspace": deleteSelectionOnly,
      "Mod-Delete": deleteSelectionOnly,
      Delete: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        if (!selection.empty) return deleteSelectionOnly({ editor });
        const $from = selection.$from;
        if ($from.depth < 2 || $from.parentOffset !== $from.parent.content.size) return false;
        let inList = false;
        // El cursor debe estar al final de todo el bloque de nivel superior (la lista).
        for (let d = $from.depth - 1; d >= 1; d--) {
          if ($from.node(d).type.name === "listItem") inList = true;
          if ($from.indexAfter(d) !== $from.node(d).childCount) return false;
        }
        if (!inList) return false;
        const pos = $from.after(1);
        const next = state.doc.nodeAt(pos);
        if (!next || next.type.name !== "paragraph" || next.content.size > 0) return false;
        editor.view.dispatch(state.tr.delete(pos, pos + next.nodeSize));
        return true;
      },
    };
  },
});
