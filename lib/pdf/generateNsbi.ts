import { buildNsbiDocument } from "@/lib/pdf/nsbiDocument";
import { printHTMLContent } from "@/lib/pdf/utils";
import { supabase } from "@/lib/supabase/client";
import type { NsbiBuilding, NsbiRoom, NsbiSubmission } from "@/types";

/**
 * Fetches a filed inventory and prints it. The document itself is built in
 * lib/pdf/nsbiDocument.ts, which imports no Supabase client so the facsimile
 * can be tested without a database — the same split generateAnswerSheets and
 * generateExamResultSlips use.
 */
export async function generateNsbi(submissionId: string): Promise<void> {
  const { data: submission, error: sErr } = await supabase
    .from("sms_nsbi_submissions")
    .select("*")
    .eq("id", Number(submissionId))
    .single();
  if (sErr || !submission) throw new Error("Inventory not found");

  const { data: school, error: schErr } = await supabase
    .from("sms_schools")
    .select("name, school_id, division_id, region")
    .eq("id", submission.school_id)
    .single();
  if (schErr || !school) throw new Error("School not found");

  const { data: buildings, error: bErr } = await supabase
    .from("sms_nsbi_buildings")
    .select("*")
    .eq("submission_id", Number(submissionId))
    .order("sort_order");
  if (bErr) throw bErr;

  const { data: rooms, error: rErr } = await supabase
    .from("sms_nsbi_rooms")
    .select("*")
    .eq("submission_id", Number(submissionId))
    .order("sort_order");
  if (rErr) throw rErr;

  printHTMLContent(
    buildNsbiDocument({
      submission: submission as NsbiSubmission,
      buildings: (buildings ?? []) as NsbiBuilding[],
      rooms: (rooms ?? []) as NsbiRoom[],
      school,
    }),
  );
}
