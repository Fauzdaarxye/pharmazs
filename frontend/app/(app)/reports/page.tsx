import { PageHeader, ComingSoon } from "@/components/shell/PageHeader";

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Saved and exportable views of the current filtered data."
      />
      <ComingSoon note="Saved / exportable views with CSV export of the current filtered table (Contract §9)." />
    </>
  );
}
