import { PageHeader, ComingSoon } from "@/components/shell/PageHeader";

export default function RegionsPage() {
  return (
    <>
      <PageHeader
        title="Regions"
        subtitle="Geographical comparison and drill-down into cities, areas and products."
      />
      <ComingSoon note="Regional comparison table + chart with the Region → City → Therapeutic Area → Product drill-down, ending on the relevant HCPs (Contract §9, SRS §15)." />
    </>
  );
}
