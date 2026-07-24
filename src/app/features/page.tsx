"use client";
// /features - full capability directory.
import FeatureGrid from "@/components/FeatureGrid";

export default function FeaturesPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-zinc-100">All capabilities</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Everything MemePump can do, and whether each is live, needs setup (an API key/toggle in
        the admin panel), or is currently off.
      </p>
      <div className="mt-6"><FeatureGrid /></div>
    </main>
  );
}
