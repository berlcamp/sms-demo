"use client";

import { StudentAuthGuard } from "@/components/StudentAuthGuard";
import { Button } from "@/components/ui/button";
import { useStudentSession } from "@/lib/student-portal/context";
import { logoutStudent } from "@/lib/student-portal/actions";
import { Award, ClipboardCheck, LayoutDashboard, LogOut, UserCircle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function StudentPortalAuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { session } = useStudentSession();

  const navLinkClass = (active: boolean) =>
    `relative inline-flex items-center gap-2 px-1 pb-3 text-[13px] font-medium tracking-tight transition-colors ${
      active
        ? "text-[var(--ink)]"
        : "text-[var(--ink-3)] hover:text-[var(--ink)]"
    } after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:origin-left after:transition-transform after:duration-300 ${
      active
        ? "after:bg-[var(--brass)] after:scale-x-100"
        : "after:bg-[var(--ink-3)]/40 after:scale-x-0 hover:after:scale-x-100"
    }`;

  return (
    <StudentAuthGuard>
      <div className="paper-ground paper-grain font-ui relative min-h-screen text-[var(--ink-2)]">
        {/* Masthead */}
        <header className="border-b border-[var(--rule)]">
          <div className="mx-auto max-w-7xl px-4 pt-28 sm:px-6 sm:pt-36 lg:px-8">
            <div className="flex flex-col gap-8 animate-fade-up sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="label-data flex items-center gap-3 text-[var(--brass)]">
                  <UserCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Student Portal
                </p>
                <h1 className="font-display mt-4 text-4xl leading-[1.05] tracking-tight text-[var(--ink)] sm:text-5xl">
                  Welcome, {session?.studentName ?? "Student"}
                </h1>
                <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-[var(--ink-2)]">
                  Your academic records and grade information.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
                <Link
                  href="/student-portal/dashboard"
                  className={navLinkClass(pathname === "/student-portal/dashboard")}
                >
                  <LayoutDashboard className="h-4 w-4" />
                  Dashboard
                </Link>
                <Link
                  href="/student-portal/grades"
                  className={navLinkClass(pathname === "/student-portal/grades")}
                >
                  <Award className="h-4 w-4" />
                  Grade Records
                </Link>
                <Link
                  href="/student-portal/evaluations"
                  className={navLinkClass(pathname === "/student-portal/evaluations")}
                >
                  <ClipboardCheck className="h-4 w-4" />
                  Evaluations
                </Link>
                <form action={logoutStudent} className="inline">
                  <Button
                    type="submit"
                    variant="ghost"
                    className="h-auto gap-2 px-1 pb-3 text-[13px] font-medium tracking-tight text-[var(--ink-3)] hover:bg-transparent hover:text-[var(--ink)]"
                  >
                    <LogOut className="h-4 w-4" strokeWidth={1.75} />
                    Logout
                  </Button>
                </form>
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          {children}
        </div>
      </div>
    </StudentAuthGuard>
  );
}
