import { createContext } from "react";

/** True for a thread kept mounted under Settings; its global shortcuts stand down. */
export const BackgroundThreadContext = createContext(false);
