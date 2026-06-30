import Link from "next/link";

const SETTINGS_NAV = [
  { href: "/settings/general", label: "Général" },
  { href: "/settings/categories", label: "Catégories" },
  { href: "/settings/extensions", label: "Extensions" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      <aside className="w-48 flex-shrink-0 border-r border-[var(--border-subtle)] py-6 px-3">
        <p className="px-3 text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mb-3">
          Réglages
        </p>
        <nav className="space-y-0.5">
          {SETTINGS_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] rounded-md transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
