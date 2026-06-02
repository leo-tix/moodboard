import { auth } from "@/auth";

export default async function HomePage() {
  const session = await auth();

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <header className="mb-12">
          <p className="text-[var(--text-tertiary)] text-xs tracking-widest uppercase mb-2">
            Atlas visuel
          </p>
          <h1 className="text-3xl font-light text-[var(--text-primary)] tracking-tight">
            Bonjour
          </h1>
        </header>

        {/* Sections homepage — à remplir progressivement */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <HomeSection title="Récents" href="/library" />
          <HomeSection title="Collections" href="/collections" />
          <HomeSection title="Ajouter" href="/upload" />
        </div>
      </div>
    </div>
  );
}

function HomeSection({ title, href }: { title: string; href: string }) {
  return (
    <a
      href={href}
      className="group block bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-6 hover:border-[var(--border-default)] transition-colors aspect-square flex items-end"
    >
      <span className="text-sm text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
        {title} →
      </span>
    </a>
  );
}
