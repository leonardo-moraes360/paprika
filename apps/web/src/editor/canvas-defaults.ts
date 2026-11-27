import type { VectorDefaults } from "@/components/frontends/canvas";

/** The paint a vector drawn with the pen gets: the old canvas' ink for the stroke and its warm grey for the fill of a closed one. A document colour is data, so it is the container's, not the frontend's. */
export const vectorDefaults: VectorDefaults = { stroke: "#1e2336", fill: "#d9d4cf" };
