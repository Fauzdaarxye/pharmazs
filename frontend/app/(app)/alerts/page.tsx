import { PageHeader, ComingSoon } from "@/components/shell/PageHeader";

export default function AlertsPage() {
  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="Business alerts grouped by severity, with read/unread state."
      />
      <ComingSoon note="Business alerts grouped by severity, filterable, with a read/unread state (Contract §9)." />
    </>
  );
}
