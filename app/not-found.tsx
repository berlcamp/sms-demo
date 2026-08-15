import { PublicPageBackground } from "@/components/PublicPageBackground";
import { ORG_FOOTER } from "@/lib/constants/branding";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  const destinations = [
    { href: "/", no: "01", label: "Division home", desc: "Enrollment overview and public services" },
    { href: "/schools", no: "02", label: "School directory", desc: "Every public school in the division" },
    { href: "/student-portal", no: "03", label: "Student portal", desc: "Learners sign in with their LRN" },
    { href: "/login", no: "04", label: "Staff sign in", desc: "For division and school personnel" },
  ];

  return (
    <main className="font-ui relative flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <PublicPageBackground />

      <div className="relative z-10 w-full max-w-xl animate-fade-up">
        <p className="label-data flex items-center gap-3 text-[var(--brass)]">
          <span className="h-px w-8 bg-[var(--brass)]/50" />
          Error 404
        </p>

        <h1 className="font-display mt-5 text-4xl leading-[1.05] tracking-tight text-[var(--ink)] sm:text-5xl">
          This page isn&apos;t
          <br />
          <span className="italic text-[var(--brass)]">on record</span>
        </h1>

        <div className="mt-7 h-px w-24 bg-[var(--ink)]/25" />

        <p className="mt-7 max-w-md text-[15px] leading-relaxed text-[var(--ink-2)]">
          The address may be wrong, the page may have moved, or you may not have
          access to it. Pick a known area of the site below.
        </p>

        <nav className="mt-10 border-t border-[var(--rule)]">
          {destinations.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              className="group grid grid-cols-12 items-baseline gap-x-4 border-b border-[var(--rule)] py-4 transition-colors hover:bg-[var(--paper-raised)]/70"
            >
              <span className="font-data col-span-2 text-[11px] text-[var(--ink-3)] sm:col-span-1">
                {d.no}
              </span>
              <span className="font-display col-span-10 text-base leading-tight text-[var(--ink)] transition-colors group-hover:text-[var(--brass)] sm:col-span-4">
                {d.label}
              </span>
              <span className="col-span-10 col-start-3 text-[13px] leading-relaxed text-[var(--ink-3)] sm:col-span-6 sm:col-start-6">
                {d.desc}
              </span>
              <span className="col-span-1 hidden justify-end sm:flex">
                <ArrowRight
                  className="h-4 w-4 text-[var(--ink-3)] transition-all duration-300 group-hover:translate-x-1 group-hover:text-[var(--brass)]"
                  strokeWidth={1.75}
                />
              </span>
            </Link>
          ))}
        </nav>

        <p className="label-data mt-8 text-[10px] text-[var(--ink-3)]">
          {ORG_FOOTER}
        </p>
      </div>
    </main>
  );
}
