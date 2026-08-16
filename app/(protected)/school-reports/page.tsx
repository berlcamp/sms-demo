"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ArrowRight,
  Award,
  BookOpen,
  Clock,
  FileBarChart,
  Gauge,
  LayoutGrid,
  MapPin,
} from "lucide-react";
import Link from "next/link";
import {
  ReportAccessDenied,
  useCanViewReports,
} from "./components/ReportShell";

const REPORTS = [
  {
    title: "Key Performance Indicators",
    description:
      "Access, efficiency and ratio indicators per the DepEd guide — GER, NER, GIR, NIR, transition, promotion, repetition, survival, completion and the learner ratios.",
    href: "/school-reports/kpi",
    icon: Gauge,
  },
  {
    title: "Subjects Handled by Teacher",
    description:
      "Every scheduled subject per teacher — section, days, time, room, weekly minutes and learner count.",
    href: "/school-reports/subjects-handled",
    icon: BookOpen,
  },
  {
    title: "Teaching Load (minutes per day)",
    description:
      "Daily teaching minutes per teacher with DepEd advisorship and ARAL equivalents, and the weekly total.",
    href: "/school-reports/teaching-load",
    icon: Clock,
  },
  {
    title: "Classroom Enrollment and Size",
    description:
      "Every section of the current school year with its classroom dimension, capacity and actual number of enrollees.",
    href: "/school-reports/classroom-enrollment",
    icon: LayoutGrid,
  },
  {
    title: "Enrollment and Good Moral Certificates",
    description:
      "Print Certificate of Enrollment or Certificate of Good Moral Character per section, or for one learner.",
    href: "/school-reports/certificates",
    icon: Award,
  },
  {
    title: "Child Mapping",
    description:
      "Barangay-level mapping of school-age children, in-school and out-of-school.",
    href: "/school-reports/child-mapping",
    icon: MapPin,
  },
];

export default function Page() {
  const canView = useCanViewReports();
  if (!canView) return <ReportAccessDenied />;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-2">
        <FileBarChart className="h-6 w-6" />
        <div>
          <h1 className="text-xl font-semibold">Reports</h1>
          <p className="text-sm text-muted-foreground">
            School-level reports, printable as PDF.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((report) => {
          const Icon = report.icon;
          return (
            <Link key={report.href} href={report.href} className="group">
              <Card className="h-full border-0 shadow-lg transition-shadow hover:shadow-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="h-5 w-5 shrink-0" />
                    {report.title}
                  </CardTitle>
                  <CardDescription>{report.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <span className="inline-flex items-center text-sm font-medium text-primary">
                    Open report
                    <ArrowRight className="h-4 w-4 ml-1 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
