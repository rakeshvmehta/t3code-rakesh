import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { applyWebBrandAssets } from "./apply-web-brand-assets.ts";

const WEB_ICON_FILENAMES = [
  "apple-touch-icon.png",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "favicon.ico",
  "icon-192x192.png",
  "icon-512x512.png",
];

it.layer(NodeServices.layer)("apply-web-brand-assets", (it) => {
  it.effect("uses the personal nightly mark on the startup screen and web icons", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const target = yield* fs.makeTempDirectoryScoped({ prefix: "rakesh-nightly-brand-" });
      const index = path.join(target, "index.html");
      yield* fs.writeFileString(
        index,
        '<title>T3 Code (Beta)</title><div aria-label="T3 Code splash screen"><img alt="T3 Code" /></div>',
      );
      yield* applyWebBrandAssets("rakesh-nightly", target);
      assert.equal(
        yield* fs.readFileString(index),
        '<title>T3-RN</title><div aria-label="T3-RN splash screen"><img alt="T3-RN" /></div>',
      );
      const repo = yield* path.fromFileUrl(new URL("..", import.meta.url));
      assert.deepEqual(
        yield* fs.readFile(path.join(target, "apple-touch-icon.png")),
        yield* fs.readFile(path.join(repo, "assets/rakesh/nightly/apple-touch-icon.png")),
      );
    }),
  );

  it.effect("copies the icons into an absolute target directory as given", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const targetDirectory = yield* fs.makeTempDirectoryScoped({
        prefix: "apply-web-brand-assets-",
      });

      yield* applyWebBrandAssets("production", targetDirectory);

      assert.deepStrictEqual(
        (yield* fs.readDirectory(targetDirectory)).toSorted(),
        WEB_ICON_FILENAMES,
      );
    }),
  );

  it.effect("resolves an empty target directory to the repo root", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const repoRoot = yield* path.fromFileUrl(new URL("..", import.meta.url));
      const destinations = WEB_ICON_FILENAMES.map((filename) => path.join(repoRoot, filename));
      // readDirectory does not follow symlinks, so a dangling link counts as an existing entry.
      // Names are lowercased so a case-insensitive filesystem cannot hide a differently cased file.
      const existingEntries = new Set(
        (yield* fs.readDirectory(repoRoot)).map((entry) => entry.toLowerCase()),
      );
      for (const destination of destinations) {
        assert.isFalse(
          existingEntries.has(path.basename(destination)),
          `${destination} already exists`,
        );
      }
      yield* Effect.addFinalizer(() =>
        Effect.forEach(destinations, (destination) => fs.remove(destination, { force: true })).pipe(
          Effect.orDie,
        ),
      );

      yield* applyWebBrandAssets("production", "");

      for (const destination of destinations) {
        assert.isTrue(yield* fs.exists(destination));
      }
    }),
  );
});
