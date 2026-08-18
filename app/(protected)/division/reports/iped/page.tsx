"use client";

/** IPEd Program Data Set — division-wide, one row per school. */

import { IpedDataSet } from "@/components/reports/IpedDataSet";

export default function Page() {
  return <IpedDataSet scope="division" />;
}
