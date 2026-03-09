// Shared helpers for MCP tool handlers
import { z } from "zod";
import { PDFParse } from "pdf-parse";

/**
 * Normalize a bill number for comparison
 * Handles variations like "AB 858", "AB858", "AB-858", "ab858"
 */
export function normalizeBillNumber(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s.-]/g, "") // Remove spaces, dots, dashes
    .replace(/^([A-Z]+)0+(\d)/, "$1$2"); // Strip leading zeros: AB0858 → AB858
}

export const stateCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, "State must be a two-letter abbreviation")
  .transform((value) => value.toUpperCase());

export const searchStateSchema = z
  .string()
  .trim()
  .regex(/^(?:[A-Za-z]{2}|[Aa][Ll][Ll])$/, "State must be two-letter code or ALL")
  .transform((value) => value.toUpperCase());

/**
 * Create a successful JSON tool response
 */
export function jsonResponse(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Extract plain text from a base64-encoded document.
 * Supports HTML (mime_id=1) and PDF (mime_id=2); falls back to UTF-8 for others.
 */
export async function extractTextFromDoc(
  mimeId: number,
  base64Doc: string
): Promise<string> {
  const buffer = Buffer.from(base64Doc, "base64");

  if (mimeId === 1) {
    // HTML: decode and strip tags
    return buffer
      .toString("utf-8")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (mimeId === 2) {
    // PDF: parse with pdf-parse v2 class API
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    await parser.destroy();
    return result.text.trim();
  }

  // Fallback: return raw UTF-8 content
  return buffer.toString("utf-8");
}

/**
 * Create an error tool response
 */
export function errorResponse(error: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
      },
    ],
    isError: true,
  };
}
