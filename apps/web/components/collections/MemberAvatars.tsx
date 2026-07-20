import { UserAvatar } from "@/components/social/UserAvatar";
import type { CollectionMember } from "@/lib/collections/members";

const ROLE_LABEL: Record<CollectionMember["role"], string> = { OWNER: "propriétaire", EDITOR: "éditeur", VIEWER: "lecteur" };

// Rangée d'avatars empilés des membres d'une collection partagée. Masquée s'il
// n'y a que le propriétaire (rien à signaler). Composant pur → utilisable côté
// serveur (vue lecture seule) comme client (vue éditable).
export function MemberAvatars({ members }: { members: CollectionMember[] }) {
  if (members.length <= 1) return null;
  const shown = members.slice(0, 6);
  const extra = members.length - shown.length;
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center -space-x-2">
        {shown.map((m) => (
          <div key={m.id} title={`${m.name || `@${m.username}`} · ${ROLE_LABEL[m.role]}`} className="ring-2 ring-[var(--bg-base)] rounded-full">
            <UserAvatar name={m.name} username={m.username} image={m.image} size={26} />
          </div>
        ))}
        {extra > 0 && (
          <div className="w-[26px] h-[26px] rounded-full ring-2 ring-[var(--bg-base)] bg-[var(--bg-elevated)] flex items-center justify-center text-[10px] text-[var(--text-tertiary)]">
            +{extra}
          </div>
        )}
      </div>
      <span className="text-[11px] text-[var(--text-tertiary)]">{members.length} membres</span>
    </div>
  );
}
