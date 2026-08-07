interface Props {
  ledgerAsOf: string | null;
  censoredCount: number;
}

/**
 * The caveats belong here, not only in the README — every number on this page is
 * conditional on them.
 */
export function Footer({ ledgerAsOf, censoredCount }: Props) {
  return (
    <footer
      className="mt-2 border-t px-4 py-4 text-xs leading-relaxed"
      style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
    >
      <ul className="max-w-4xl space-y-1.5">
        <li>
          These are <strong>OpenRouter's advertised prices for the default routed provider</strong>,
          not each vendor's own list price. For open-weight models the figure moves constantly
          because OpenRouter re-routes between hosts — that is what the decay view shows.
        </li>
        <li>
          OpenRouter's ~5.5% credit-purchase fee is <strong>not</strong> included. Neither are
          cached-token or web-search charges.
        </li>
        <li>
          The ledger begins <strong>2024-09-21</strong>. Series that were already live then are
          drawn with a faded left edge
          {censoredCount > 0 && <> ({censoredCount} on screen)</>} — the wall is when the snapshotting
          started, not a synchronised launch. Their release dates come from OpenRouter's own{" "}
          <code>created</code> field where it exists.
        </li>
        <li>
          Cached-token prices are present-day only; the ledger carries no history for them, so
          there is no cache-price time series.
        </li>
        <li>
          Data:{" "}
          <a
            className="underline underline-offset-2"
            href="https://github.com/jvrck/openrouterlist"
            target="_blank"
            rel="noreferrer noopener"
          >
            jvrck/openrouterlist
          </a>{" "}
          (MIT), snapshotted twice daily from the OpenRouter models API
          {ledgerAsOf && <> · ledger as of {ledgerAsOf}</>}.
        </li>
      </ul>
    </footer>
  );
}
