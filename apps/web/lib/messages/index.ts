// Dictionnaires par zone du site. Le français est la langue de base : une clé
// absente en anglais ou en arabe s'affiche en français.
import * as common from "./common";
import * as home from "./home";
import * as catalogue from "./catalogue";
import * as account from "./account";
import * as pages from "./pages";
import * as shared from "./shared";
import * as flow from "./flow";

const areas = [common, home, catalogue, account, pages, shared, flow] as const;

type Merge<T extends readonly { fr: object }[]> = T extends readonly [infer H extends { fr: object }, ...infer R extends { fr: object }[]]
  ? H["fr"] & Merge<R>
  : unknown;

export type FrenchMessages = Merge<typeof areas>;
export type MessageKey = keyof FrenchMessages & string;

const merge = (pick: (a: (typeof areas)[number]) => object) => Object.assign({}, ...areas.map(pick)) as Record<string, string>;

export const DICTIONARIES = {
  fr: merge((a) => a.fr),
  en: merge((a) => a.en),
  ar: merge((a) => a.ar),
};
