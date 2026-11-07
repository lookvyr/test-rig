import type { LucideIcon, LucideProps } from "lucide-react";

/** State icons use the same static Lucide glyphs as the rest of Test Rig. */
export function MorphIcon({ icon: Icon, ...props }: LucideProps & { icon: LucideIcon }) {
  return <Icon {...props} />;
}
