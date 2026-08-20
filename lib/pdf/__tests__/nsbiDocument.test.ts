/**
 * NSBI printed form.
 *
 * The point of this module is that the output IS the DepEd document, not a
 * report that resembles it. The properties that make it a facsimile are the
 * ones nobody would notice breaking until a division office rejected a signed
 * return, so they are pinned here:
 *
 *   * five pages, with the form's own table groupings
 *   * Longitude/Latitude on page 1 and nowhere else
 *   * the Supply Officer on page 1 and nowhere else
 *   * page 1's "&" caption versus the "," caption on pages 2–5
 *   * the Col. n numbering rows the division checks against
 *   * duplicate actual usages both printed, per the answering guide
 *   * the as-of date taken from the row, never from the clock
 */

import { describe, expect, it } from "vitest";
import {
  buildNsbiDocument,
  type NsbiDocumentContext,
} from "../nsbiDocument";
import type { NsbiBuilding, NsbiRoom, NsbiSubmission } from "@/types";

function blankSubmission(): NsbiSubmission {
  return {
    id: "10",
    school_id: "1",
    as_of_date: "2026-05-31",
    status: "submitted",
    latitude: 8.714167,
    longitude: 125.749722,
    tls_count: 2,
    tls_sections_count: 3,
    makeshift_count: null,
    makeshift_sections_count: null,
    standalone_bowls_male: 4,
    standalone_bowls_female: 4,
    standalone_bowls_pwd: 1,
    standalone_bowls_shared: 0,
    standalone_bowls_nonfunctional: 2,
    standalone_washbasins: 3,
    standalone_urinals: 2,
    standalone_urinal_troughs: 1,
    standalone_septic_tank: true,
    standalone_faucets_with_water: 5,
    standalone_faucets_without_water: 1,
    furniture_kinder_modular_table: 10,
    furniture_kinder_chair: 40,
    furniture_armchair: 250,
    furniture_school_desk: 40,
    furniture_other_table: null,
    furniture_other_chair: null,
    furniture_1seater_elementary: 12,
    furniture_1seater_jhs: 0,
    furniture_1seater_shs: null,
    furniture_2seater_elementary: 15,
    furniture_2seater_jhs: null,
    furniture_2seater_shs: null,
    amenities: {
      covered_court: true,
      gymnasium: false,
      permanent_perimeter_fence: true,
    },
    access_road_types: ["paved", "levelled"],
    transport_types: ["tricycle", "habal_habal", "walking_hiking"],
    signatories: [
      { role: "school_head", name: "Juan Dela Cruz", title: "School Head" },
      { role: "planning_officer", name: "Maria Santos", title: "Planning Officer III" },
      { role: "supply_officer", name: "Pedro Reyes", title: "Supply Officer" },
      { role: "engineer", name: "Ana Lim", title: "Engineer III" },
    ],
    notes: "internal only",
    submitted_at: null,
    submitted_by_user_id: null,
    created_at: "",
    updated_at: "",
  };
}

function blankBuilding(overrides: Partial<NsbiBuilding> = {}): NsbiBuilding {
  return {
    id: "100",
    submission_id: "10",
    sort_order: 1,
    building_name: "Gabaldon Bldg",
    building_type: "gabaldon",
    fund_sources: ["deped_national"],
    specific_fund_source: "deped_budget",
    condition: "needs_minor_repair",
    storeys: 2,
    room_count: 2,
    year_completed: 1938,
    classification: "permanent",
    pwd_accessible: true,
    major_repair_last_5y: false,
    has_certificate_of_acceptance: null,
    in_deped_book_of_accounts: true,
    building_materials: ["concrete", "wood"],
    date_of_acquisition: "1938-06-01",
    acquisition_cost: 125000,
    book_value: 90000,
    insurance_info: "None",
    bowls_male: 2,
    bowls_female: 2,
    bowls_pwd: 1,
    bowls_shared: 0,
    bowls_nonfunctional: 1,
    washbasins: 2,
    urinals: 1,
    urinal_troughs: 0,
    septic_tank: true,
    faucets_with_water: 3,
    faucets_without_water: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function blankRoom(overrides: Partial<NsbiRoom> = {}): NsbiRoom {
  return {
    id: "200",
    submission_id: "10",
    building_id: "100",
    sort_order: 1,
    floor_number: 1,
    room_number: "Room 101",
    condition: "good",
    room_usage: "instructional",
    actual_usages: ["classroom_elementary"],
    width_m: 7,
    length_m: 9,
    source_room_id: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function ctx(overrides: Partial<NsbiDocumentContext> = {}): NsbiDocumentContext {
  return {
    submission: blankSubmission(),
    buildings: [blankBuilding()],
    rooms: [blankRoom()],
    school: {
      name: "Bayugan Central Elementary School",
      school_id: "123456",
      division_id: "Bayugan City",
      region: "Region XIII",
    },
    ...overrides,
  };
}

/** The document's five pages, split so per-page assertions are possible. */
function pages(html: string): string[] {
  return html
    .split('<div class="page">')
    .slice(1)
    .map((p) => p.split("</body>")[0]);
}

describe("NSBI printed form", () => {
  it("is five pages, not one per table", () => {
    expect(pages(buildNsbiDocument(ctx()))).toHaveLength(5);
  });

  it("groups the tables onto the pages the issued form uses", () => {
    const [p1, p2, p3, p4, p5] = pages(buildNsbiDocument(ctx()));
    expect(p1).toContain("Table 1. Summary of Existing Building");
    expect(p2).toContain("Table 2. Existing Rooms per Building");
    // Tables 3 and 4A share page 3; 4B, 5 and 6 share page 4.
    expect(p3).toContain("Table 3.");
    expect(p3).toContain("Table 4A.");
    expect(p4).toContain("Table 4B.");
    expect(p4).toContain("Table 5.");
    expect(p4).toContain("Table 6.");
    expect(p5).toContain("Table 7. Access going to School");
  });

  it("prints coordinates on page 1 only", () => {
    const [p1, ...rest] = pages(buildNsbiDocument(ctx()));
    expect(p1).toContain("Longitude:");
    expect(p1).toContain("125.749722");
    for (const p of rest) expect(p).not.toContain("Longitude:");
  });

  it("has the Supply Officer sign page 1 and no other page", () => {
    const [p1, ...rest] = pages(buildNsbiDocument(ctx()));
    expect(p1).toContain("Pedro Reyes");
    for (const p of rest) expect(p).not.toContain("Pedro Reyes");
    // The other three sign every page.
    for (const p of [p1, ...rest]) {
      expect(p).toContain("Juan Dela Cruz");
      expect(p).toContain("Maria Santos");
      expect(p).toContain("Ana Lim");
    }
  });

  it("reproduces page 1's ampersand caption and the comma form elsewhere", () => {
    const [p1, p2] = pages(buildNsbiDocument(ctx()));
    expect(p1).toContain("Prepared &amp; Certified True and Correct by:");
    expect(p2).toContain("Prepared, Certified True and Correct by:");
    expect(p2).not.toContain("Prepared &amp; Certified");
  });

  it("prints the Col. n numbering rows the division checks against", () => {
    const [p1, p2] = pages(buildNsbiDocument(ctx()));
    expect(p1).toContain("Col. 1");
    expect(p1).toContain("Col. 18"); // Table 1 runs to 18
    expect(p1).not.toContain("Col. 19");
    expect(p2).toContain("Col. 8"); // Table 2 runs to 8
  });

  it("takes the as-of date from the row, never from the clock", () => {
    const html = buildNsbiDocument(ctx());
    expect(html).toContain("(as of May 31, 2026)");
    expect(html).not.toContain(String(new Date().getFullYear() + 1));
  });

  it("prints a duplicated actual usage twice", () => {
    // The answering guide's own example: one room, two concurrent SPED classes.
    const html = buildNsbiDocument(
      ctx({
        rooms: [
          blankRoom({
            actual_usages: ["classroom_sped", "classroom_sped"],
          }),
        ],
      }),
    );
    const cell = html.split("Room 101")[1].slice(0, 400);
    expect(cell).toContain("Classroom SPED, Classroom SPED");
  });

  it("resolves codes to their printed labels, not raw values", () => {
    const html = buildNsbiDocument(ctx());
    expect(html).toContain("Gabaldon School Building"); // building_type
    expect(html).toContain("DepEd National Funded"); // fund_sources
    expect(html).toContain("Needs Minor Repair"); // condition
    expect(html).toContain("Concrete, Wood"); // materials
    expect(html).not.toContain(">gabaldon<");
  });

  it("distinguishes an unanswered flag from an answered No", () => {
    const html = buildNsbiDocument(ctx());
    // in_deped_book_of_accounts = true, major_repair = false, cert = null.
    const row = html.split("Gabaldon Bldg")[1].slice(0, 1200);
    expect(row).toContain(">Yes<");
    expect(row).toContain(">No<");
    // The null cell prints empty rather than "No".
    expect(row).toContain('<td class="c"></td>');
  });

  it("ticks only the amenities and transport actually recorded", () => {
    const [, , , p4, p5] = pages(buildNsbiDocument(ctx()));
    // Covered Court is Yes, Gymnasium is No, Solar Panel is unanswered.
    expect(p4).toContain("Covered Court");
    expect(p4).toContain("Gymnasium");
    expect(p5).toContain("Tricycle");
    expect(p5).toContain("Biking"); // present on the form even though the guide omits it
    const ticked = (p5.match(/class="box on"/g) ?? []).length;
    // 2 road types + 3 transport types.
    expect(ticked).toBe(5);
  });

  it("still prints ruled rows when a school has recorded nothing", () => {
    const html = buildNsbiDocument(ctx({ buildings: [], rooms: [] }));
    expect(pages(html)).toHaveLength(5);
    expect(html).toContain("<td>&nbsp;</td>");
  });

  it("escapes values rather than letting them into the markup", () => {
    const html = buildNsbiDocument(
      ctx({
        buildings: [blankBuilding({ building_name: '<script>x</script>' })],
      }),
    );
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps internal notes off the printed form", () => {
    expect(buildNsbiDocument(ctx())).not.toContain("internal only");
  });
});
