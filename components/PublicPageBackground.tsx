/**
 * Ground for the public interstitials — login, the auth callback, 404.
 *
 * No background photograph. Atmosphere comes from a warm paper wash, a faint
 * ledger grid and a grain overlay, so the surface still has depth without
 * loading an image or forcing every caption on top of it to be white.
 *
 * Everything drawn here is ink-on-paper, which means the pages that mount it
 * use dark type. Do not put white text over this.
 */
export function PublicPageBackground() {
  return (
    <div className="paper-ground paper-grain fixed inset-0 -z-10" aria-hidden>
      {/* Brass hairline along the very top — the one warm accent. */}
      <div className="absolute inset-x-0 top-0 h-px bg-[var(--brass)]/35" />

      {/* Two soft washes, drifting slowly, to keep large areas from going flat. */}
      <div className="absolute -top-[25%] -left-[15%] h-[620px] w-[620px] rounded-full bg-[var(--brass)]/[0.045] blur-3xl animate-[float_24s_ease-in-out_infinite]" />
      <div className="absolute -bottom-[20%] -right-[10%] h-[560px] w-[560px] rounded-full bg-[var(--band-shs)]/[0.05] blur-3xl animate-[float_30s_ease-in-out_infinite_reverse]" />

      {/* Weighted rule near the foot, the way a form is closed off. */}
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[var(--rule-faint)]/60 to-transparent" />
    </div>
  );
}
