"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { APP_NAME, ORG_NAME } from "@/lib/constants/branding";
import {
  Building2,
  ChevronDown,
  GraduationCap,
  Home,
  List,
  UserCircle,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

function getDefaultSchoolYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const startYear = month >= 6 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

export function LandingNav() {
  const pathname = usePathname();
  const schoolYear = getDefaultSchoolYear();

  // Active state is a rule under the item, not a filled pill — it reads as a
  // tab in a register rather than a button.
  const navLink = (active: boolean) =>
    `font-ui relative inline-flex items-center gap-1.5 h-16 px-3 text-[13px] font-medium tracking-tight transition-colors ${
      active
        ? "text-[var(--ink)]"
        : "text-[var(--ink-3)] hover:text-[var(--ink)]"
    } after:absolute after:inset-x-3 after:bottom-0 after:h-px after:transition-transform after:duration-300 after:origin-left ${
      active
        ? "after:bg-[var(--brass)] after:scale-x-100"
        : "after:bg-[var(--ink-3)]/40 after:scale-x-0 hover:after:scale-x-100"
    }`;

  return (
    <header className="fixed top-0 z-40 w-full border-b border-[var(--rule)] bg-[var(--paper)]/92 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <nav className="flex h-16 items-center justify-between gap-4">
          {/* Wordmark */}
          <Link href="/" className="group flex shrink-0 items-center gap-3">
            <div className="relative h-9 w-9 shrink-0 rounded-sm border border-[var(--rule)] bg-[var(--paper-raised)] p-1 transition-colors group-hover:border-[var(--brass)]/50">
              <Image
                src="/deped-logo.svg"
                alt=""
                fill
                className="object-contain p-0.5"
                priority
              />
            </div>
            <div className="hidden sm:block">
              <p className="font-ui text-[13px] font-semibold leading-tight tracking-tight text-[var(--ink)]">
                {APP_NAME}
              </p>
              <p className="label-data mt-0.5 text-[10px] leading-none text-[var(--ink-3)]">
                {ORG_NAME}
              </p>
            </div>
          </Link>

          {/* Sections */}
          <div className="flex items-center gap-1">
            <Link href="/" className={navLink(pathname === "/")}>
              <Home className="h-4 w-4 sm:mr-0.5" strokeWidth={1.75} />
              <span className="hidden sm:inline">Home</span>
            </Link>

            <DropdownMenu>
              <DropdownMenuTrigger
                className={`${navLink(
                  pathname?.startsWith("/schools") ||
                    pathname?.startsWith("/learners") ||
                    false,
                )} outline-none`}
              >
                <Building2 className="h-4 w-4 sm:mr-0.5" strokeWidth={1.75} />
                <span className="hidden sm:inline">Schools</span>
                <ChevronDown className="ml-0.5 h-3 w-3 opacity-50" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-52 rounded-sm border-[var(--rule)] bg-[var(--paper-raised)] p-1 shadow-lg shadow-[var(--ink)]/5"
              >
                <DropdownMenuItem asChild>
                  <Link
                    href="/schools"
                    className="font-ui flex cursor-pointer items-center gap-2.5 rounded-sm text-[13px] text-[var(--ink-2)] focus:bg-[var(--paper)] focus:text-[var(--ink)]"
                  >
                    <List className="h-4 w-4 text-[var(--ink-3)]" strokeWidth={1.75} />
                    School Directory
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link
                    href="/learners"
                    className="font-ui flex cursor-pointer items-center gap-2.5 rounded-sm text-[13px] text-[var(--ink-2)] focus:bg-[var(--paper)] focus:text-[var(--ink)]"
                  >
                    <GraduationCap
                      className="h-4 w-4 text-[var(--ink-3)]"
                      strokeWidth={1.75}
                    />
                    Learners by School
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Link
              href="/student-portal"
              className={navLink(
                pathname?.startsWith("/student-portal") || false,
              )}
            >
              <UserCircle className="h-4 w-4 sm:mr-0.5" strokeWidth={1.75} />
              <span className="hidden sm:inline">Student Portal</span>
            </Link>
          </div>

          {/* Right rail */}
          <div className="flex items-center gap-4">
            <span className="label-data hidden text-[10px] text-[var(--ink-3)] md:inline">
              SY {schoolYear}
            </span>
            <Link
              href="/login"
              className="font-ui inline-flex h-9 items-center rounded-sm bg-[var(--ink)] px-4 text-[13px] font-medium text-[var(--paper)] transition-colors hover:bg-[var(--ink-2)]"
            >
              Staff Sign In
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
