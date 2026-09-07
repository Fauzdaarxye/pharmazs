import { PageHeader, ComingSoon } from "@/components/shell/PageHeader";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" subtitle="Account, workspace and data preferences." />
      <ComingSoon note="User, workspace and notification settings will live here." />
    </>
  );
}
