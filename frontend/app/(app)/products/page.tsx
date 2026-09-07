import { PageHeader, ComingSoon } from "@/components/shell/PageHeader";

export default function ProductsPage() {
  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Portfolio performance by drug, brand, therapeutic area, price and market share."
      />
      <ComingSoon note="Filterable, sortable, paginated product table with a row-click detail view: revenue trend, regional split, forecast with confidence band and competitor comparison (Contract §9, SRS §11)." />
    </>
  );
}
