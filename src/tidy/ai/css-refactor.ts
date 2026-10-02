/**
 * OpenRouter text call: suggest semantic class names for extracted CSS rules
 * written to styles/page.css (separate from index.html).
 */
import { logError } from "../../shared/log";
import { aiLogCost } from "../ai/log";
import {
  MODEL_PRICE_INPUT_PER_1M_USD,
  MODEL_PRICE_OUTPUT_PER_1M_USD,
  OPENROUTER_CODE_MODEL,
  OPENROUTER_URL,
} from "../ai/prompt";
import { OpenRouterHttpError, OpenRouterParseError } from "../ai/openrouter";

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Model response is not valid JSON");
  }
}

function extractUsage(envelope: any): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  const u = envelope?.usage || {};
  const promptTokens = Number(u.prompt_tokens || u.promptTokens || 0) || 0;
  const completionTokens =
    Number(u.completion_tokens || u.completionTokens || 0) || 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens:
      Number(u.total_tokens || u.totalTokens || 0) ||
      promptTokens + completionTokens,
  };
}

function estimateCost(promptTokens: number, completionTokens: number) {
  const inputUsd = (promptTokens / 1_000_000) * MODEL_PRICE_INPUT_PER_1M_USD;
  const outputUsd =
    (completionTokens / 1_000_000) * MODEL_PRICE_OUTPUT_PER_1M_USD;
  return {
    inputUsd,
    outputUsd,
    totalUsd: inputUsd + outputUsd,
  };
}

/** Cap payload so OpenRouter stays within context for large exports. */
const MAX_CSS_CHARS = 24_000;
const MAX_HTML_SAMPLE = 12_000;

export type CssRefactorResult = {
  renames: Record<string, string>;
  elapsedMs: number;
  httpStatus: number;
};

/**
 * Ask OpenRouter for semantic renames of generated classes (c1, c2, …).
 * Returns rename map only — caller applies it locally to HTML + styles/page.css.
 */
export async function callOpenRouterCssRefactor(args: {
  apiKey: string;
  html: string;
  css: string;
}): Promise<CssRefactorResult> {
  const { apiKey, html, css: cssIn } = args;
  const css = String(cssIn || "").slice(0, MAX_CSS_CHARS);
  const sample = html.slice(0, MAX_HTML_SAMPLE);

  const system = [
    "You refactor Figma-exported HTML/CSS for cleaner class names.",
    "Inline styles were moved into styles/page.css with classes like .c1, .c2.",
    "Return ONLY valid JSON (no markdown) with a renames object mapping old class → new class.",
    "New names must be short, lowercase, kebab-case or camelCase, valid CSS identifiers.",
    "Prefer semantic UI names when obvious (hero, nav, card, title, btn). Otherwise keep compact (row, col, media).",
    "Do not invent new selectors. Only rename existing classes that appear in the CSS.",
    "Do not change CSS property values. Keep CSS in a separate stylesheet (not inline in HTML).",
    'Shape: {"renames":{"c1":"hero","c2":"card-title"}}',
  ].join(" ");

  const user = [
    "CSS file (styles/page.css):",
    css || "(empty)",
    "",
    "HTML sample (truncated):",
    sample,
    "",
    'Respond with JSON: {"renames":{...}}',
  ].join("\n");

  const t0 = Date.now();
  let httpStatus = 0;
  let bodyText = "";

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/CodeByStella/FIGMA2CODE",
        "X-Title": "Figma to Code CSS Refactor",
      },
      body: JSON.stringify({
        model: OPENROUTER_CODE_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    httpStatus = res.status;
    bodyText = await res.text();
    const elapsedMs = Date.now() - t0;

    if (!res.ok) {
      const snippet = bodyText.slice(0, 500);
      logError("openrouter css-refactor HTTP error", {
        httpStatus,
        snippet,
        elapsedMs,
      });
      throw new OpenRouterHttpError(
        httpStatus,
        `OpenRouter ${httpStatus}: ${snippet || res.statusText}`,
      );
    }

    let parsedOuter: any;
    try {
      parsedOuter = JSON.parse(bodyText);
    } catch (e) {
      logError("openrouter css-refactor non-JSON envelope", e);
      throw new Error("OpenRouter returned non-JSON envelope");
    }

    const usage = extractUsage(parsedOuter);
    const cost = estimateCost(usage.promptTokens, usage.completionTokens);
    aiLogCost({
      model: OPENROUTER_CODE_MODEL,
      tokens: {
        prompt: usage.promptTokens,
        completion: usage.completionTokens,
        total: usage.totalTokens,
      },
      costUsd: {
        input: cost.inputUsd,
        output: cost.outputUsd,
        total: cost.totalUsd,
      },
    });

    const content =
      parsedOuter?.choices?.[0]?.message?.content ??
      parsedOuter?.choices?.[0]?.message?.reasoning ??
      "";
    const contentStr =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .map((c: any) => (typeof c?.text === "string" ? c.text : ""))
              .join("")
          : JSON.stringify(content);

    let renames: Record<string, string> = {};
    try {
      const json = extractJsonObject(contentStr) as {
        renames?: Record<string, string>;
      };
      if (json && typeof json.renames === "object" && json.renames) {
        renames = Object.fromEntries(
          Object.entries(json.renames).filter(
            ([k, v]) => typeof k === "string" && typeof v === "string",
          ),
        );
      }
    } catch (e) {
      logError("css-refactor invalid model JSON", e);
      throw new OpenRouterParseError(
        e && typeof e === "object" && "message" in e
          ? String((e as Error).message)
          : "Model response is not valid JSON",
      );
    }

    return { renames, elapsedMs, httpStatus };
  } catch (e) {
    if (httpStatus && !String(e).includes("OpenRouter")) {
      logError("openrouter css-refactor fetch failed", e);
    }
    throw e;
  }
}
