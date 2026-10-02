/** Syntax-highlighted HTML or Figma JSON preview. */
import { useMemo, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { coldarkDark as theme } from "react-syntax-highlighter/dist/esm/styles/prism";
import { CopyButton } from "./CopyButton";
import { cn } from "../lib/utils";

export type PreviewMode = "code" | "json";

interface CodePanelProps {
  code: string;
  lineCount: number;
  showingFullCode: boolean;
  previewMode: PreviewMode;
  figmaJson: string;
  jsonLineCount: number;
  showingFullJson: boolean;
  figmaJsonLoading: boolean;
  onPreviewModeChange?: (mode: PreviewMode) => void;
  onCopy?: () => void;
  onShowMore?: () => void;
}

function ViewToggle({
  value,
  onChange,
}: {
  value: PreviewMode;
  onChange: (mode: PreviewMode) => void;
}) {
  const options: { id: PreviewMode; label: string }[] = [
    { id: "code", label: "Code" },
    { id: "json", label: "JSON" },
  ];

  return (
    <div
      className="inline-flex items-center rounded-lg bg-muted p-0.5"
      role="tablist"
      aria-label="Preview mode"
    >
      {options.map((opt) => {
        const selected = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(opt.id)}
            className={cn(
              "h-7 rounded-md px-3 text-[11px] font-semibold transition-colors",
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

const CodePanel = (props: CodePanelProps) => {
  const [syntaxHovered, setSyntaxHovered] = useState(false);
  const {
    code,
    lineCount,
    showingFullCode,
    previewMode,
    figmaJson,
    jsonLineCount,
    showingFullJson,
    figmaJsonLoading,
  } = props;
  const isCodeEmpty = code === "";
  const isJsonMode = previewMode === "json";
  const displayedLineCount = isJsonMode ? jsonLineCount : lineCount;
  const showingFull = isJsonMode ? showingFullJson : showingFullCode;

  const showMoreButton = displayedLineCount > 25;
  const showCopyButton = displayedLineCount > 5;

  const handleButtonHover = () => setSyntaxHovered(true);
  const handleButtonLeave = () => setSyntaxHovered(false);

  const sizeHint = useMemo(() => {
    if (isJsonMode) {
      if (figmaJsonLoading) return "Loading…";
      if (!figmaJson) return null;
      if (jsonLineCount <= 25) return `${jsonLineCount} lines`;
      return showingFullJson
        ? `${jsonLineCount} lines`
        : `First 25 of ${jsonLineCount}`;
    }
    if (!code || lineCount <= 0) return null;
    if (lineCount <= 25) return `${lineCount} lines`;
    return showingFullCode ? `${lineCount} lines` : `First 25 of ${lineCount}`;
  }, [
    isJsonMode,
    figmaJsonLoading,
    figmaJson,
    jsonLineCount,
    showingFullJson,
    code,
    lineCount,
    showingFullCode,
  ]);

  const displayed = isJsonMode ? figmaJson : code;
  const isEmpty = isJsonMode
    ? !figmaJsonLoading && figmaJson === ""
    : isCodeEmpty;

  return (
    <div className="mt-0 flex w-full flex-col gap-2.5">
      <div className="flex w-full items-center justify-between gap-2">
        <ViewToggle
          value={previewMode}
          onChange={(mode) => props.onPreviewModeChange?.(mode)}
        />
        {sizeHint && (
          <span className="text-[10px] font-medium text-muted-foreground">
            {sizeHint}
          </span>
        )}
      </div>

      <div
        className={`relative overflow-hidden rounded-lg ring-green-600 transition-all duration-200 ${
          syntaxHovered ? "ring-2" : "ring-0"
        }`}
      >
        {figmaJsonLoading && isJsonMode ? (
          <div className="flex min-h-36 items-center justify-center rounded-lg bg-[#1B1B1B] px-4 py-8 text-[12px] text-neutral-400">
            Loading Figma JSON…
          </div>
        ) : isEmpty ? (
          <div className="flex min-h-36 items-center justify-center rounded-lg bg-[#1B1B1B] px-4 py-8 text-[12px] text-neutral-400">
            {isJsonMode
              ? "No Figma JSON for this selection"
              : "No code yet — select a frame"}
          </div>
        ) : (
          <>
            {showCopyButton && (
              <div className="pointer-events-none sticky top-3 z-10 h-0">
                <CopyButton
                  showLabel={false}
                  onCopy={props.onCopy}
                  onMouseEnter={handleButtonHover}
                  onMouseLeave={handleButtonLeave}
                  className="pointer-events-auto absolute right-2 top-2 h-7 w-7 rounded-md bg-neutral-800/90 p-0 text-neutral-200 shadow-sm ring-1 ring-white/10 backdrop-blur-sm hover:bg-neutral-600 hover:text-white hover:ring-white/20 dark:bg-neutral-800/90 dark:hover:bg-neutral-600"
                />
              </div>
            )}
            <SyntaxHighlighter
              language={isJsonMode ? "json" : "html"}
              style={theme}
              customStyle={{
                fontSize: 12,
                borderRadius: 8,
                marginTop: 0,
                marginBottom: 0,
                backgroundColor: syntaxHovered ? "#1E2B1A" : "#1B1B1B",
                transitionProperty: "all",
                transitionTimingFunction: "ease",
                transitionDuration: "0.2s",
                userSelect: "text",
                cursor: "text",
              }}
            >
              {displayed}
            </SyntaxHighlighter>
            {showMoreButton && (
              <div className="flex justify-center border-t border-white/10 bg-[#1B1B1B]">
                <button
                  type="button"
                  onClick={() => {
                    if (showingFull) return;
                    props.onShowMore?.();
                  }}
                  className="flex w-full justify-center py-2.5 text-[11px] font-medium text-sky-400 transition-colors hover:text-sky-300"
                  aria-label="Show more. This could be slow or freeze Figma for a few seconds."
                  title="Show more. This could be slow or freeze Figma for a few seconds."
                >
                  {showingFull ? "Showing full document" : "Show more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default CodePanel;
