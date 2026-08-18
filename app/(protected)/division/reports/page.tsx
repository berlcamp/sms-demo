"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Building2,
  ClipboardList,
  FileBarChart,
  GraduationCap,
  HeartHandshake,
  Landmark,
  LayoutGrid,
  LucideIcon,
  Ruler,
  School as SchoolIcon,
  Sprout,
  UserCog,
  Users,
} from "lucide-react";
import Link from "next/link";

interface ReportCard {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  available: boolean;
}

const reports: ReportCard[] = [
  {
    title: "School List",
    description: "Directory of all schools in the division with contact details.",
    href: "/division/reports/school-list",
    icon: SchoolIcon,
    available: true,
  },
  {
    title: "Enrollment",
    description:
      "Learners by grade level, sex, modality, and category. Submission-based.",
    href: "/division/reports/enrollment",
    icon: GraduationCap,
    available: true,
  },
  {
    title: "Track & Strand (SHS)",
    description: "Senior High learners by track and strand.",
    href: "/division/reports/track-strand",
    icon: ClipboardList,
    available: true,
  },
  {
    title: "SHS Specialization",
    description: "SHS learners by specific specialization under each strand.",
    href: "/division/reports/shs-specialization",
    icon: LayoutGrid,
    available: true,
  },
  {
    title: "Teaching Personnel",
    description: "Count of teaching staff per school.",
    href: "/division/reports/teaching-personnel",
    icon: Users,
    available: true,
  },
  {
    title: "Teaching Specialization",
    description: "Teaching staff by subject learning area. Submission-based.",
    href: "/division/reports/teaching-specialization",
    icon: UserCog,
    available: true,
  },
  {
    title: "Non-Teaching Personnel",
    description: "Admin, utility, security, health, library, guidance, etc.",
    href: "/division/reports/non-teaching",
    icon: Landmark,
    available: true,
  },
  {
    title: "Rooms",
    description: "Room inventory by type and condition.",
    href: "/division/reports/rooms",
    icon: Building2,
    available: true,
  },
  {
    title: "Classroom Needs Analysis",
    description:
      "Shortage or surplus based on enrollment vs available classrooms.",
    href: "/division/reports/classroom-needs",
    icon: Ruler,
    available: true,
  },
  // The division-wide cut of the two IPEd workbook forms: one row per school,
  // the shape the printed form takes. The school-level cut of the same two
  // reports lives under /school-reports.
  {
    title: "IPEd Program Data Set",
    description:
      "IP enrolment by band, the orientation matrices and the division's activities and issues, per school and fiscal year.",
    href: "/division/reports/iped",
    icon: Sprout,
    available: true,
  },
  {
    title: "PWD and 4P's Beneficiary Data Set",
    description:
      "Learners with a disability, 4Ps beneficiaries and IP learners by sex — per school and per grade level.",
    href: "/division/reports/pwd-4ps",
    icon: HeartHandshake,
    available: true,
  },
];

export default function Page() {
  return (
    <div>
      <div className="app__title">
        <h1 className="app__title_text flex items-center gap-2">
          <FileBarChart className="h-5 w-5" />
          SDO Reports
        </h1>
        <p className="text-sm text-muted-foreground">
          Division-wide reports aggregated across all schools. Select a report
          below.
        </p>
      </div>

      <div className="app__content">
        <div className="mb-4 flex flex-wrap items-center justify-end gap-4">
          <Link
            href="/division/reports/lock-sy"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Lock / unlock submissions →
          </Link>
          <Link
            href="/division/reports/class-size-standards"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Configure class size standards →
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((r) => {
            const Icon = r.icon;
            const card = (
              <Card
                className={
                  r.available
                    ? "cursor-pointer transition-all hover:border-primary hover:shadow-md"
                    : "opacity-60"
                }
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Icon className="h-5 w-5 text-primary" />
                      <CardTitle className="text-base">{r.title}</CardTitle>
                    </div>
                    {!r.available && (
                      <Badge variant="secondary" className="text-xs">
                        Coming soon
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="text-xs">
                    {r.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <span className="text-xs font-medium text-primary">
                    {r.available ? "View report →" : "Phase 2+"}
                  </span>
                </CardContent>
              </Card>
            );

            return r.available ? (
              <Link key={r.title} href={r.href}>
                {card}
              </Link>
            ) : (
              <div key={r.title}>{card}</div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
