import { createOverlayManager } from "../src";
import { ToastGroup } from "./ToastGroup";

export const overlays = createOverlayManager({
  layers: {
    modal: {},
    menu: { limit: 1, overflow: "dismiss-oldest" },
    // ToastGroup turns this layer into a pile that spreads out on hover. The limit caps runaway toast loops.
    toast: { limit: 24, container: ToastGroup },
  },
});
