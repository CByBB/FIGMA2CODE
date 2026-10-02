/** About tab: privacy copy, OpenRouter key entry (clientStorage on main thread), debug JSON export. */
import { useState } from "react";
import {
  ArrowRightIcon,
  Code,
  Heart,
  Lock,
  MessageCircle,
  Star,
  Zap,
  Copy,
  CheckCircle,
} from "lucide-react";
import { Button } from "../primitives/button";
import { logError } from "../../shared/log";

type AboutProps = {
  hasOpenRouterKey?: boolean;
  onSaveOpenRouterKey?: (key: string) => void;
  onClearOpenRouterKey?: () => void;
};

const About = ({
  hasOpenRouterKey = false,
  onSaveOpenRouterKey,
  onClearOpenRouterKey,
}: AboutProps) => {
  const [copied, setCopied] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [keySavedFlash, setKeySavedFlash] = useState(false);

  const copySelectionJson = async () => {
    try {
      parent.postMessage(
        { pluginMessage: { type: "get-selection-json", purpose: "copy" } },
        "*",
      );

      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      logError("copy selection JSON failed", e);
    }
  };

  const saveApiKey = () => {
    onSaveOpenRouterKey?.(apiKeyDraft);
    setApiKeyDraft("");
    setKeySavedFlash(true);
    setTimeout(() => setKeySavedFlash(false), 2000);
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3.5 px-4 py-3 text-sm">
      <header className="mb-1">
        <h2 className="m-0 text-[15px] font-bold tracking-tight">About</h2>
        <p className="mt-1 mb-0 text-[11px] leading-[1.4] text-muted-foreground">
          Created with{" "}
          <Heart size={12} className="inline fill-red-500 text-red-500" /> by
          Bernardo Ferrari
        </p>
        <div className="mt-2 flex gap-2">
          <a
            href="https://github.com/bernaferrari"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-border bg-muted p-1.5 transition-colors hover:bg-accent"
            aria-label="GitHub Profile"
          >
            <GithubLogo />
          </a>
          <a
            href="https://twitter.com/bernaferrari"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-border bg-muted p-1.5 transition-colors hover:bg-accent"
            aria-label="Twitter Profile"
          >
            <XLogo />
          </a>
        </div>
      </header>

      <section>
        <h3 className="va-section-title">Privacy</h3>
        <div className="va-panel">
          <div className="mb-2 flex items-center gap-2">
            <Lock size={16} className="text-primary" />
            <span className="text-[13px] font-semibold">Privacy Policy</span>
          </div>
          <p className="m-0 text-[11px] leading-[1.45] text-muted-foreground">
            This plugin is completely private. All of your design data is
            processed locally in your browser and never leaves your computer. No
            analytics, no data collection, no tracking.
          </p>
        </div>
      </section>

      <section>
        <h3 className="va-section-title">Open source</h3>
        <div className="va-panel">
          <p className="m-0 mb-2 text-[11px] leading-[1.45] text-muted-foreground">
            Figma to Code is completely open-source. Contributions, bug reports,
            and feature requests are welcome!
          </p>
          <a
            href="https://github.com/CodeByStella/FIGMA2CODE"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline"
          >
            <Star size={12} className="fill-amber-400 text-amber-400" />
            View on GitHub
          </a>
        </div>
      </section>

      <section>
        <h3 className="va-section-title">Features</h3>
        <div className="va-panel">
          <ul className="m-0 space-y-1.5 p-0 text-[11px] leading-[1.45] text-muted-foreground">
            <li className="flex items-start gap-2">
              <ArrowRightIcon size={12} className="mt-0.5 shrink-0" />
              <span>Convert Figma designs to HTML and CSS</span>
            </li>
            <li className="flex items-start gap-2">
              <ArrowRightIcon size={12} className="mt-0.5 shrink-0" />
              <span>Extract colors and gradients from your designs</span>
            </li>
            <li className="flex items-start gap-2">
              <ArrowRightIcon size={12} className="mt-0.5 shrink-0" />
              <span>Get responsive code that matches your design</span>
            </li>
          </ul>
        </div>
      </section>

      <section>
        <h3 className="va-section-title">Get in touch</h3>
        <div className="va-panel">
          <div className="mb-2 flex items-center gap-2">
            <MessageCircle size={16} className="text-primary" />
            <span className="text-[13px] font-semibold">Support</span>
          </div>
          <p className="m-0 mb-2 text-[11px] leading-[1.45] text-muted-foreground">
            Have feedback, questions, or need help? Open a GitHub issue:
          </p>
          <a
            href="https://github.com/CodeByStella/FIGMA2CODE/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline"
          >
            <GithubLogo width={14} height={14} />
            Report an issue on GitHub
          </a>
        </div>
      </section>

      <section>
        <h3 className="va-section-title">Keys · OpenRouter</h3>
        <div className="va-panel">
          <div className="mb-2 flex items-center gap-2">
            <Zap size={16} className="text-primary" />
            <span className="text-[13px] font-semibold">Tidy + AI</span>
          </div>
          <p className="m-0 mb-2 text-[11px] leading-[1.45] text-muted-foreground">
            Tidy + Convert uses vision{" "}
            <code className="text-[10.5px]">xiaomi/mimo-v2.5</code>; Download
            ZIP CSS refactor uses codegen{" "}
            <code className="text-[10.5px]">anthropic/claude-sonnet-4</code>{" "}
            (same as verified-agent). Your key is saved on this machine (Figma
            client storage + a local backup) and is never logged in full. The
            field stays empty after save for security — use Status below to
            confirm it is still stored.
          </p>
          <div className="va-now mb-2">
            Status:{" "}
            {hasOpenRouterKey ? (
              <strong className="text-(--ok)">
                Key saved — survives plugin reload
              </strong>
            ) : (
              <strong className="text-(--bad)">
                No key — Tidy + Convert disabled
              </strong>
            )}
          </div>
          <label className="mb-1 block text-[11px] text-muted-foreground">
            OpenRouter API key
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="password"
              autoComplete="off"
              placeholder={
                hasOpenRouterKey ? "Enter new key to replace…" : "sk-or-v1-…"
              }
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              className="h-8 flex-1 rounded-lg border border-border bg-muted px-2.5 text-xs text-foreground outline-none focus:outline-2 focus:outline-primary/45"
            />
            <Button
              size="sm"
              className="h-8 shrink-0"
              disabled={!apiKeyDraft.trim() || !onSaveOpenRouterKey}
              onClick={saveApiKey}
            >
              {keySavedFlash ? "Saved" : "Save key"}
            </Button>
            {hasOpenRouterKey && onClearOpenRouterKey ? (
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0 text-(--bad) hover:bg-(--bad-bg)"
                onClick={onClearOpenRouterKey}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <section>
        <h3 className="va-section-title">Debug</h3>
        <div className="va-panel">
          <div className="mb-2 flex items-center gap-2">
            <Code size={16} className="text-primary" />
            <span className="text-[13px] font-semibold">Debug helper</span>
          </div>
          <p className="m-0 mb-3 text-[11px] leading-[1.45] text-muted-foreground">
            Having an issue? Help debug by copying the JSON of your selected
            elements. This can be attached when reporting issues.
          </p>
          <Button
            onClick={copySelectionJson}
            variant="outline"
            size="sm"
            className="mb-3 h-8"
          >
            {copied ? (
              <>
                <CheckCircle size={14} />
                <span>Copied!</span>
              </>
            ) : (
              <>
                <Copy size={14} />
                <span>Copy Selection JSON</span>
              </>
            )}
          </Button>
        </div>
      </section>

      <p className="mb-1 text-center text-[10px] text-muted-foreground">
        © {new Date().getFullYear()} Bernardo Ferrari. All rights reserved.
      </p>
    </div>
  );
};

function GithubLogo({
  width = 18,
  height = 18,
  className,
}: {
  width?: number;
  height?: number;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      fill="currentColor"
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.16c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.75 2.69 1.24 3.34.95.1-.74.4-1.24.73-1.53-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.16 1.18.92-.25 1.9-.38 2.87-.39.98.01 1.96.14 2.88.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.23 2.75.12 3.04.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.42.36.78 1.06.78 2.14v3.18c0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function XLogo() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      fill="currentColor"
      viewBox="0 0 256 256"
    >
      <path d="M214.75,211.71l-62.6-98.38,61.77-67.95a8,8,0,0,0-11.84-10.76L143.24,99.34,102.75,35.71A8,8,0,0,0,96,32H48a8,8,0,0,0-6.75,12.3l62.6,98.37-61.77,68a8,8,0,1,0,11.84,10.76l58.84-64.72,40.49,63.63A8,8,0,0,0,160,224h48a8,8,0,0,0,6.75-12.29ZM164.39,208,62.57,48h29L193.43,208Z"></path>
    </svg>
  );
}

export default About;
