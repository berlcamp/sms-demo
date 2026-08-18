"use client";

/** PWD and 4P's Beneficiary Data Set — the signed-in school's own row. */

import { PwdFourPsDataSet } from "@/components/reports/PwdFourPsDataSet";

export default function Page() {
  return <PwdFourPsDataSet scope="school" />;
}
