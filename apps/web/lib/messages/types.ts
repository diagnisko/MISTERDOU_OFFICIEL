/** Traduction d'une zone : chaque clé du français, facultative (repli sur le français). */
export type Translations<T> = Partial<Record<keyof T, string>>;
