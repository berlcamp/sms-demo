import { createClient } from "@supabase/supabase-js";

export const supabase2 = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  {
    db: {
      schema: "procurements", // ✅ Use the custom schema by default
    },
  },
);
