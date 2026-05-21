import { GeneralSettings } from "@/components/settings/GeneralSettings";

export default function GeneralSettingsPage() {
  return (
    <div className="p-6 max-w-xl">
      <h2 className="text-sm font-medium text-[var(--text-primary)] mb-6">Général</h2>
      <GeneralSettings />
    </div>
  );
}
