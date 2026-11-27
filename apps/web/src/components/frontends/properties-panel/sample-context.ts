import { createContext, useContext } from "react";

/**
 * Arms the owner's eyedropper over something the browser's own cannot reach (the canvas): the colour of the next click goes to
 * `onColor`. Absent, the colour picker shows no such button.
 */
export type SampleColor = (onColor: (color: string) => void) => void;

export const SampleColorContext = createContext<SampleColor | undefined>(undefined);

export const useSampleColor = () => useContext(SampleColorContext);
