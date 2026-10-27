import type { LayerContainerProps } from "../src";
import { StackProvider, useStack } from "../src/stack.ts";

export function ToastGroup({ children, overlays }: LayerContainerProps) {
  const stack = useStack(overlays);
  return (
    <ol
      className="toast-group"
      aria-live="polite"
      data-expanded={stack.expanded}
      style={{ "--front-height": `${stack.frontHeight}px` } as React.CSSProperties}
      {...stack.props}
    >
      <StackProvider stack={stack}>{children}</StackProvider>
    </ol>
  );
}
