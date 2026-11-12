"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { Modal } from "./Modal";
import { cn } from "./cn";

interface PromptOptions {
  /** Título corto del diálogo («Renombrar columna»). */
  title: string;
  /** Etiqueta del campo. */
  label: React.ReactNode;
  /** Ayuda bajo el campo (opcional). */
  description?: React.ReactNode;
  /** Valor inicial: al abrir aparece seleccionado, listo para escribir encima. */
  defaultValue?: string;
  /**
   * "number": teclado numérico en el móvil y ↑ ↓ suman o restan 1 sin salirse de `min`-`max`. El valor llega igual,
   * como texto (lo que se escribió), para que quien llama lo interprete como siempre.
   */
  type?: "text" | "number";
  min?: number;
  max?: number;
  maxLength?: number;
  placeholder?: string;
  /** Texto del botón de aceptar. Por defecto, «Aceptar». */
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Comprueba el valor (tal cual se escribió) al aceptar: si devuelve un mensaje, se muestra bajo el campo y el diálogo
   * sigue abierto. `min`/`max` no validan por sí solos: la regla (y qué significa dejarlo vacío) la pone quien llama.
   */
  validate?: (value: string) => string | null | undefined | false;
}

/** Como window.prompt: el texto escrito (sin recortar) o null si se cancela. */
type Prompt = (options: PromptOptions) => Promise<string | null>;

const PromptContext = createContext<Prompt | null>(null);

/**
 * `const prompt = usePrompt(); const name = (await prompt({ title, label, defaultValue }))?.trim();` — sustituye a
 * window.prompt, que algunos navegadores integrados (Instagram, apps de correo) no muestran y devuelven null sin más.
 */
export function usePrompt(): Prompt {
  const prompt = useContext(PromptContext);
  if (!prompt) throw new Error("usePrompt fuera de <PromptProvider>");
  return prompt;
}

interface Pending {
  id: number;
  options: PromptOptions;
  resolve: (value: string | null) => void;
}

let nextId = 1;

/** Diálogos para pedir un dato (sobre el Modal: trampa de foco, Escape y el botón «atrás» del móvil). Se pueden apilar. */
export function PromptProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<Pending[]>([]);
  const stackRef = useRef(stack);
  useEffect(() => {
    stackRef.current = stack;
  });
  // Si el proveedor desaparece con diálogos abiertos, se resuelven como cancelados.
  useEffect(() => () => stackRef.current.forEach((p) => p.resolve(null)), []);

  const prompt = useCallback<Prompt>(
    (options) =>
      new Promise<string | null>((resolve) => {
        setStack((prev) => [...prev, { id: nextId++, options, resolve }]);
      }),
    [],
  );
  const settle = useCallback((id: number, value: string | null) => {
    const item = stackRef.current.find((p) => p.id === id);
    if (!item) return;
    item.resolve(value);
    setStack((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return (
    <PromptContext.Provider value={prompt}>
      {children}
      {stack.map((p) => (
        <PromptDialog key={p.id} {...p.options} onResult={(value) => settle(p.id, value)} />
      ))}
    </PromptContext.Provider>
  );
}

/** El diálogo en sí (lo usa el proveedor; también sirve suelto). `onResult(null)` = cancelado. */
function PromptDialog({
  title, label, description, defaultValue = "", type = "text", min, max, maxLength, placeholder, confirmLabel, cancelLabel, validate, onResult,
}: PromptOptions & { onResult: (value: string | null) => void }) {
  const t = useT();
  const id = useId();
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const number = type === "number";

  // Foco en el campo con el texto seleccionado (después del foco inicial del Modal, que va en el mismo fotograma).
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const message = validate?.(value) || null;
    if (message) {
      setError(message);
      inputRef.current?.focus();
      return;
    }
    onResult(value);
  };

  // Campo numérico: ↑ ↓ cambian el número de uno en uno dentro del rango (como un campo type="number", pero sin
  // perder lo escrito si no es un número).
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!number || (e.key !== "ArrowUp" && e.key !== "ArrowDown") || e.altKey || e.ctrlKey || e.metaKey) return;
    const s = value.trim();
    if (s !== "" && !/^-?\d+$/.test(s)) return;
    e.preventDefault();
    let n = s === "" ? (min ?? 0) : Number(s) + (e.key === "ArrowUp" ? 1 : -1);
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    setValue(String(n));
    setError(null);
  };

  const formId = `${id}-form`;
  const inputId = `${id}-input`;
  const descId = description ? `${id}-desc` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <Modal
      open
      onClose={() => onResult(null)}
      title={title}
      size="sm"
      // En el móvil, arriba: el teclado abierto no lo tapa.
      placement="top"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={() => onResult(null)}>
            {cancelLabel ?? t("Cancelar")}
          </button>
          <button type="submit" form={formId} className="btn-primary">
            {confirmLabel ?? t("Aceptar")}
          </button>
        </>
      }
    >
      {/* Formulario nativo: Intro acepta (también la tecla «Ir» del teclado del móvil, y no mientras se compone texto). */}
      <form id={formId} onSubmit={submit} noValidate>
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
        <input
          ref={inputRef}
          id={inputId}
          // Número como texto con teclado numérico: así llega tal cual se escribió y se valida igual que antes.
          type="text"
          inputMode={number ? "numeric" : undefined}
          enterKeyHint="done"
          autoComplete="off"
          spellCheck={number ? false : undefined}
          // 16 px en el móvil: con menos, iOS amplía la página al enfocar el campo.
          className={cn("input max-sm:text-base", error && "border-red-500 focus:border-red-500 focus:ring-red-500/30 dark:border-red-500")}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={[errorId, descId].filter(Boolean).join(" ") || undefined}
          data-autofocus
        />
        {error && (
          <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {description && (
          <p id={descId} className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            {description}
          </p>
        )}
      </form>
    </Modal>
  );
}
