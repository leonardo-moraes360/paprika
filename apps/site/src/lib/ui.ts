import type { Lang } from "../docs.config";
import data from "./ui.json";

type Strings = Omit<(typeof data)["en"], "other"> & { other: Lang };

export const UI = data as Record<Lang, Strings>;
