import React from "react";

/** Placeholder when nothing is selected. */
const EmptyState = () => {
  return (
    <div className="flex w-full flex-col items-center px-2 py-12 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-muted text-[15px] font-bold tracking-tight text-muted-foreground">
        ⌗
      </div>
      <h3 className="m-0 text-[13px] font-semibold text-foreground">
        Select a frame
      </h3>
      <p className="mt-2 mb-0 max-w-56 text-[11px] leading-[1.45] text-muted-foreground">
        HTML preview appears here. Download ZIP for index.html, styles/page.css,
        and assets.
      </p>
    </div>
  );
};

export default EmptyState;
