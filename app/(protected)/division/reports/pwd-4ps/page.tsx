"use client";

/** PWD and 4P's Beneficiary Data Set — division-wide, one row per school. */

import { PwdFourPsDataSet } from "@/components/reports/PwdFourPsDataSet";

export default function Page() {
  return <PwdFourPsDataSet scope="division" />;
}
