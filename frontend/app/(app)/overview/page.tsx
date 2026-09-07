import { PageHeader, ComingSoon } from "@/components/shell/PageHeader";

export default function OverviewPage() {
  return (
    <>
      <PageHeader
        title="Executive Overview"
        subtitle="A high-level read on revenue, the top alerts, recommendations and regional shape."
      />
      <ComingSoon note="Executive landing: headline revenue + growth, top three alerts, top three recommendations, a compact TA breakdown and a regional list (Contract §9)." />
    </>
  );
}
