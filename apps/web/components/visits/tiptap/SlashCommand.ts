import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from "@tiptap/suggestion";

// Commande "/" façon Notion (Phase 2 du plan "table de montage") : taper "/"
// dans une note ouvre un menu de blocs (titres, listes, citation, image,
// audio) filtrable au clavier. Popup en DOM direct (positionnée sur le caret
// via `clientRect`), sans dépendance de positionnement — le menu est petit et
// ancré à un point fixe, pas besoin de floating-ui ici.

export interface SlashItem {
  title: string;
  hint: string;
  icon: string;
  run: (editor: Editor, range: Range) => void;
}

export interface SlashCommandOptions {
  /** Ouvre le sélecteur d'images de la visite (popover de la toolbar). */
  onInsertImage?: () => void;
  /** Ouvre l'enregistreur audio (popover de la toolbar). */
  onInsertAudio?: () => void;
}

function buildItems(opts: SlashCommandOptions): SlashItem[] {
  return [
    { title: "Titre", hint: "Grand titre de section", icon: "H2", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
    { title: "Sous-titre", hint: "Titre secondaire", icon: "H3", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
    { title: "Texte", hint: "Paragraphe simple", icon: "¶", run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
    { title: "Liste à puces", hint: "Liste non ordonnée", icon: "•", run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
    { title: "Liste numérotée", hint: "Liste ordonnée", icon: "1.", run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
    { title: "Citation", hint: "Mise en avant typographique", icon: "❝", run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
    ...(opts.onInsertImage
      ? [{ title: "Image", hint: "Image de la visite, texte autour", icon: "🖼", run: (e: Editor, r: Range) => { e.chain().focus().deleteRange(r).run(); opts.onInsertImage?.(); } }]
      : []),
    ...(opts.onInsertAudio
      ? [{ title: "Audio", hint: "Enregistrer un clip au micro", icon: "🎙", run: (e: Editor, r: Range) => { e.chain().focus().deleteRange(r).run(); opts.onInsertAudio?.(); } }]
      : []),
  ];
}

// ── Popup DOM ───────────────────────────────────────────────────────────────

class SlashMenu {
  private el: HTMLDivElement;
  private items: SlashItem[] = [];
  private selected = 0;
  private props: SuggestionProps<SlashItem> | null = null;

  constructor() {
    this.el = document.createElement("div");
    this.el.className =
      "fixed z-[80] w-64 max-h-72 overflow-y-auto rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-2xl py-1";
    this.el.style.display = "none";
    document.body.appendChild(this.el);
  }

  update(props: SuggestionProps<SlashItem>) {
    this.props = props;
    this.items = props.items;
    this.selected = Math.min(this.selected, Math.max(0, this.items.length - 1));
    this.render();
    const rect = props.clientRect?.();
    if (!rect) return;
    this.el.style.display = "block";
    // Sous le caret, rabattu au-dessus si le bas de l'écran est trop proche
    const menuH = Math.min(288, this.items.length * 52 + 8);
    const top = rect.bottom + menuH > window.innerHeight - 8 ? rect.top - menuH - 4 : rect.bottom + 4;
    this.el.style.top = `${top}px`;
    this.el.style.left = `${Math.min(rect.left, window.innerWidth - 270)}px`;
  }

  private render() {
    this.el.innerHTML = "";
    if (this.items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "px-3 py-2 text-[11px] text-[var(--text-tertiary)]";
      empty.textContent = "Aucun bloc ne correspond";
      this.el.appendChild(empty);
      return;
    }
    this.items.forEach((item, i) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className =
        "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors " +
        (i === this.selected ? "bg-[var(--bg-surface)]" : "hover:bg-[var(--bg-surface)]");
      row.innerHTML =
        `<span class="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded bg-[var(--bg-base)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-secondary)]">${item.icon}</span>` +
        `<span class="min-w-0"><span class="block text-[12px] text-[var(--text-primary)]">${item.title}</span>` +
        `<span class="block text-[10px] text-[var(--text-tertiary)] truncate">${item.hint}</span></span>`;
      // mousedown (pas click) : ne pas voler le focus de l'éditeur
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.select(i);
      });
      this.el.appendChild(row);
    });
  }

  select(index: number) {
    const item = this.items[index];
    // Passe par props.command (et non item.run directement) pour laisser le
    // plugin Suggestion clore proprement son cycle (décoration, état).
    if (item && this.props) this.props.command(item);
  }

  onKeyDown(props: SuggestionKeyDownProps): boolean {
    if (props.event.key === "ArrowDown") {
      this.selected = (this.selected + 1) % Math.max(1, this.items.length);
      this.render();
      return true;
    }
    if (props.event.key === "ArrowUp") {
      this.selected = (this.selected - 1 + this.items.length) % Math.max(1, this.items.length);
      this.render();
      return true;
    }
    if (props.event.key === "Enter") {
      this.select(this.selected);
      return true;
    }
    return false;
  }

  hide() {
    this.el.style.display = "none";
    this.selected = 0;
  }

  destroy() {
    this.el.remove();
  }
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return { onInsertImage: undefined, onInsertAudio: undefined };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: "/",
        startOfLine: false,
        items: ({ query }) =>
          buildItems(options).filter((i) =>
            i.title.toLowerCase().includes(query.toLowerCase())
          ),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let menu: SlashMenu | null = null;
          return {
            onStart: (props) => {
              menu = new SlashMenu();
              menu.update(props);
            },
            onUpdate: (props) => menu?.update(props),
            onKeyDown: (props) => {
              if (props.event.key === "Escape") {
                menu?.hide();
                return true;
              }
              return menu?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              menu?.destroy();
              menu = null;
            },
          };
        },
      }),
    ];
  },
});
