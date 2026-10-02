/**
 * Main plugin panel: actions, honest progress, Code/JSON preview, palettes, About.
 */
import copy from "copy-to-clipboard";
import GradientsPanel from "./components/GradientsPanel";
import ColorsPanel from "./components/ColorsPanel";
import CodePanel from "./components/CodePanel";
import EmptyState from "./components/EmptyState";
import About from "./components/About";
import WarningsPanel from "./components/WarningsPanel";
import { LinearGradientConversion, SolidColorConversion, Warning } from "types";
import Loading from "./components/Loading";
import { useState } from "react";
import { Download, InfoIcon, Sparkles } from "lucide-react";
import React from "react";
import { Button } from "./primitives/button";
import { ScrollArea } from "./primitives/scroll-area";
import { TooltipProvider } from "./primitives/tooltip";
import type { PreviewMode } from "./components/CodePanel";

type PluginUIProps = {
  code: string;
  lineCount: number;
  showingFullCode: boolean;
  warnings: Warning[];
  colors: SolidColorConversion[];
  gradients: LinearGradientConversion[];
  isLoading: boolean;
  isZipExporting?: boolean;
  isTidying?: boolean;
  hasOpenRouterKey?: boolean;
  statusMessage?: string;
  progressPercent?: number | null;
  onDownloadZip?: () => void;
  onTidyAndConvert?: () => void;
  onSaveOpenRouterKey?: (key: string) => void;
  onClearOpenRouterKey?: () => void;
  previewMode: PreviewMode;
  figmaJson: string;
  jsonLineCount: number;
  showingFullJson: boolean;
  figmaJsonLoading: boolean;
  onPreviewModeChange?: (mode: PreviewMode) => void;
  onCopy?: () => void;
  onShowMore?: () => void;
};

function StatusPill({
  isLoading,
  isTidying,
  isZipExporting,
  isError,
  hasCode,
  isEmpty,
}: {
  isLoading: boolean;
  isTidying: boolean;
  isZipExporting: boolean;
  isError: boolean;
  hasCode: boolean;
  isEmpty: boolean;
}) {
  if (isError) {
    return (
      <div className="va-pill bad" title="Error">
        <span className="dot" aria-hidden="true" />
        <span>Error</span>
      </div>
    );
  }
  if (isLoading || isTidying) {
    return (
      <div className="va-pill busy" title="Working">
        <span className="dot" aria-hidden="true" />
        <span>{isTidying ? "Tidying" : "Working"}</span>
      </div>
    );
  }
  if (isZipExporting) {
    return (
      <div className="va-pill busy" title="Exporting ZIP">
        <span className="dot" aria-hidden="true" />
        <span>Exporting</span>
      </div>
    );
  }
  if (hasCode) {
    return (
      <div className="va-pill ok" title="Ready">
        <span className="dot" aria-hidden="true" />
        <span>Ready</span>
      </div>
    );
  }
  return (
    <div className="va-pill" title={isEmpty ? "Idle" : "Idle"}>
      <span className="dot" aria-hidden="true" />
      <span>Idle</span>
    </div>
  );
}

export const PluginUI = (props: PluginUIProps) => {
  const [showAbout, setShowAbout] = useState(false);

  const busy =
    props.isLoading ||
    Boolean(props.isZipExporting) ||
    Boolean(props.isTidying);
  const isEmpty = !props.isLoading && props.code === "";
  const isError = Boolean(props.code?.startsWith("Error :("));
  const warnings = props.warnings ?? [];
  const canDownloadZip = props.code !== "" && !isError && !busy;
  const hasKey = Boolean(props.hasOpenRouterKey);
  const hasPercent =
    typeof props.progressPercent === "number" &&
    props.progressPercent >= 0 &&
    Number.isFinite(props.progressPercent);
  const showInlineProgress =
    props.isZipExporting || (props.isLoading && hasPercent);
  /** Convert/tidy: full progress panel. ZIP: keep preview, bar in header. */
  const showProgressPanel =
    Boolean(props.isLoading) && !Boolean(props.isZipExporting);

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
        <header className="shrink-0 border-b border-border px-4 pb-3 pt-3.5">
          <div className="flex items-start justify-between gap-2.5">
            <div className="min-w-0">
              <h1 className="m-0 text-[15px] font-bold tracking-tight">
                Figma to Code
              </h1>
              <p className="mt-1 mb-0 text-[11px] leading-[1.4] text-muted-foreground">
                Preview HTML · ZIP with styles/page.css + assets
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <StatusPill
                isLoading={Boolean(props.isLoading)}
                isTidying={Boolean(props.isTidying)}
                isZipExporting={Boolean(props.isZipExporting)}
                isError={isError}
                isEmpty={isEmpty}
                hasCode={canDownloadZip}
              />
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 rounded-lg ${
                  showAbout
                    ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                    : ""
                }`}
                onClick={() => setShowAbout(!showAbout)}
                aria-label="About"
              >
                <InfoIcon size={16} />
              </Button>
            </div>
          </div>
        </header>

        {!showAbout && (
          <div className="shrink-0 border-b border-border px-4 py-3">
            <div className="va-now mb-2.5">
              {props.statusMessage ||
                (canDownloadZip
                  ? "Preview ready — Download ZIP to package files"
                  : hasKey
                    ? "Select a frame to generate a preview"
                    : "Add an OpenRouter key in About for Tidy / ZIP CSS organize")}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                className="h-8 min-w-28 flex-1"
                disabled={!canDownloadZip || !props.onDownloadZip || !hasKey}
                title={
                  hasKey
                    ? "Build ZIP: AI-named classes in styles/page.css + index.html + assets"
                    : "Save an OpenRouter API key in About first (needed for AI CSS classifying)"
                }
                onClick={() => props.onDownloadZip?.()}
              >
                <Download size={14} />
                {props.isZipExporting ? "Exporting…" : "Download ZIP"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                disabled={busy || !props.onTidyAndConvert || !hasKey}
                title={
                  hasKey
                    ? "Clone, AI-section, Auto Layout, then convert"
                    : "Save an OpenRouter API key in About first"
                }
                onClick={() => props.onTidyAndConvert?.()}
              >
                <Sparkles size={14} />
                {props.isTidying ? "Tidying…" : "Tidy"}
              </Button>
            </div>
            {showInlineProgress && (
              <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full bg-primary transition-[width] duration-200 ease-out ${
                    hasPercent ? "" : "w-1/3 animate-pulse"
                  }`}
                  style={
                    hasPercent
                      ? {
                          width: `${Math.max(0, Math.min(100, props.progressPercent!))}%`,
                        }
                      : undefined
                  }
                />
              </div>
            )}
          </div>
        )}

        <ScrollArea className="min-h-0 flex-1 overflow-hidden">
          {showAbout ? (
            <About
              hasOpenRouterKey={hasKey}
              onSaveOpenRouterKey={props.onSaveOpenRouterKey}
              onClearOpenRouterKey={props.onClearOpenRouterKey}
            />
          ) : (
            <div className="flex min-h-full flex-col gap-3 px-4 py-3">
              {showProgressPanel ? (
                <section>
                  <h2 className="va-section-title">Progress</h2>
                  <div className="va-panel">
                    <Loading
                      statusMessage={props.statusMessage}
                      progressPercent={props.progressPercent}
                    />
                  </div>
                </section>
              ) : isEmpty ? (
                <section>
                  <h2 className="va-section-title">Preview</h2>
                  <div className="va-panel">
                    <EmptyState />
                  </div>
                </section>
              ) : (
                <>
                  {warnings.length > 0 && (
                    <section>
                      <h2 className="va-section-title">Warnings</h2>
                      <WarningsPanel warnings={warnings} />
                    </section>
                  )}

                  <section>
                    <h2 className="va-section-title">Preview</h2>
                    <div className="va-panel">
                      <CodePanel
                        code={props.code}
                        lineCount={props.lineCount}
                        showingFullCode={props.showingFullCode}
                        previewMode={props.previewMode}
                        figmaJson={props.figmaJson}
                        jsonLineCount={props.jsonLineCount}
                        showingFullJson={props.showingFullJson}
                        figmaJsonLoading={props.figmaJsonLoading}
                        onPreviewModeChange={props.onPreviewModeChange}
                        onCopy={props.onCopy}
                        onShowMore={props.onShowMore}
                      />
                    </div>
                  </section>

                  {props.colors.length > 0 && (
                    <section>
                      <h2 className="va-section-title">Colors</h2>
                      <ColorsPanel
                        colors={props.colors}
                        onColorClick={(value) => {
                          copy(value);
                        }}
                      />
                    </section>
                  )}

                  {props.gradients.length > 0 && (
                    <section>
                      <h2 className="va-section-title">Gradients</h2>
                      <GradientsPanel
                        gradients={props.gradients}
                        onColorClick={(value) => {
                          copy(value);
                        }}
                      />
                    </section>
                  )}
                </>
              )}
            </div>
          )}
        </ScrollArea>

        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-2.5">
          <div className="text-[10px] leading-[1.35] text-muted-foreground">
            {hasKey ? "OpenRouter key saved" : "No OpenRouter key"} · ZIP runs
            AI CSS classifying → styles/page.css + assets/
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
};
