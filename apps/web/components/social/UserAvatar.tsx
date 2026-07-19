import { getImageUrl } from "@/lib/storage/urls";

function initials(name?: string | null, username?: string | null): string {
  const base = (name || username || "?").trim();
  const parts = base.split(/[\s@._]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

// Avatar réutilisable (server ou client) : photo R2 ou initiales.
export function UserAvatar({
  name,
  username,
  image,
  size = 40,
}: {
  name?: string | null;
  username?: string | null;
  image?: string | null;
  size?: number;
}) {
  return (
    <span
      style={{ width: size, height: size }}
      className="rounded-full overflow-hidden bg-[var(--bg-elevated)] border border-[var(--border-default)] flex items-center justify-center flex-shrink-0"
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={getImageUrl(image)} alt="" className="w-full h-full object-cover" />
      ) : (
        <span className="font-medium text-[var(--text-secondary)]" style={{ fontSize: size * 0.36 }}>
          {initials(name, username)}
        </span>
      )}
    </span>
  );
}
