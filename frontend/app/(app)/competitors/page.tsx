import { PageHeader, ComingSoon } from "@/components/shell/PageHeader";

export default function CompetitorsPage() {
  return (
    <>
      <PageHeader
        title="Competitors"
        subtitle="Our share versus rivals by product and region, and where share is moving."
      />
      <ComingSoon note="Our share vs competitor share by product and region, share movement over time, and the biggest share losses highlighted (Contract §9)." />
    </>
  );
}
