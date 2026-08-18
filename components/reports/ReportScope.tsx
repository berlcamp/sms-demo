"use client";

/**
 * Scope plumbing for the two IPEd workbook forms, which are published at two
 * routes each.
 *
 * THE SCOPE IS THE ROUTE, NOT THE ROLE. `/division/reports/*` is always the
 * division-wide roll-up — one row per school, the shape the printed form takes
 * — and `/school-reports/*` is always the signed-in school alone. An earlier
 * cut inferred it from the user's type instead, which reads correctly for a
 * school head and a division admin but not for a `super admin`, who is both:
 * they would get the division roll-up from the school-level page, with no way
 * to ask for their own school. A route says unambiguously which report was
 * asked for, so nothing has to be inferred.
 */

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAppSelector } from "@/lib/redux/hook";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

/** Which of the two routes a report is being rendered under. */
export type ReportScope = "division" | "school";

/**
 * Roles allowed on the school-level route. Mirrors `ReportShell`'s
 * `REPORT_ROLES` — the Reports module's own staff roles.
 */
export const SCHOOL_REPORT_ROLES = [
  "school_head",
  "assistant_school_head",
  "admin",
  "super admin",
];

/**
 * Roles allowed on the division-wide route. `DivisionGuard` already gates the
 * segment; this is the second check, because hiding a link is not access
 * control.
 */
export const DIVISION_REPORT_ROLES = [
  "division_admin",
  "division_type",
  "super admin",
];

export interface ResolvedScope {
  /** null = every school (the division roll-up); a string = that one school. */
  schoolId: string | null;
  canView: boolean;
  canEdit: boolean;
  /** True once the session has landed and the scope is answerable. */
  ready: boolean;
  /** Set when a school-level user has no school to report on. */
  blockedReason: string | null;
  backHref: string;
  label: string;
}

/**
 * Resolve a report's scope from its route. On the school route the school is
 * the user's ACTIVE school (`sms_users.school_id`, migration 134) — never a
 * picker, so a school head cannot read another school's row and a super admin
 * gets the school their active-school override currently points at.
 */
export function useReportScope(scope: ReportScope): ResolvedScope {
  const user = useAppSelector((state) => state.user.user);
  const userType = user?.type ?? "";
  const isDivision = scope === "division";

  const roles = isDivision ? DIVISION_REPORT_ROLES : SCHOOL_REPORT_ROLES;
  const canView = roles.includes(userType);
  const schoolId =
    isDivision || user?.school_id == null ? null : String(user.school_id);

  return {
    schoolId,
    canView,
    // Viewing and typing carry the same roles on both routes: whoever may open
    // the form is the person the division asks to fill it in.
    canEdit: canView,
    ready: userType !== "" && (isDivision || schoolId !== null),
    blockedReason:
      !isDivision && userType !== "" && schoolId === null
        ? "No school is selected for your account, so there is nothing to report on."
        : null,
    backHref: isDivision ? "/division/reports" : "/school-reports",
    label: isDivision ? "Division-wide" : "This school",
  };
}

export function ReportAccessDenied({ message }: { message: string }) {
  return (
    <div className="p-6">
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/home">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Home
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
