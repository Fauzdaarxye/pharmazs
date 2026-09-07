import { PageHeader, ComingSoon } from "@/components/shell/PageHeader";

export default function InventoryPage() {
  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="Stock, months of cover and stockout risk across products and regions."
      />
      <ComingSoon note="Stock by product and region — closing stock, months of cover, stockout days — plus an at-risk view sorted by risk (Contract §9)." />
    </>
  );
}
