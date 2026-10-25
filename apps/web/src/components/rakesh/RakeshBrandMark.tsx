import { T3Wordmark } from "../T3Wordmark";

// The sidebar's top-left mark for this fork: "T3-R", matching the app icon.
// Text colour is inherited from the sidebar's brand <Link>.
export function RakeshBrandMark() {
  return (
    <span
      aria-label="T3-R"
      className="inline-flex min-w-0 items-baseline text-sm font-bold tracking-tight"
    >
      <T3Wordmark aria-hidden className="h-[1cap] w-auto shrink-0" />
      <span
        aria-hidden
        className="[text-box:trim-both_cap_alphabetic] supports-[text-box:trim-both_cap_alphabetic]:py-1"
      >
        -R
      </span>
    </span>
  );
}
