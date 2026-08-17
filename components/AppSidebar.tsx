"use client";

import {
  BarChart3,
  BookMarked,
  BookOpen,
  BookOpenCheck,
  Building2,
  Calendar,
  CalendarCheck,
  CalendarOff,
  ClipboardCheck,
  ClipboardList,
  FileBarChart,
  FileSpreadsheet,
  FileText,
  Gauge,
  GraduationCap,
  Heart,
  Home,
  IdCard,
  Loader2,
  NotebookPen,
  NotebookText,
  Settings,
  Sprout,
  Tags,
  Telescope,
  TrendingUp,
  User,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { usePendingRequestCounts } from "@/hooks/usePendingRequestCounts";
import { canEnrolLearners } from "@/lib/constants";
import { useAppSelector } from "@/lib/redux/hook";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import NProgress from "nprogress";
import { useEffect, useState } from "react";

interface ModuleItem {
  title: string;
  url: string;
  icon: typeof Home;
  moduleName: string;
  /** Count of items waiting on the user, drawn as a badge beside the title. */
  badge?: number;
}

export function AppSidebar() {
  const pathname = usePathname();
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const user = useAppSelector((state) => state.user.user);

  // Reset loading state when pathname changes
  useEffect(() => {
    setLoadingPath(null);
  }, [pathname]);

  const handleLinkClick = (url: string) => {
    // Don't trigger if already on this page
    if (pathname === url) return;

    // Start progress bar and set loading state
    NProgress.start();
    setLoadingPath(url);
  };

  // Menu items.
  const allItems = [
    {
      title: "Home",
      url: "/home",
      icon: Home,
    },
  ];

  // Show all menu items to all authenticated users
  const items = allItems;

  // Module items configuration
  const allModuleItems: ModuleItem[] = [
    {
      title: "Enrollment",
      url: "/enrollment",
      icon: ClipboardList,
      moduleName: "enrollment",
    },
    {
      title: "Subjects",
      url: "/subjects",
      icon: BookOpen,
      moduleName: "subjects",
    },
    {
      title: "Books",
      url: "/books",
      icon: BookMarked,
      moduleName: "books",
    },
    {
      title: "Sections",
      url: "/sections",
      icon: Users,
      moduleName: "sections",
    },
    {
      title: "Students",
      url: "/students",
      icon: GraduationCap,
      moduleName: "students",
    },
    {
      title: "Schedules",
      url: "/schedules",
      icon: Calendar,
      moduleName: "schedules",
    },
    {
      title: "Evaluations",
      url: "/evaluations",
      icon: ClipboardCheck,
      moduleName: "evaluations",
    },
    {
      title: "MPS",
      url: "/mps",
      icon: BarChart3,
      moduleName: "mps",
    },
    {
      title: "ARAL",
      url: "/aral",
      icon: Sprout,
      moduleName: "aral",
    },
  ];

  // Teacher-specific items
  const teacherItems: ModuleItem[] = [
    {
      title: "Dashboard",
      url: "/teacher/dashboard",
      icon: User,
      moduleName: "teacher_dashboard",
    },
    {
      title: "Enrollment",
      url: "/enrollment",
      icon: ClipboardList,
      moduleName: "enrollment",
    },
    {
      title: "My Sections",
      url: "/teacher/sections",
      icon: Users,
      moduleName: "teacher_sections",
    },
    {
      title: "My Subjects",
      url: "/teacher/subjects",
      icon: BookOpen,
      moduleName: "teacher_subjects",
    },
    {
      title: "Class Record",
      url: "/teacher/class-record",
      icon: BookOpenCheck,
      moduleName: "teacher_class_record",
    },
    {
      title: "Assessments",
      url: "/teacher/assessments",
      icon: NotebookPen,
      moduleName: "teacher_assessments",
    },
    {
      title: "ARAL",
      url: "/aral",
      icon: Sprout,
      moduleName: "teacher_aral",
    },
    {
      title: "Examinations",
      url: "/teacher/examinations",
      icon: FileSpreadsheet,
      moduleName: "teacher_examinations",
    },
    {
      title: "Books",
      url: "/teacher/books",
      icon: BookMarked,
      moduleName: "teacher_books",
    },
    {
      title: "Evaluations",
      url: "/teacher/evaluations",
      icon: ClipboardCheck,
      moduleName: "teacher_evaluations",
    },
    {
      title: "MPS",
      url: "/teacher/mps",
      icon: BarChart3,
      moduleName: "teacher_mps",
    },
    {
      title: "Anecdotal Record",
      url: "/teacher/anecdotal",
      icon: NotebookText,
      moduleName: "teacher_anecdotal",
    },
    {
      title: "Manifestation Tagging",
      url: "/teacher/anecdotal/manifestation",
      icon: Tags,
      moduleName: "teacher_manifestation",
    },
    {
      title: "Learner Cardex",
      url: "/teacher/cardex",
      icon: IdCard,
      moduleName: "teacher_cardex",
    },
    {
      title: "Supervision",
      url: "/teacher/supervision",
      icon: Telescope,
      moduleName: "teacher_supervision",
    },
  ];

  // Filter modules based on user access and role
  const userType = user?.type;
  const isSchoolHead =
    userType === "school_head" ||
    userType === "assistant_school_head" ||
    userType === "super admin";
  const isDivisionAdmin =
    userType === "division_admin" || userType === "division_type";
  // A pure tutor logs in with type "tutor"; a staff/teacher who was also added
  // as an ARAL tutor carries the `is_tutor` flag and keeps their normal menus.
  const isTutor = userType === "tutor";
  const hasTutorAccess = isTutor || user?.is_tutor === true;
  // Migration 135's two working non-teaching roles. Each gets one narrow slice
  // of the teacher menu and nothing else — they advise no section, so their
  // pages read the whole school roster via `useAdvisoryLearners`.
  const isGuidanceCounselor = userType === "guidance_counselor";
  const isSchoolNurse = userType === "school_nurse";
  const isSupportRole = isGuidanceCounselor || isSchoolNurse;

  // A volunteer teacher (migration 140) works the whole Teacher Menu except
  // enrolment, so the one module they may not use is not offered. The route and
  // the database refuse it as well — this only keeps the menu honest.
  const teacherMenuItems = canEnrolLearners(userType)
    ? teacherItems
    : teacherItems.filter((item) => item.moduleName !== "enrollment");

  // School management access: school_head, admin, registrar, librarian have similar functions
  const hasSchoolManagementAccess =
    isSchoolHead ||
    userType === "admin" ||
    userType === "registrar" ||
    userType === "librarian";

  // Staff page: only admin and school_head can access (registrar cannot)
  const hasStaffAccess = isSchoolHead || userType === "admin";

  // Pending work behind the Records → Requests item. Only the roles that get
  // that menu entry pay for the three count queries.
  const { total: pendingRequests } = usePendingRequestCounts(
    hasSchoolManagementAccess,
  );

  // Determine which modules to show based on role (Modules section)
  let visibleModuleItems: ModuleItem[] = [];

  if (hasSchoolManagementAccess) {
    // School Head, Admin, and Registrar see all modules
    visibleModuleItems = allModuleItems;
  }
  if (isSchoolHead) {
    // Authoring school-level assessment materials is a school head function.
    visibleModuleItems = [
      ...visibleModuleItems,
      {
        title: "Assessments",
        url: "/school/assessments",
        icon: NotebookPen,
        moduleName: "school_assessments",
      },
    ];
  }
  if (hasStaffAccess) {
    // Monitoring who has encoded grades is a school head / admin function;
    // registrar and librarian have no reason to police teaching staff.
    visibleModuleItems = [
      ...visibleModuleItems,
      {
        title: "Grade Monitoring",
        url: "/grade-monitoring",
        icon: ClipboardCheck,
        moduleName: "grade_monitoring",
      },
      {
        title: "Supervision",
        url: "/supervision",
        icon: Telescope,
        moduleName: "supervision",
      },
      {
        title: "Reports",
        url: "/school-reports",
        icon: FileBarChart,
        moduleName: "school_reports",
      },
      {
        title: "Monitoring",
        url: "/monitoring",
        icon: Telescope,
        moduleName: "monitoring",
      },
    ];
  }
  // Teachers see Students in Teacher Menu (teacherItems), not in Modules

  if (isSchoolNurse) {
    // SF8 is the whole of the school nurse's work here.
    visibleModuleItems = [
      {
        title: "Learner Health",
        url: "/health",
        icon: Heart,
        moduleName: "learner_health",
      },
    ];
  }
  if (isGuidanceCounselor) {
    visibleModuleItems = teacherMenuItems.filter((item) =>
      ["teacher_anecdotal", "teacher_manifestation", "teacher_cardex"].includes(
        item.moduleName,
      ),
    );
  }

  const moduleItems = visibleModuleItems;

  // Teacher Menu: show teacherItems for all users EXCEPT division_admin, tutors
  // and the support roles — the latter get their own slice above, and the full
  // teacher menu (grades, class record, examinations) is none of their work.
  const showTeacherMenu =
    !isDivisionAdmin &&
    !isTutor &&
    !isSupportRole &&
    teacherMenuItems.length > 0;

  // Tutor Menu: tutors get only their own learners view.
  const tutorItems: ModuleItem[] = [
    {
      title: "My Learners",
      url: "/tutor",
      icon: GraduationCap,
      moduleName: "tutor_learners",
    },
    {
      title: "Attendance",
      url: "/tutor/attendance",
      icon: CalendarCheck,
      moduleName: "tutor_attendance",
    },
    {
      title: "Progress Tracker",
      url: "/tutor/progress",
      icon: TrendingUp,
      moduleName: "tutor_progress",
    },
  ];
  const showTutorMenu = hasTutorAccess;

  // Settings items - built based on access
  const settingItems: { title: string; url: string; icon: typeof User }[] = [];
  if (hasStaffAccess) {
    settingItems.push({ title: "Staff", url: "/staff", icon: User });
  }
  if (hasSchoolManagementAccess) {
    settingItems.push({ title: "Rooms", url: "/rooms", icon: Building2 });
  }
  if (hasStaffAccess) {
    settingItems.push({ title: "School Settings", url: "/settings", icon: Settings });
  }

  // School Form 10 (SF10) and DepEd School Forms (for school_head, admin, registrar)
  const form137Items: ModuleItem[] = [
    {
      title: "Requests",
      url: "/manage-requests",
      icon: FileText,
      moduleName: "form137",
      badge: pendingRequests,
    },
    {
      title: "DepEd School Forms",
      url: "/reports",
      icon: FileBarChart,
      moduleName: "deped_forms",
    },
    {
      title: "Division Submissions",
      url: "/reports/division-submission",
      icon: FileBarChart,
      moduleName: "division_submission",
    },
  ];
  // The SRC is a school head accountability document the four signatories
  // certify; a librarian has no reason to author one, and RLS (migration 112)
  // refuses their writes regardless.
  const canAuthorSrc = isSchoolHead || userType === "admin" || userType === "registrar";
  const form137MenuItems = hasSchoolManagementAccess
    ? [
        ...form137Items,
        ...(canAuthorSrc
          ? [
              {
                title: "School Report Card",
                url: "/reports/school-report-card",
                icon: FileBarChart,
                moduleName: "school_report_card",
              },
            ]
          : []),
      ]
    : [];

  // Division Office: base items for division staff; Schools/Users appended only for super admin
  const isSuperAdmin = userType === "super admin";
  const hasDivisionOfficeNav = isDivisionAdmin || isSuperAdmin;

  const divisionBaseItems: ModuleItem[] = [
    {
      title: "SDO Reports",
      url: "/division/reports",
      icon: FileBarChart,
      moduleName: "division_reports",
    },
    {
      title: "Assessments",
      url: "/division/assessments",
      icon: NotebookPen,
      moduleName: "division_assessments",
    },
    {
      // The access and efficiency KPIs are division-level statistics: their
      // denominators are PSA projections published per division.
      title: "KPI",
      url: "/school-reports/kpi",
      icon: Gauge,
      moduleName: "division_kpi",
    },
    {
      title: "Examinations",
      url: "/division/examinations",
      icon: FileSpreadsheet,
      moduleName: "division_examinations",
    },
    {
      title: "DepEd School Forms",
      url: "/reports",
      icon: FileBarChart,
      moduleName: "deped_forms",
    },
    {
      // Division-wide calendar entries (the DepEd holiday list) are entered
      // here once and inherited by every school; schools add their own local
      // ones from School Settings → School Calendar.
      title: "School Calendar",
      url: "/settings/calendar",
      icon: CalendarOff,
      moduleName: "division_calendar",
    },
  ];

  const divisionSuperAdminItems: ModuleItem[] = [
    {
      title: "Schools",
      url: "/division/schools",
      icon: Building2,
      moduleName: "division_schools",
    },
    {
      title: "Users",
      url: "/division/users",
      icon: Users,
      moduleName: "division_users",
    },
  ];

  const divisionOfficeMenuItems: ModuleItem[] = [
    ...divisionBaseItems,
    ...(isSuperAdmin ? divisionSuperAdminItems : []),
  ];

  // Returns true only if `url` is the most specific match for the current pathname
  // among the provided sibling URLs, preventing a parent from being active when a
  // more-specific sibling already matches.
  const getIsActive = (url: string, siblingUrls: string[]) => {
    if (pathname !== url && !pathname.startsWith(url + "/")) return false;
    return !siblingUrls.some(
      (sibling) =>
        sibling !== url &&
        sibling.length > url.length &&
        (pathname === sibling || pathname.startsWith(sibling + "/")),
    );
  };

  return (
    <Sidebar className="pt-13 border-r border-border/40">
      <SidebarContent className="bg-linear-to-b from-background via-background to-muted/20 backdrop-blur-sm">
        <SidebarGroup className="px-2 py-4">
          <SidebarGroupContent>
            <SidebarMenu className="space-y-1">
              {items.map((item) => {
                const isActive = pathname === item.url;
                const isLoading = loadingPath === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <Link
                        href={item.url}
                        onClick={() => handleLinkClick(item.url)}
                        className={cn(
                          "group relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ease-out",
                          "hover:bg-accent/50 hover:shadow-sm",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                          isLoading && "opacity-60 cursor-wait",
                          isActive
                            ? "bg-accent text-accent-foreground shadow-sm font-medium"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {/* Active indicator bar */}
                        {isActive && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                        )}

                        <div
                          className={cn(
                            "flex items-center justify-center transition-transform duration-200",
                            isActive && "scale-110",
                          )}
                        >
                          {isLoading ? (
                            <Loader2 className="h-4 w-4 text-primary animate-spin" />
                          ) : (
                            <item.icon
                              className={cn(
                                "h-4 w-4 transition-colors duration-200",
                                isActive
                                  ? "text-primary"
                                  : "text-muted-foreground group-hover:text-foreground",
                              )}
                            />
                          )}
                        </div>
                        <span
                          className={cn(
                            "text-sm transition-colors duration-200",
                            isActive && "font-semibold",
                          )}
                        >
                          {item.title}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Modules Section */}
        {moduleItems.length > 0 && (
          <SidebarGroup className="px-2 py-4">
            <SidebarGroupLabel className="px-3 mb-2 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
              Modules
            </SidebarGroupLabel>
            <SidebarGroupContent className="pb-0">
              <SidebarMenu className="space-y-1">
                {moduleItems.map((item) => {
                  const isActive = getIsActive(item.url, moduleItems.map((i) => i.url));
                  const isLoading = loadingPath === item.url;

                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild>
                        <Link
                          href={item.url}
                          onClick={() => handleLinkClick(item.url)}
                          className={cn(
                            "group relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ease-out",
                            "hover:bg-accent/50 hover:shadow-sm",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            isLoading && "opacity-60 cursor-wait",
                            isActive
                              ? "bg-accent text-accent-foreground shadow-sm font-medium"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {/* Active indicator bar */}
                          {isActive && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                          )}

                          <div
                            className={cn(
                              "flex items-center justify-center transition-transform duration-200",
                              isActive && "scale-110",
                            )}
                          >
                            {isLoading ? (
                              <Loader2 className="h-4 w-4 text-primary animate-spin" />
                            ) : (
                              <item.icon
                                className={cn(
                                  "h-4 w-4 transition-colors duration-200",
                                  isActive
                                    ? "text-primary"
                                    : "text-muted-foreground group-hover:text-foreground",
                                )}
                              />
                            )}
                          </div>
                          <span
                            className={cn(
                              "text-sm transition-colors duration-200",
                              isActive && "font-semibold",
                            )}
                          >
                            {item.title}
                          </span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Tutor Menu Section - For ARAL tutors only */}
        {showTutorMenu && (
          <SidebarGroup className="px-2 py-4">
            <SidebarGroupLabel className="px-3 mb-2 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
              Tutor Menu
            </SidebarGroupLabel>
            <SidebarGroupContent className="pb-0">
              <SidebarMenu className="space-y-1">
                {tutorItems.map((item) => {
                  const isActive = getIsActive(
                    item.url,
                    tutorItems.map((i) => i.url),
                  );
                  const isLoading = loadingPath === item.url;

                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild>
                        <Link
                          href={item.url}
                          onClick={() => handleLinkClick(item.url)}
                          className={cn(
                            "group relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ease-out",
                            "hover:bg-accent/50 hover:shadow-sm",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            isLoading && "opacity-60 cursor-wait",
                            isActive
                              ? "bg-accent text-accent-foreground shadow-sm font-medium"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {isActive && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                          )}

                          <div
                            className={cn(
                              "flex items-center justify-center transition-transform duration-200",
                              isActive && "scale-110",
                            )}
                          >
                            {isLoading ? (
                              <Loader2 className="h-4 w-4 text-primary animate-spin" />
                            ) : (
                              <item.icon
                                className={cn(
                                  "h-4 w-4 transition-colors duration-200",
                                  isActive
                                    ? "text-primary"
                                    : "text-muted-foreground group-hover:text-foreground",
                                )}
                              />
                            )}
                          </div>
                          <span
                            className={cn(
                              "text-sm transition-colors duration-200",
                              isActive && "font-semibold",
                            )}
                          >
                            {item.title}
                          </span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Teacher Menu Section - For all users except division_admin */}
        {showTeacherMenu && (
          <SidebarGroup className="px-2 py-4">
            <SidebarGroupLabel className="px-3 mb-2 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
              Teacher Menu
            </SidebarGroupLabel>
            <SidebarGroupContent className="pb-0">
              <SidebarMenu className="space-y-1">
                {teacherMenuItems.map((item) => {
                  const isActive = getIsActive(
                    item.url,
                    teacherMenuItems.map((i) => i.url),
                  );
                  const isLoading = loadingPath === item.url;

                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild>
                        <Link
                          href={item.url}
                          onClick={() => handleLinkClick(item.url)}
                          className={cn(
                            "group relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ease-out",
                            "hover:bg-accent/50 hover:shadow-sm",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            isLoading && "opacity-60 cursor-wait",
                            isActive
                              ? "bg-accent text-accent-foreground shadow-sm font-medium"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {/* Active indicator bar */}
                          {isActive && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                          )}

                          <div
                            className={cn(
                              "flex items-center justify-center transition-transform duration-200",
                              isActive && "scale-110",
                            )}
                          >
                            {isLoading ? (
                              <Loader2 className="h-4 w-4 text-primary animate-spin" />
                            ) : (
                              <item.icon
                                className={cn(
                                  "h-4 w-4 transition-colors duration-200",
                                  isActive
                                    ? "text-primary"
                                    : "text-muted-foreground group-hover:text-foreground",
                                )}
                              />
                            )}
                          </div>
                          <span
                            className={cn(
                              "text-sm transition-colors duration-200",
                              isActive && "font-semibold",
                            )}
                          >
                            {item.title}
                          </span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Division Office — Schools/Users only for super admin */}
        {hasDivisionOfficeNav && (
          <SidebarGroup className="px-2 py-4">
            <SidebarGroupLabel className="px-3 mb-2 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
              Division Office
            </SidebarGroupLabel>
            <SidebarGroupContent className="pb-0">
              <SidebarMenu className="space-y-1">
                {divisionOfficeMenuItems.map((item) => {
                  const isActive = getIsActive(
                    item.url,
                    divisionOfficeMenuItems.map((i) => i.url),
                  );
                  const isLoading = loadingPath === item.url;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild>
                        <Link
                          href={item.url}
                          onClick={() => handleLinkClick(item.url)}
                          className={cn(
                            "group relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ease-out",
                            "hover:bg-accent/50 hover:shadow-sm",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            isLoading && "opacity-60 cursor-wait",
                            isActive
                              ? "bg-accent text-accent-foreground shadow-sm font-medium"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {isActive && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                          )}
                          <div
                            className={cn(
                              "flex items-center justify-center transition-transform duration-200",
                              isActive && "scale-110",
                            )}
                          >
                            {isLoading ? (
                              <Loader2 className="h-4 w-4 text-primary animate-spin" />
                            ) : (
                              <item.icon
                                className={cn(
                                  "h-4 w-4 transition-colors duration-200",
                                  isActive
                                    ? "text-primary"
                                    : "text-muted-foreground group-hover:text-foreground",
                                )}
                              />
                            )}
                          </div>
                          <span
                            className={cn(
                              "text-sm transition-colors duration-200",
                              isActive && "font-semibold",
                            )}
                          >
                            {item.title}
                          </span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* School Form 10 (SF10) Section - For School Head */}
        {form137MenuItems.length > 0 && (
          <SidebarGroup className="px-2 py-4">
            <SidebarGroupLabel className="px-3 mb-2 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
              Records
            </SidebarGroupLabel>
            <SidebarGroupContent className="pb-0">
              <SidebarMenu className="space-y-1">
                {form137MenuItems.map((item) => {
                  const isActive = getIsActive(item.url, form137MenuItems.map((i) => i.url));
                  const isLoading = loadingPath === item.url;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild>
                        <Link
                          href={item.url}
                          onClick={() => handleLinkClick(item.url)}
                          className={cn(
                            "group relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ease-out",
                            "hover:bg-accent/50 hover:shadow-sm",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            isLoading && "opacity-60 cursor-wait",
                            isActive
                              ? "bg-accent text-accent-foreground shadow-sm font-medium"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {isActive && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                          )}
                          <div
                            className={cn(
                              "flex items-center justify-center transition-transform duration-200",
                              isActive && "scale-110",
                            )}
                          >
                            {isLoading ? (
                              <Loader2 className="h-4 w-4 text-primary animate-spin" />
                            ) : (
                              <item.icon
                                className={cn(
                                  "h-4 w-4 transition-colors duration-200",
                                  isActive
                                    ? "text-primary"
                                    : "text-muted-foreground group-hover:text-foreground",
                                )}
                              />
                            )}
                          </div>
                          <span
                            className={cn(
                              "text-sm transition-colors duration-200",
                              isActive && "font-semibold",
                            )}
                          >
                            {item.title}
                          </span>
                          {!!item.badge && (
                            <Badge
                              variant="destructive"
                              className="ml-auto h-5 min-w-5 justify-center px-1.5 text-[10px]"
                            >
                              {item.badge > 99 ? "99+" : item.badge}
                            </Badge>
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Settings Section - Staff for admin/school_head; Rooms for admin/registrar/school_head */}
        {settingItems.length > 0 && (
          <SidebarGroup className="px-2 py-4">
            <SidebarGroupLabel className="px-3 mb-2 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
              Settings
            </SidebarGroupLabel>
            <SidebarGroupContent className="pb-0">
              <SidebarMenu className="space-y-1">
                {settingItems.map((item) => {
                  const isActive = pathname === item.url;
                  const isLoading = loadingPath === item.url;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild>
                        <Link
                          href={item.url}
                          onClick={() => handleLinkClick(item.url)}
                          className={cn(
                            "group relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ease-out",
                            "hover:bg-accent/50 hover:shadow-sm",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            isLoading && "opacity-60 cursor-wait",
                            isActive
                              ? "bg-accent text-accent-foreground shadow-sm font-medium"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {/* Active indicator bar */}
                          {isActive && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                          )}

                          <div
                            className={cn(
                              "flex items-center justify-center transition-transform duration-200",
                              isActive && "scale-110",
                            )}
                          >
                            {isLoading ? (
                              <Loader2 className="h-4 w-4 text-primary animate-spin" />
                            ) : (
                              <item.icon
                                className={cn(
                                  "h-4 w-4 transition-colors duration-200",
                                  isActive
                                    ? "text-primary"
                                    : "text-muted-foreground group-hover:text-foreground",
                                )}
                              />
                            )}
                          </div>
                          <span
                            className={cn(
                              "text-sm transition-colors duration-200",
                              isActive && "font-semibold",
                            )}
                          >
                            {item.title}
                          </span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
