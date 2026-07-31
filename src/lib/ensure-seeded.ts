import { isSeeded, seedDatabase } from "@/lib/seed";

let seedingPromise: Promise<void> | null = null;

export async function ensureSeeded(): Promise<void> {
  if (isSeeded()) return;
  // Guard against concurrent first-requests each kicking off their own seed.
  if (!seedingPromise) {
    seedingPromise = seedDatabase().finally(() => {
      seedingPromise = null;
    });
  }
  await seedingPromise;
}
