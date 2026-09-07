import { PageHeader, ComingSoon } from "@/components/shell/PageHeader";

export default function ForecastingPage() {
  return (
    <>
      <PageHeader
        title="Forecasting"
        subtitle="Projected demand by entity and horizon — an estimate, never a guarantee."
      />
      <ComingSoon note="Entity picker (Company / Drug / Region / TA) + horizon control rendering history, point forecast, a confidence band and backtest MAPE, worded as an estimate (Contract §9, SRS §23)." />
    </>
  );
}
