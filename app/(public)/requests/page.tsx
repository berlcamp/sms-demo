"use client";

import { ORG_NAME } from "@/lib/constants/branding";
import { FileText, ScrollText, Search } from "lucide-react";
import { useState } from "react";
import { SubmitRequestForm } from "./components/SubmitRequestForm";
import { TrackingLookup } from "./components/TrackingLookup";

type Tab = "submit" | "track";

export default function RequestsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("submit");

  // Tabs read as register tabs: a rule under the active one, no filled pill.
  const tabClass = (active: boolean) =>
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
    <div className="paper-ground paper-grain font-ui relative min-h-screen text-[var(--ink-2)]">
      {/* Masthead */}
      <header className="border-b border-[var(--rule)]">
        <div className="mx-auto max-w-7xl px-4 pb-0 pt-28 sm:px-6 sm:pt-36 lg:px-8">
          <div className="flex flex-col gap-8 animate-fade-up sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="label-data flex items-center gap-3 text-[var(--brass)]">
                <ScrollText className="h-3.5 w-3.5" strokeWidth={1.75} />
                {ORG_NAME}
              </p>
              <h1 className="font-display mt-4 text-4xl leading-[1.05] tracking-tight text-[var(--ink)] sm:text-5xl">
                Document Requests
              </h1>
              <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-[var(--ink-2)]">
                Request an official school record, or check where an existing
                request has got to.
              </p>
            </div>

            <div className="flex items-center gap-7">
              <button
                type="button"
                onClick={() => setActiveTab("submit")}
                className={tabClass(activeTab === "submit")}
              >
                <FileText className="h-4 w-4" strokeWidth={1.75} />
                Submit Request
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("track")}
                className={tabClass(activeTab === "track")}
              >
                <Search className="h-4 w-4" strokeWidth={1.75} />
                Track Request
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div
          className="mb-8 border-b border-[var(--rule)] pb-5 animate-fade-up"
          style={{ animationDelay: "0.08s" }}
        >
          <p className="label-data text-[var(--ink-3)]">
            {activeTab === "submit" ? "New request" : "Existing request"}
          </p>
          <h2 className="font-display mt-2 text-2xl leading-tight text-[var(--ink)]">
            {activeTab === "submit" ? "Submit a request" : "Track a request"}
          </h2>
          <p className="mt-2 text-[14px] text-[var(--ink-3)]">
            {activeTab === "submit"
              ? "Fill in the form below to request your school documents."
              : "Enter your tracking number to check the status of your request."}
          </p>
        </div>

        <div
          className="border-t-2 border-[var(--ink)] bg-[var(--paper-raised)] p-6 shadow-sm shadow-[var(--ink)]/5 animate-fade-up sm:p-9"
          style={{ animationDelay: "0.15s" }}
        >
          {activeTab === "submit" ? <SubmitRequestForm /> : <TrackingLookup />}
        </div>
      </div>
    </div>
  );
}
