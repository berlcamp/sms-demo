"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getGradeLevelLabel, GRADE_LEVELS } from "@/lib/constants";
import { supabase } from "@/lib/supabase/client";
import { Save } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

interface Row {
  grade_level: number;
  max_students: number;
}

export default function Page() {
  const [rows, setRows] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const fetch = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("sms_class_size_standards")
        .select("grade_level, max_students")
        .order("grade_level");
      if (!isMounted) return;
      if (error) {
        toast.error(error.message);
      } else {
        const map: Record<number, number> = {};
        for (const r of (data as Row[]) || []) {
          map[r.grade_level] = r.max_students;
        }
        setRows(map);
      }
      setLoading(false);
    };
    fetch();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = GRADE_LEVELS.map((gl) => ({
        grade_level: gl,
        max_students: Math.max(1, Math.floor(Number(rows[gl]) || 40)),
      }));
      const { error } = await supabase
        .from("sms_class_size_standards")
        .upsert(payload, { onConflict: "grade_level" });
      if (error) throw error;
      toast.success("Class size standards saved.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save standards",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="app__title">
        <Link
          href="/division/reports"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← SDO Reports
        </Link>
        <h1 className="app__title_text">Class Size Standards</h1>
        <p className="text-sm text-muted-foreground">
          Set the maximum number of students per class for each grade level.
          Used by the Classroom Needs Analysis report.
        </p>
      </div>

      <div className="app__content">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Max students per class
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <div className="app__table_shell">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Grade Level</TableHead>
                      <TableHead className="text-right">
                        Max Students
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {GRADE_LEVELS.map((gl) => (
                      <TableRow key={gl}>
                        <TableCell className="font-medium">
                          {getGradeLevelLabel(gl)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={1}
                            className="ml-auto h-9 w-[100px] text-right"
                            value={rows[gl] ?? ""}
                            onChange={(e) =>
                              setRows((prev) => ({
                                ...prev,
                                [gl]: Number(e.target.value),
                              }))
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <Button onClick={handleSave} disabled={loading || saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Saving…" : "Save Standards"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
