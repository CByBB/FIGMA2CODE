import React from "react";

/** Honest progress while convert / tidy / ZIP export runs. */
type LoadingProps = {
  statusMessage?: string;
  progressPercent?: number | null;
};

const Loading = ({ statusMessage, progressPercent }: LoadingProps) => {
  const hasPercent =
    typeof progressPercent === "number" &&
    progressPercent >= 0 &&
    Number.isFinite(progressPercent);
  const width = hasPercent
    ? `${Math.max(0, Math.min(100, progressPercent))}%`
    : undefined;

  return (
    <div className="flex w-full flex-col items-center gap-3 py-10 text-center">
      <div className="h-1.5 w-full max-w-52 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full bg-primary transition-[width] duration-200 ease-out ${
            hasPercent ? "" : "w-1/3 animate-pulse"
          }`}
          style={width ? { width } : undefined}
        />
      </div>
      <div className="flex flex-col gap-1">
        <p className="m-0 text-[13px] font-semibold text-foreground">
          {statusMessage || "Working…"}
        </p>
        {hasPercent && (
          <p className="m-0 text-[11px] text-muted-foreground">
            {Math.round(progressPercent!)}%
          </p>
        )}
      </div>
    </div>
  );
};

export default Loading;
