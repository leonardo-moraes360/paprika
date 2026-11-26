import type { TFunction } from "i18next";
import { en } from "./locales/en";
import { ptBR } from "./locales/pt-BR";

type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };

export type Translation = Widen<typeof en>;

/** The `t` function of the app, for helpers that receive it (a plain `TFunction`; never derive it from `ReturnType<typeof useTranslation>`, which triggers TS2589). */
export type AppT = TFunction<"translation">;

export const defaultLanguage = "en";
export const languages = ["en", "pt-BR"] as const;
export type Language = (typeof languages)[number];

export const resources = {
  en: { translation: en },
  "pt-BR": { translation: ptBR },
} as const;
