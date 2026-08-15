"use client";

import { LrnBoxInput } from "@/components/LrnBoxInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ORG_NAME } from "@/lib/constants/branding";
import { useStudentSession } from "@/lib/student-portal/context";
import { verifyStudent } from "@/lib/student-portal/actions";
import { GraduationCap, Loader2, UserCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";

export default function StudentPortalLoginPage() {
  const [lrn, setLrn] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const { refresh } = useStudentSession();
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const lrnDigits = lrn.replace(/\D/g, "");
    if (!lrnDigits) {
      toast.error("LRN is required");
      return;
    }
    if (lrnDigits.length !== 12) {
      toast.error("LRN must be 12 digits");
      return;
    }
    if (!code.trim()) {
      toast.error("Code is required");
      return;
    }

    setLoading(true);
    try {
      const result = await verifyStudent(lrnDigits, code.trim());
      if (result.error) {
        toast.error(result.error);
      } else if (result.success) {
        await refresh();
        router.push("/student-portal/dashboard");
      }
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="paper-ground paper-grain font-ui relative min-h-screen text-[var(--ink-2)]">
      {/* Masthead */}
      <header className="border-b border-[var(--rule)]">
        <div className="mx-auto max-w-7xl px-4 pb-14 pt-28 sm:px-6 sm:pb-20 sm:pt-36 lg:px-8">
          <div className="max-w-2xl animate-fade-up">
            <p className="label-data flex items-center gap-3 text-[var(--brass)]">
              <UserCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
              {ORG_NAME}
            </p>
            <h1 className="font-display mt-4 text-4xl leading-[1.05] tracking-tight text-[var(--ink)] sm:text-6xl">
              Student Portal
            </h1>
            <div className="mt-7 h-px w-24 bg-[var(--ink)]/25" />
            <p className="mt-7 max-w-xl text-[15px] leading-relaxed text-[var(--ink-2)]">
              Sign in with your Learner Reference Number and the code from your
              section adviser to view your academic records and grades.
            </p>
          </div>
        </div>
      </header>

      {/* Form */}
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
        <div
          className="mx-auto max-w-2xl border-t-2 border-[var(--ink)] bg-[var(--paper-raised)] shadow-sm shadow-[var(--ink)]/5 animate-fade-up"
          style={{ animationDelay: "0.12s" }}
        >
          <div className="flex items-center gap-3 border-b border-[var(--rule)] px-6 py-5 sm:px-9">
            <GraduationCap
              className="h-5 w-5 text-[var(--brass)]"
              strokeWidth={1.75}
            />
            <div>
              <p className="label-data text-[var(--ink-3)]">Learner sign in</p>
              <h2 className="font-display mt-1 text-xl leading-tight text-[var(--ink)]">
                Enter your LRN and code
              </h2>
            </div>
          </div>

          <div className="px-6 py-8 sm:px-9">

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label
                  htmlFor="lrn"
                  className="label-data mb-2.5 block text-[var(--ink-3)]"
                >
                  Learner Reference Number
                </label>
                <LrnBoxInput
                  id="lrn"
                  variant="light"
                  singleLine
                  value={lrn}
                  onChange={setLrn}
                  disabled={loading}
                />
                <p className="mt-2.5 text-[12px] text-[var(--ink-3)]">
                  All 12 digits, in 4-4-4 format.
                </p>
              </div>
              <div>
                <label
                  htmlFor="code"
                  className="label-data mb-2.5 block text-[var(--ink-3)]"
                >
                  Code
                </label>
                <Input
                  id="code"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Code from your section adviser"
                  className="font-data h-11 rounded-sm border-[var(--rule)] bg-[var(--paper)] text-[var(--ink)] placeholder:text-[var(--ink-3)]/70 focus-visible:border-[var(--ink)] focus-visible:ring-0"
                  disabled={loading}
                  autoComplete="off"
                  autoCapitalize="characters"
                />
                <p className="mt-2.5 text-[12px] text-[var(--ink-3)]">
                  Your section adviser provides this code.
                </p>
              </div>
              <Button
                type="submit"
                className="h-11 w-full rounded-sm bg-[var(--ink)] text-[14px] font-medium tracking-tight text-[var(--paper)] hover:bg-[var(--ink-2)]"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
          </div>

          <div className="border-t border-[var(--rule)] bg-[var(--paper)]/60 px-6 py-3.5 sm:px-9">
            <Link
              href="/"
              className="text-[12px] text-[var(--ink-3)] transition-colors hover:text-[var(--ink)]"
            >
              ← Back to home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
