"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSidebar } from "@/components/ui/sidebar";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import HeaderDropdown from "@/components/HeaderDropdownMenu";
import { getCurrentSchoolYear } from "@/lib/dashboard-utils";
import {
  BarChart3,
  Building2,
  ChevronDown,
  ClipboardList,
  FileBarChart,
  GraduationCap,
  LayoutDashboard,
  List,
  Menu,
  School,
  Users,
  Wrench,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

type ReportItem = {
  label: string;
  href: string;
  icon: typeof List;
};

const REPORT_ITEMS: ReportItem[] = [
  { label: "All Reports", href: "/division/reports", icon: FileBarChart },
  { label: "School List", href: "/division/reports/school-list", icon: List },
  { label: "Enrollment", href: "/division/reports/enrollment", icon: Users },
  {
    label: "Track & Strand (SHS)",
    href: "/division/reports/track-strand",
    icon: GraduationCap,
  },
  {
    label: "SHS Specialization",
    href: "/division/reports/shs-specialization",
    icon: GraduationCap,
  },
  {
    label: "Teaching Personnel",
    href: "/division/reports/teaching-personnel",
    icon: Users,
  },
  {
    label: "Teaching Specialization",
    href: "/division/reports/teaching-specialization",
    icon: ClipboardList,
  },
  {
    label: "Non-Teaching Personnel",
    href: "/division/reports/non-teaching",
    icon: Users,
  },
  { label: "Rooms", href: "/division/reports/rooms", icon: School },
  {
    label: "Classroom Needs",
    href: "/division/reports/classroom-needs",
    icon: Wrench,
  },
];

export function DivisionHeader() {
  const pathname = usePathname();
  const { toggleSidebar } = useSidebar();
  const schoolYear = getCurrentSchoolYear();

  const onReports = pathname?.startsWith("/division/reports") ?? false;
  const onDashboard = pathname === "/home" || pathname === "/division";

  const linkClass = (active: boolean) =>
    `h-9 px-3.5 rounded-lg text-sm font-medium transition-colors ${
      active
        ? "bg-slate-900/5 text-slate-900"
        : "text-slate-600 hover:text-slate-900 hover:bg-slate-900/5"
    }`;

  return (
    <header className="fixed top-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex items-center justify-between h-16 gap-2">
          {/* Left: sidebar toggle + logo */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="size-9 text-slate-600 hover:text-slate-900 hover:bg-slate-900/5"
              onClick={toggleSidebar}
              aria-label="Toggle navigation"
            >
              <Menu className="h-5 w-5" />
            </Button>

            <Link href="/home" className="flex items-center gap-3 group min-w-0">
              <div className="relative h-9 w-9 flex-shrink-0 rounded-xl bg-slate-900/5 p-1 ring-1 ring-slate-900/10 group-hover:ring-slate-900/20 transition-all">
                <Image
                  src="/deped-logo.svg"
                  alt="DepEd"
                  fill
                  className="object-contain"
                  priority
                />
              </div>
              <div className="hidden sm:flex flex-col min-w-0">
                <p className="text-sm font-bold text-slate-900 tracking-tight leading-tight truncate">
                  Division Office
                </p>
                <p className="text-[11px] text-slate-500 font-medium truncate">
                  Division Dashboard
                </p>
              </div>
            </Link>
          </div>

          {/* Center nav */}
          <div className="flex items-center gap-1">
            <Link href="/home">
              <Button
                variant="ghost"
                size="sm"
                className={linkClass(onDashboard)}
              >
                <LayoutDashboard className="h-4 w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Dashboard</span>
              </Button>
            </Link>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={linkClass(onReports)}
                >
                  <BarChart3 className="h-4 w-4 sm:mr-1.5" />
                  <span className="hidden sm:inline">Reports</span>
                  <ChevronDown className="h-3.5 w-3.5 ml-1 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-60 bg-white border-slate-200 shadow-lg"
              >
                <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Division Reports
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {REPORT_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <DropdownMenuItem key={item.href} asChild>
                      <Link
                        href={item.href}
                        className="cursor-pointer flex items-center gap-2 text-slate-700 hover:text-slate-900 focus:text-slate-900 focus:bg-slate-50"
                      >
                        <Icon className="h-4 w-4 text-slate-500" />
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden md:inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-900/5 border border-slate-900/10 px-3 py-1.5 rounded-full">
              <Building2 className="h-3.5 w-3.5" />
              SY {schoolYear}
            </span>
            <NotificationBell />
            <HeaderDropdown />
          </div>
        </nav>
      </div>
    </header>
  );
}
