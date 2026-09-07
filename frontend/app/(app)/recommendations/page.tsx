import { PageHeader, ComingSoon } from "@/components/shell/PageHeader";

export default function RecommendationsPage() {
  return (
    <>
      <PageHeader
        title="Recommendations"
        subtitle="Decision support: what to do next, why, and the expected impact."
      />
      <ComingSoon note="Recommendation cards (title, computed rationale, expected impact, priority, confidence) with the 'Why did sales change?' panel: headline change, five ranked contributors and recommended actions (Contract §9, SRS §25, §26)." />
    </>
  );
}
