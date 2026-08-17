"use client";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getSchoolTypeLabel } from "@/lib/constants";
import { ORG_NAME } from "@/lib/constants/branding";
import { TEST_SCHOOL_ID_FILTER } from "@/lib/constants/landing";
import { supabase } from "@/lib/supabase/client";
import { Building2, MapPin, School } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface School {
  id: string;
  school_id: string;
  slug: string;
  name: string;
  school_type: string | null;
  address: string | null;
  district: string | null;
}

function getSchoolTypeBadgeClass(type: string | null): string {
  const classes: Record<string, string> = {
    elementary: "border-[var(--band-elem)]/30 bg-[var(--band-elem)]/8 text-[var(--band-elem)]",
    junior_high: "border-[var(--band-jhs)]/30 bg-[var(--band-jhs)]/8 text-[var(--band-jhs)]",
    senior_high: "border-[var(--band-shs)]/30 bg-[var(--band-shs)]/8 text-[var(--band-shs)]",
    complete_secondary: "border-[var(--brass)]/30 bg-[var(--brass)]/8 text-[var(--brass)]",
    integrated: "border-[var(--ink-3)]/30 bg-[var(--ink-3)]/8 text-[var(--ink-2)]",
  };
  return type
    ? (classes[type] ?? "border-[var(--rule)] bg-[var(--paper-raised)] text-[var(--ink-2)]")
    : "border-[var(--rule)] bg-[var(--paper-raised)] text-[var(--ink-3)]";
}

export default function SchoolListPage() {
  const router = useRouter();
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSchools = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("sms_schools")
        .select("id, school_id, slug, name, school_type, address, district")
        .not("id", "in", TEST_SCHOOL_ID_FILTER)
        .eq("is_active", true)
        .order("name");

      if (error) {
        console.error("Schools fetch error:", error);
        setSchools([]);
        return;
      }
      setSchools((data as School[]) || []);
    } catch (err) {
      console.error("Schools fetch error:", err);
      setSchools([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSchools();
  }, [fetchSchools]);

  return (
    <div className="paper-ground paper-grain font-ui relative min-h-screen pb-20 text-[var(--ink-2)]">
      {/* Masthead */}
      <header className="border-b border-[var(--rule)]">
        <div className="mx-auto max-w-7xl px-4 pb-12 pt-28 sm:px-6 sm:pb-16 sm:pt-36 lg:px-8">
          <div className="animate-fade-up">
            <p className="label-data flex items-center gap-3 text-[var(--brass)]">
              <Building2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              {ORG_NAME}
            </p>
            <h1 className="font-display mt-4 text-4xl leading-[1.05] tracking-tight text-[var(--ink)] sm:text-5xl">
              School Directory
            </h1>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-[var(--ink-2)]">
              Every active public school in the division. Select a row to open
              that school&apos;s page.
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-end justify-between border-b border-[var(--rule)] pb-4">
          <p className="label-data text-[var(--ink-3)]">
            <School className="mr-2 inline h-3.5 w-3.5" strokeWidth={1.75} />
            Active schools
          </p>
          {!loading && (
            <p className="font-data text-[11px] text-[var(--ink-3)]">
              {schools.length} on record
            </p>
          )}
        </div>

        {loading ? (
          <div className="border-t border-[var(--rule)]">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-4 border-b border-[var(--rule)] py-4"
              >
                <Skeleton className="h-4 w-20 rounded-sm bg-[var(--rule-faint)]" />
                <Skeleton className="h-4 flex-1 rounded-sm bg-[var(--rule-faint)]" />
                <Skeleton className="hidden h-4 w-24 rounded-sm bg-[var(--rule-faint)] md:block" />
                <Skeleton className="hidden h-4 w-32 rounded-sm bg-[var(--rule-faint)] lg:block" />
              </div>
            ))}
          </div>
        ) : schools.length === 0 ? (
          <div className="border border-dashed border-[var(--rule)] py-20 text-center">
            <p className="font-display text-lg text-[var(--ink)]">
              No schools on record
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto border-t-2 border-[var(--ink)]">
            <Table>
              <TableHeader>
                <TableRow className="border-[var(--rule)] hover:bg-transparent">
                  {["School ID", "Name", "Type", "Address", "District"].map(
                    (h, i) => (
                      <TableHead
                        key={h}
                        className={`label-data h-auto py-3 text-[var(--ink-3)] ${
                          i === 3
                            ? "hidden md:table-cell"
                            : i === 4
                              ? "hidden lg:table-cell"
                              : ""
                        }`}
                      >
                        {h}
                      </TableHead>
                    ),
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {schools.map((s) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer border-[var(--rule)] transition-colors hover:bg-[var(--paper-raised)]/70"
                    onClick={() => router.push(`/schools/${s.slug}`)}
                  >
                    <TableCell className="font-data py-4 text-[13px] text-[var(--brass)]">
                      {s.school_id}
                    </TableCell>
                    <TableCell className="font-display py-4 text-[15px] text-[var(--ink)]">
                      {s.name}
                    </TableCell>
                    <TableCell className="py-4">
                      <span
                        className={`inline-flex items-center rounded-sm border px-2.5 py-1 text-[11px] font-medium ${getSchoolTypeBadgeClass(
                          s.school_type,
                        )}`}
                      >
                        {getSchoolTypeLabel(s.school_type)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden py-4 text-[13px] text-[var(--ink-2)] md:table-cell">
                      <span className="flex items-center gap-1.5">
                        <MapPin
                          className="h-3.5 w-3.5 shrink-0 text-[var(--ink-3)]"
                          strokeWidth={1.75}
                        />
                        {s.address || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="hidden py-4 text-[13px] text-[var(--ink-2)] lg:table-cell">
                      {s.district || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
