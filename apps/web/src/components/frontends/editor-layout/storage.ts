import type { ResizableStorage } from "@/components/ui/resizable";
import { readPersisted, writePersisted } from "@/lib/persist";

export const persistedLayoutStorage: ResizableStorage = {
  getItem: (key) => readPersisted(key),
  setItem: (key, value) => writePersisted(key, value),
};
