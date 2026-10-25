import { cn } from "../../lib/utils";
import { T3Wordmark } from "../T3Wordmark";

// The sidebar's top-left mark for this fork: "T3-R Code", matching the app
// icon. The mark's colour is inherited from the sidebar's brand <Link>.
export function RakeshBrandMark({ onBackdrop }: { onBackdrop: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1 text-sm font-medium tracking-tight">
      <span role="img" aria-label="T3-R" className="inline-flex shrink-0 items-baseline font-bold">
        <T3Wordmark aria-hidden className="h-[1cap] w-auto shrink-0" />
        <span
          aria-hidden
          className="[text-box:trim-both_cap_alphabetic] supports-[text-box:trim-both_cap_alphabetic]:py-1"
        >
          -R
        </span>
      </span>
      <span
        className={cn(
          "truncate [text-box:trim-both_cap_alphabetic] supports-[text-box:trim-both_cap_alphabetic]:py-1",
          onBackdrop ? "text-white/70" : "text-muted-foreground",
        )}
      >
        Code
      </span>
    </span>
  );
}
