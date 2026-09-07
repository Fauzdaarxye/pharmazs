import { PageHeader, ComingSoon } from "@/components/shell/PageHeader";

export default function SalesRepsPage() {
  return (
    <>
      <PageHeader
        title="Sales Representatives"
        subtitle="Leaderboard of revenue, target achievement, visits and panel coverage."
      />
      <ComingSoon note="Rep leaderboard (revenue, target, achievement % with progress bar, visits, HCP count, rank) and a rep detail with their panel and recommended HCPs (Contract §9, SRS §14, §27)." />
    </>
  );
}
