"use client";

import { ModuleAccessDenied } from "@/components/ModuleAccessDenied";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { useAppSelector } from "@/lib/redux/hook";
import { supabase } from "@/lib/supabase/client";
import { generateNsbi } from "@/lib/pdf/generateNsbi";
import {
  formatNsbiAsOf,
  nsbiDefaultAsOfDate,
  nsbiDefaultSignatories,
  nsbiFurnitureFromKpi,
  nsbiSchoolYearForAsOf,
  nsbiWarnings,
} from "@/lib/utils/nsbi";
import type {
  KpiReference,
  NsbiBuilding,
  NsbiCopyResult,
  NsbiRoom,
  NsbiStatus,
  NsbiSubmission,
} from "@/types";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  CopyPlus,
  DoorOpen,
  Plus,
  Printer,
  Save,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  BuildingDraft,
  blankBuilding,
  blankRoom,
  buildingToDraft,
  buildingToRow,
  HeaderDraft,
  headerToDraft,
  headerToRow,
  RoomDraft,
  roomToDraft,
  roomToRow,
} from "./components/drafts";
import {
  NsbiAccessTab,
  NsbiAmenitiesTab,
  NsbiFurnitureTab,
  NsbiSignatoriesTab,
  NsbiStandaloneWashTab,
  NsbiTemporaryTab,
} from "./components/NsbiSimpleTabs";
import { NsbiBuildingCard } from "./components/NsbiBuildingCard";
import {
  NSBI_ROOM_DIMENSION_NOTE,
  NsbiRoomRows,
} from "./components/NsbiRoomRows";

/**
 * National School Building Inventory (migration 154).
 *
 * A snapshot the school head encodes and prints — never a live read. Unlike the
 * School Report Card, this page does NOT auto-create a draft on load: the SRC is
 * one per school year and can be created blind, while an NSBI is keyed on an
 * arbitrary as-of date roughly two years apart, so auto-inserting would litter
 * the table with empty returns nobody asked for. The school head names the date.
 */

/** Roles that may author a return. RLS (154) refuses everyone else regardless. */
const AUTHOR_TYPES = [
  "school_head",
  "assistant_school_head",
  "admin",
  "registrar",
  "super admin",
  "division_admin",
  "division_type",
];

interface SubmissionOption {
  id: string;
  as_of_date: string;
  status: NsbiStatus;
}

export default function Page() {
  const user = useAppSelector((state) => state.user.user);
  const canAuthor = !!user?.type && AUTHOR_TYPES.includes(user.type);
  const schoolId = user?.school_id ? Number(user.school_id) : null;

  const { settings } = useSchoolSettings(!!schoolId, user?.school_id);

  const [options, setOptions] = useState<SubmissionOption[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [submission, setSubmission] = useState<NsbiSubmission | null>(null);
  const [header, setHeader] = useState<HeaderDraft | null>(null);
  const [buildings, setBuildings] = useState<BuildingDraft[]>([]);
  const [rooms, setRooms] = useState<RoomDraft[]>([]);
  const [removedBuildingIds, setRemovedBuildingIds] = useState<string[]>([]);
  const [removedRoomIds, setRemovedRoomIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [kpiPrefilling, setKpiPrefilling] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newDate, setNewDate] = useState(() => nsbiDefaultAsOfDate(new Date()));
  const [copyFrom, setCopyFrom] = useState<string>("");

  const isLocked = submission?.status === "locked";
  const readOnly = isLocked || !canAuthor;

  // ---- list of this school's inventories -------------------------------
  const loadOptions = useCallback(async () => {
    if (!schoolId) return;
    const { data, error } = await supabase
      .from("sms_nsbi_submissions")
      .select("id, as_of_date, status")
      .eq("school_id", schoolId)
      .order("as_of_date", { ascending: false });
    if (error) {
      toast.error(error.message);
      return;
    }
    const list = (data ?? []) as SubmissionOption[];
    setOptions(list);
    setActiveId((prev) => prev ?? (list.length > 0 ? String(list[0].id) : null));
  }, [schoolId]);

  useEffect(() => {
    loadOptions().finally(() => setLoading(false));
  }, [loadOptions]);

  // ---- the active inventory --------------------------------------------
  const loadInventory = useCallback(async () => {
    if (!activeId) {
      setSubmission(null);
      setHeader(null);
      setBuildings([]);
      setRooms([]);
      return;
    }
    setLoading(true);
    try {
      const { data: headerRow, error: hErr } = await supabase
        .from("sms_nsbi_submissions")
        .select("*")
        .eq("id", Number(activeId))
        .single();
      if (hErr) throw hErr;

      const { data: bRows, error: bErr } = await supabase
        .from("sms_nsbi_buildings")
        .select("*")
        .eq("submission_id", Number(activeId))
        .order("sort_order");
      if (bErr) throw bErr;

      const { data: rRows, error: rErr } = await supabase
        .from("sms_nsbi_rooms")
        .select("*")
        .eq("submission_id", Number(activeId))
        .order("sort_order");
      if (rErr) throw rErr;

      const bDrafts = ((bRows ?? []) as NsbiBuilding[]).map(buildingToDraft);
      // The room's building_id is a database id; drafts are linked by client
      // key so a not-yet-inserted building can still own rooms.
      const keyByDbId = new Map(
        bDrafts.filter((b) => b.id).map((b) => [b.id as string, b.key]),
      );
      const rDrafts = ((rRows ?? []) as NsbiRoom[])
        .map((r) => {
          const key = keyByDbId.get(r.building_id);
          return key ? roomToDraft(r, key) : null;
        })
        .filter((r): r is RoomDraft => r !== null);

      const row = headerRow as NsbiSubmission;
      setSubmission(row);
      // Signatories may be absent on a return created before the school head
      // was configured; fall back to the four blank roles so the tab renders.
      setHeader({
        ...headerToDraft(row),
        signatories:
          row.signatories && row.signatories.length > 0
            ? row.signatories
            : nsbiDefaultSignatories(
                settings.principal_name,
                settings.principal_title,
              ),
      });
      setBuildings(bDrafts);
      setRooms(rDrafts);
      setRemovedBuildingIds([]);
      setRemovedRoomIds([]);
      setExpanded(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [activeId, settings.principal_name, settings.principal_title]);

  useEffect(() => {
    loadInventory();
  }, [loadInventory]);

  // ---- create ------------------------------------------------------------
  const handleCreate = async () => {
    if (!schoolId) return;
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("sms_nsbi_submissions")
        .insert({
          school_id: schoolId,
          as_of_date: newDate,
          status: "draft",
          signatories: nsbiDefaultSignatories(
            settings.principal_name,
            settings.principal_title,
          ),
        })
        .select("id, as_of_date, status")
        .single();
      if (error) throw error;
      toast.success(`Inventory as of ${formatNsbiAsOf(newDate)} created.`);
      setNewOpen(false);
      await loadOptions();
      setActiveId(String(data.id));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not create the inventory",
      );
    } finally {
      setBusy(false);
    }
  };

  // ---- prefill and copy --------------------------------------------------
  const handlePrefill = async () => {
    if (!activeId) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("nsbi_prefill_rooms", {
        p_submission_id: Number(activeId),
      });
      if (error) throw error;
      const result = data as NsbiCopyResult;
      toast.success(
        `Prefilled ${result.buildings_added} building(s) and ${result.rooms_added} room(s). Review before submitting.`,
      );
      await loadInventory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Prefill failed");
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!activeId || !copyFrom) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("nsbi_copy_from_previous", {
        p_submission_id: Number(activeId),
        p_from_submission_id: Number(copyFrom),
      });
      if (error) throw error;
      const result = data as NsbiCopyResult;
      toast.success(
        `Copied ${result.buildings_added} building(s) and ${result.rooms_added} room(s).`,
      );
      setCopyFrom("");
      await loadInventory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Copy failed");
    } finally {
      setBusy(false);
    }
  };

  // ---- edit helpers ------------------------------------------------------
  const patchBuilding = (key: string, patch: Partial<BuildingDraft>) =>
    setBuildings((prev) =>
      prev.map((b) => (b.key === key ? { ...b, ...patch } : b)),
    );

  const addBuilding = () => {
    const draft = blankBuilding(buildings.length + 1);
    setBuildings((prev) => [...prev, draft]);
    setExpanded((prev) => new Set(prev).add(draft.key));
  };

  const removeBuilding = (key: string) => {
    const target = buildings.find((b) => b.key === key);
    if (!target) return;
    if (target.id) setRemovedBuildingIds((prev) => [...prev, target.id!]);
    // The database cascades, but the removed rooms must also leave local state
    // or they would be re-inserted under a building that no longer exists.
    setRooms((prev) => prev.filter((r) => r.buildingKey !== key));
    setBuildings((prev) => prev.filter((b) => b.key !== key));
  };

  const patchRoom = (key: string, patch: Partial<RoomDraft>) =>
    setRooms((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addRoom = (buildingKey: string) => {
    const count = rooms.filter((r) => r.buildingKey === buildingKey).length;
    setRooms((prev) => [...prev, blankRoom(buildingKey, count + 1)]);
  };

  const removeRoom = (key: string) => {
    const target = rooms.find((r) => r.key === key);
    if (!target) return;
    if (target.id) setRemovedRoomIds((prev) => [...prev, target.id!]);
    setRooms((prev) => prev.filter((r) => r.key !== key));
  };

  // ---- save --------------------------------------------------------------
  const handleSave = async (nextStatus: NsbiStatus = "draft") => {
    if (!submission || !header) return;
    const unnamed = buildings.find((b) => !b.building_name.trim());
    if (unnamed) {
      toast.error("Every building needs a name or number (Col. 1).");
      return;
    }
    setSaving(true);
    try {
      // The header carries Tables 3, 4B, 5, 6, 7 and the signatories.
      const headerPatch: Record<string, unknown> = {
        ...headerToRow(header),
        status: nextStatus,
      };
      if (nextStatus === "submitted") {
        headerPatch.submitted_at = new Date().toISOString();
        if (user?.system_user_id != null) {
          headerPatch.submitted_by_user_id = user.system_user_id;
        }
      }
      const { error: hErr } = await supabase
        .from("sms_nsbi_submissions")
        .update(headerPatch)
        .eq("id", Number(submission.id));
      if (hErr) throw hErr;

      // Deletions first, so a building removed and re-added under the same name
      // cannot collide with the row it replaced.
      if (removedRoomIds.length > 0) {
        const { error } = await supabase
          .from("sms_nsbi_rooms")
          .delete()
          .in("id", removedRoomIds.map(Number));
        if (error) throw error;
      }
      if (removedBuildingIds.length > 0) {
        const { error } = await supabase
          .from("sms_nsbi_buildings")
          .delete()
          .in("id", removedBuildingIds.map(Number));
        if (error) throw error;
      }

      // Buildings. Rows that already exist go in ONE upsert; only a brand-new
      // building needs its own round trip, because its generated id is what the
      // rooms below are attached to. A school re-filing an inventory of eighty
      // rooms therefore costs a handful of requests, not eighty.
      const idByKey = new Map<string, string>();

      const existingBuildings = buildings
        .map((draft, i) => ({ draft, sort: i + 1 }))
        .filter((x) => x.draft.id);
      if (existingBuildings.length > 0) {
        const payload = existingBuildings.map(({ draft, sort }) => ({
          id: Number(draft.id),
          ...buildingToRow({ ...draft, sort_order: sort }, submission.id),
        }));
        const { error } = await supabase
          .from("sms_nsbi_buildings")
          .upsert(payload);
        if (error) throw error;
        for (const { draft } of existingBuildings) {
          idByKey.set(draft.key, draft.id as string);
        }
      }

      for (const [i, draft] of buildings.entries()) {
        if (draft.id) continue;
        const { data, error } = await supabase
          .from("sms_nsbi_buildings")
          .insert(buildingToRow({ ...draft, sort_order: i + 1 }, submission.id))
          .select("id")
          .single();
        if (error) throw error;
        idByKey.set(draft.key, String(data.id));
      }

      // Rooms. Every building id is known by now, so both halves are bulk.
      const orderByBuilding = new Map<string, number>();
      const roomPayloads = rooms
        .map((draft) => {
          const buildingId = idByKey.get(draft.buildingKey);
          if (!buildingId) return null;
          const next = (orderByBuilding.get(draft.buildingKey) ?? 0) + 1;
          orderByBuilding.set(draft.buildingKey, next);
          return {
            draft,
            row: roomToRow({ ...draft, sort_order: next }, submission.id, buildingId),
          };
        })
        .filter((x): x is { draft: RoomDraft; row: Record<string, unknown> } =>
          x !== null,
        );

      const updatedRooms = roomPayloads.filter((x) => x.draft.id);
      if (updatedRooms.length > 0) {
        const { error } = await supabase
          .from("sms_nsbi_rooms")
          .upsert(
            updatedRooms.map((x) => ({ id: Number(x.draft.id), ...x.row })),
          );
        if (error) throw error;
      }

      const insertedRooms = roomPayloads.filter((x) => !x.draft.id);
      if (insertedRooms.length > 0) {
        const { error } = await supabase
          .from("sms_nsbi_rooms")
          .insert(insertedRooms.map((x) => x.row));
        if (error) throw error;
      }

      toast.success(
        nextStatus === "submitted"
          ? "Inventory submitted."
          : "Draft saved.",
      );
      await loadOptions();
      await loadInventory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = async () => {
    if (!submission) return;
    setPrinting(true);
    try {
      // Prints from what is STORED, never from unsaved screen state — the
      // document must be the return as filed.
      await generateNsbi(submission.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Print failed");
    } finally {
      setPrinting(false);
    }
  };

  const patchHeader = (patch: Partial<HeaderDraft>) =>
    setHeader((prev) => (prev ? { ...prev, ...patch } : prev));

  /**
   * Table 5 from 118's seat inventory. Reads the school's OWN reference row for
   * the school year the inventory date falls in — never the division-wide row
   * (NULL school_id), which counts the whole division and would be nonsense on
   * one school's return. Fills blanks only; see nsbiFurnitureFromKpi.
   */
  const handleKpiPrefill = async () => {
    if (!submission || !header || !schoolId) return;
    const schoolYear = nsbiSchoolYearForAsOf(submission.as_of_date);
    setKpiPrefilling(true);
    try {
      const { data, error } = await supabase
        .from("sms_kpi_reference")
        .select("seats_kindergarten, seats_arm_chairs, seats_school_desks")
        .eq("school_id", schoolId)
        .eq("school_year", schoolYear)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        toast.error(
          `No KPI seat inventory recorded for ${schoolYear}. Enter it under Reports → KPI first, or type the counts here.`,
        );
        return;
      }

      const result = nsbiFurnitureFromKpi(
        data as Pick<
          KpiReference,
          "seats_kindergarten" | "seats_arm_chairs" | "seats_school_desks"
        >,
        header.furniture,
      );
      patchHeader({ furniture: result.furniture });

      if (result.filled.length === 0) {
        toast(
          result.kept.length > 0
            ? "Nothing to fill — those columns are already counted."
            : `The ${schoolYear} KPI row has no seat figures recorded.`,
        );
        return;
      }
      const kept =
        result.kept.length > 0
          ? ` Left ${result.kept.join(", ")} as counted.`
          : "";
      toast.success(
        `Filled ${result.filled.join(", ")} from the ${schoolYear} KPI inventory.${kept} Save to keep.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read the KPI inventory");
    } finally {
      setKpiPrefilling(false);
    }
  };

  const roomsByBuilding = useMemo(() => {
    const map = new Map<string, RoomDraft[]>();
    for (const b of buildings) map.set(b.key, []);
    for (const r of rooms) map.get(r.buildingKey)?.push(r);
    return map;
  }, [buildings, rooms]);

  // Warnings, never blocks — the return is reconciled after a physical walk
  // through the campus, so a discrepancy is information, not an error.
  const warnings = useMemo(() => {
    if (!submission || !header) return [];
    return nsbiWarnings(
      { ...submission, ...(headerToRow(header) as Partial<NsbiSubmission>) } as NsbiSubmission,
      buildings.map((b) => ({
        id: b.id ?? b.key,
        building_name: b.building_name,
        room_count: b.room_count.trim() === "" ? null : Number(b.room_count),
        condition: b.condition || null,
        pwd_accessible: b.pwd_accessible,
        bowls_pwd: b.bowls_pwd.trim() === "" ? null : Number(b.bowls_pwd),
      })) as unknown as NsbiBuilding[],
      rooms.map((r) => ({
        building_id: buildings.find((b) => b.key === r.buildingKey)?.id ?? r.buildingKey,
        room_number: r.room_number || null,
        actual_usages: r.actual_usages,
      })) as unknown as NsbiRoom[],
    );
  }, [submission, header, buildings, rooms]);

  const copyCandidates = options.filter((o) => String(o.id) !== activeId);
  const canCopy = buildings.length === 0 && copyCandidates.length > 0;

  if (!canAuthor) return <ModuleAccessDenied />;

  if (!schoolId) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>School Building Inventory</CardTitle>
            <CardDescription>
              This return is filed by a school. Select a school first.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">School Building Inventory</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            The DepEd physical-plant census, filed roughly every two years and
            signed by four officers. Figures are saved as a snapshot — once
            submitted, later changes in the Rooms module will not alter what was
            signed.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="inventory">Inventory</Label>
            <Select
              value={activeId ?? ""}
              onValueChange={setActiveId}
              disabled={options.length === 0}
            >
              <SelectTrigger id="inventory" className="w-56">
                <SelectValue placeholder="No inventory yet" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.id} value={String(o.id)}>
                    As of {formatNsbiAsOf(o.as_of_date)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {submission ? (
            <Badge
              variant={
                submission.status === "draft"
                  ? "outline"
                  : submission.status === "submitted"
                    ? "default"
                    : "secondary"
              }
            >
              {submission.status === "draft"
                ? "Draft"
                : submission.status === "submitted"
                  ? "Submitted"
                  : "Locked"}
            </Badge>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => setNewOpen(true)}
            disabled={busy}
          >
            <Plus className="mr-2 h-4 w-4" />
            New inventory
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : !submission ? (
        <Card>
          <CardHeader>
            <CardTitle>No inventory yet</CardTitle>
            <CardDescription>
              Start one and name the date it is taken as of — the DepEd form is
              headed &ldquo;as of May 31&rdquo; of the inventory year.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" onClick={() => setNewOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Start an inventory
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePrefill}
              disabled={readOnly || busy}
            >
              <Wand2 className="mr-2 h-4 w-4" />
              Prefill rooms from the Rooms module
            </Button>
            <span className="text-xs text-muted-foreground">
              Copies room number, condition and size once. Editing a room later
              never changes this return.
            </span>

            {canCopy ? (
              <div className="ml-auto flex items-center gap-2">
                <Select value={copyFrom} onValueChange={setCopyFrom}>
                  <SelectTrigger className="h-8 w-48">
                    <SelectValue placeholder="Copy from…" />
                  </SelectTrigger>
                  <SelectContent>
                    {copyCandidates.map((o) => (
                      <SelectItem key={o.id} value={String(o.id)}>
                        As of {formatNsbiAsOf(o.as_of_date)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  disabled={!copyFrom || readOnly || busy}
                >
                  <CopyPlus className="mr-2 h-4 w-4" />
                  Copy
                </Button>
              </div>
            ) : null}
          </div>

          <Tabs defaultValue="buildings">
            <TabsList>
              <TabsTrigger value="buildings">
                <Building2 className="mr-2 h-4 w-4" />
                Buildings · Tables 1 &amp; 4A
              </TabsTrigger>
              <TabsTrigger value="rooms">
                <DoorOpen className="mr-2 h-4 w-4" />
                Rooms · Table 2
              </TabsTrigger>
              <TabsTrigger value="temporary">TLS · Table 3</TabsTrigger>
              <TabsTrigger value="standalone">Stand-alone · Table 4B</TabsTrigger>
              <TabsTrigger value="furniture">Furniture · Table 5</TabsTrigger>
              <TabsTrigger value="amenities">Amenities · Table 6</TabsTrigger>
              <TabsTrigger value="access">Access · Table 7</TabsTrigger>
              <TabsTrigger value="signatories">Signatories</TabsTrigger>
            </TabsList>

            <TabsContent value="buildings" className="space-y-3 pt-4">
              {buildings.length === 0 ? (
                <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No buildings yet. Prefill from the Rooms module, copy a
                  previous inventory, or add one by hand.
                </p>
              ) : (
                buildings.map((b, i) => (
                  <NsbiBuildingCard
                    key={b.key}
                    draft={b}
                    index={i}
                    roomCount={roomsByBuilding.get(b.key)?.length ?? 0}
                    expanded={expanded.has(b.key)}
                    onToggle={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(b.key)) next.delete(b.key);
                        else next.add(b.key);
                        return next;
                      })
                    }
                    onChange={(patch) => patchBuilding(b.key, patch)}
                    onRemove={() => removeBuilding(b.key)}
                    disabled={readOnly}
                  />
                ))
              )}
              <Button
                type="button"
                variant="outline"
                onClick={addBuilding}
                disabled={readOnly}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add building
              </Button>
            </TabsContent>

            <TabsContent value="rooms" className="space-y-3 pt-4">
              <p className="text-xs text-muted-foreground">
                {NSBI_ROOM_DIMENSION_NOTE}
              </p>
              {buildings.length === 0 ? (
                <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Add a building first — every room on this form belongs to one.
                </p>
              ) : (
                buildings.map((b) => (
                  <NsbiRoomRows
                    key={b.key}
                    buildingKey={b.key}
                    buildingName={b.building_name}
                    rooms={roomsByBuilding.get(b.key) ?? []}
                    onChange={patchRoom}
                    onAdd={addRoom}
                    onRemove={removeRoom}
                    disabled={readOnly}
                  />
                ))
              )}
            </TabsContent>

            {header ? (
              <>
                <TabsContent value="temporary" className="pt-4">
                  <NsbiTemporaryTab
                    draft={header}
                    onChange={patchHeader}
                    disabled={readOnly}
                  />
                </TabsContent>
                <TabsContent value="standalone" className="pt-4">
                  <NsbiStandaloneWashTab
                    draft={header}
                    onChange={patchHeader}
                    disabled={readOnly}
                  />
                </TabsContent>
                <TabsContent value="furniture" className="pt-4">
                  <NsbiFurnitureTab
                    draft={header}
                    onChange={patchHeader}
                    disabled={readOnly}
                    onPrefillFromKpi={handleKpiPrefill}
                    prefilling={kpiPrefilling}
                  />
                </TabsContent>
                <TabsContent value="amenities" className="pt-4">
                  <NsbiAmenitiesTab
                    draft={header}
                    onChange={patchHeader}
                    disabled={readOnly}
                  />
                </TabsContent>
                <TabsContent value="access" className="pt-4">
                  <NsbiAccessTab
                    draft={header}
                    onChange={patchHeader}
                    disabled={readOnly}
                  />
                </TabsContent>
                <TabsContent value="signatories" className="pt-4">
                  <NsbiSignatoriesTab
                    draft={header}
                    onChange={patchHeader}
                    disabled={readOnly}
                  />
                </TabsContent>
              </>
            ) : null}
          </Tabs>

          {warnings.length > 0 ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                Before this is signed ({warnings.length})
              </div>
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {warnings.slice(0, 12).map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
              </ul>
              {warnings.length > 12 ? (
                <p className="pl-5 pt-1 text-xs italic text-muted-foreground">
                  …and {warnings.length - 12} more.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-emerald-600/40 bg-emerald-600/5 p-3 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Nothing outstanding on this return.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <Button
              type="button"
              onClick={() => handleSave("draft")}
              disabled={readOnly || saving || busy}
            >
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving…" : "Save draft"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleSave("submitted")}
              disabled={readOnly || saving || busy}
            >
              Submit
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handlePrint}
              disabled={printing}
            >
              <Printer className="mr-2 h-4 w-4" />
              {printing ? "Preparing…" : "Print form"}
            </Button>
            {isLocked ? (
              <span className="text-xs text-muted-foreground">
                This inventory is locked. Ask the division office to reopen it.
              </span>
            ) : null}
            <span className="ml-auto text-xs text-muted-foreground">
              Printing uses the saved return — save before printing.
            </span>
          </div>
        </>
      )}

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New building inventory</DialogTitle>
            <DialogDescription>
              The DepEd form is headed with the date it is taken as of. This is
              printed on every page and cannot be inferred from the school year.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="as-of">As of</Label>
            <Input
              id="as-of"
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setNewOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleCreate} disabled={busy}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
