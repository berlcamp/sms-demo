"use client";

/** IPEd Program Data Set — the signed-in school's own row. */

import { IpedDataSet } from "@/components/reports/IpedDataSet";

export default function Page() {
  return <IpedDataSet scope="school" />;
}
