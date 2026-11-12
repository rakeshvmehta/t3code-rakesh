import { cn } from "../../lib/utils";
import { APP_VERSION } from "../../branding";
import { resolveRakeshBrandName } from "../../branding.logic";
import { T3Wordmark } from "../T3Wordmark";

export function RakeshBrandMark({ onBackdrop }: { onBackdrop: boolean }) {
  const brandName = resolveRakeshBrandName(APP_VERSION);
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1 text-sm font-medium tracking-tight">
      <span
        role="img"
        aria-label={brandName}
        className="inline-flex shrink-0 items-baseline font-bold"
      >
        <T3Wordmark aria-hidden className="h-[1cap] w-auto shrink-0" />
        <span
          aria-hidden
          className="[text-box:trim-both_cap_alphabetic] supports-[text-box:trim-both_cap_alphabetic]:py-1"
        >
          {brandName.slice(2)}
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
