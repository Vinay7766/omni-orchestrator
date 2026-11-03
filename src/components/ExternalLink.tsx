import React from "react";
import { ExternalLink as LinkIcon } from "lucide-react";
import { openExternal, safeExternalUrl } from "../lib/external-link";

/**
 * A web link from untrusted text: a real link only for a safe https address (RT-9), opened in the
 * system browser; anything else is shown as plain text, so the person can still read it.
 */
export const ExternalLink: React.FC<{ url: string; children?: React.ReactNode; className?: string; title?: string }> = ({ url, children, className = "", title }) => {
  const safe = safeExternalUrl(url);
  if (!safe) {
    return (
      <span className={className} title="Not opened: only https links are opened">
        {children ?? url}
      </span>
    );
  }
  return (
    <a
      href={safe}
      target="_blank"
      rel="noreferrer noopener"
      title={title}
      onClick={(e) => {
        e.preventDefault();
        void openExternal(safe).catch(() => undefined);
      }}
      className={`inline-flex items-center gap-1 ${className}`}
    >
      {children ?? safe}
      <LinkIcon className="w-3 h-3" aria-hidden="true" />
    </a>
  );
};
